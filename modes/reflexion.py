from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.tracing import get_logger
from flowforge.core.prompt_manager import get_prompt
from flowforge.modes.default_llm_actors import DefaultLLMActor, DefaultLLMEvaluator, DefaultLLMReflector

logger = get_logger("reflexion_executor")


class ReflexionExecutor(BaseModeExecutor):
    mode_name = "reflexion"
    capabilities = ["generation", "evaluation", "refinement"]
    MAX_ITERATIONS = 3
    QUALITY_THRESHOLD = 0.85
    # 单次LLM调用超时（秒）— 需要足够长以覆盖OpenRoute代理延迟
    STEP_TIMEOUT = 300

    async def _execute_core(self, ctx: TaskContext) -> dict:
        import asyncio
        # P0-6: 构建完整的任务上下文，包含 research_materials/persona/platforms/draft
        # 原逻辑只从 topic_list 标题拼接（约167字符），导致 LLM 缺乏素材和上下文
        task = ctx.input_data.get("task", "") or ctx.input_data.get("intent", "")
        if not task:
            # 从 topic_list 构建基础任务描述
            topic_list = ctx.input_data.get("topic_list", [])
            if topic_list and isinstance(topic_list, list):
                titles = [t.get("title", "") if isinstance(t, dict) else str(t) for t in topic_list[:3]]
                task = "创作关于以下选题的文章：" + "、".join(titles)
        if not task:
            task = str(ctx.input_data)[:2000]

        # P0-6: 构建富上下文任务描述，包含素材、人设、平台、草稿等完整信息
        task = self._build_rich_task(ctx, task)
        memory = []
        best_result = None
        best_score = 0.0
        best_text = ""
        iteration = 0

        def _emit(event_type: str, data: dict):
            """Safely emit event, ignoring if event_bus is None."""
            if ctx.event_bus:
                ctx.event_bus.emit(ctx.task_id, event_type, data)

        for iteration in range(self.MAX_ITERATIONS):
            _emit("reflexion.iteration_start", {"iteration": iteration + 1})
            actor_output = None

            # Actor阶段
            try:
                actor = ctx.agents.get("reflexion_actor") if ctx.agents else None
                if actor is None:
                    actor = DefaultLLMActor()
                actor_params = {"task": task, "memory": memory, "persona": ctx.persona or "default"}
                # B4 修复：传递真实 agent_name 到 actor_params，让 DefaultLLMActor 能使用正确的 LLM 路由
                # 原代码硬编码 agent_name="reflexion_actor"，导致 LLM 超时路由失效（用30s而非60s）
                actor_params["agent_name"] = getattr(ctx, 'agent_name', None) or "contentforge:writer"
                # P0-1: 传递agent的instructions到actor_params，确保DefaultLLMActor能使用
                # writer agent的 contentforge.writer.main prompt_template
                if hasattr(ctx, 'instructions') and ctx.instructions:
                    actor_params["instructions"] = ctx.instructions
                # 传递prefer_api配置（writer agent配置了prefer_api: true）
                if hasattr(ctx, 'input_data') and ctx.input_data and ctx.input_data.get("prefer_api"):
                    actor_params["prefer_api"] = ctx.input_data.get("prefer_api")
                # 传递上一轮的draft和评委反馈，确保反思链路不断裂
                if hasattr(ctx, 'input_data') and ctx.input_data:
                    for key in ('draft', 'loop_reflections', 'loop_verifier_errors'):
                        if key in ctx.input_data:
                            actor_params[key] = ctx.input_data[key]
                if hasattr(ctx, 'state') and ctx.state:
                    for key in ('draft', 'loop_reflections', 'loop_verifier_errors'):
                        if key in ctx.state and key not in actor_params:
                            actor_params[key] = ctx.state[key]
                if hasattr(ctx, 'metadata') and ctx.metadata:
                    for key in ('loop_reflections', 'loop_verifier_errors', 'last_draft'):
                        if key in ctx.metadata and key not in actor_params:
                            actor_params[key] = ctx.metadata[key]
                actor_input = AgentInput(params=actor_params)
                if hasattr(actor, 'execute_with_context'):
                    actor_output = await asyncio.wait_for(
                        actor.execute_with_context(actor_input, ctx), timeout=self.STEP_TIMEOUT)
                else:
                    actor_output = await asyncio.wait_for(
                        actor.execute(actor_input), timeout=self.STEP_TIMEOUT)
            except asyncio.TimeoutError:
                logger.warning(f"Reflexion actor timed out at iteration {iteration+1}", task_id=ctx.task_id)
            except Exception as e:
                logger.warning(f"Reflexion actor failed at iteration {iteration+1}: {e}", task_id=ctx.task_id)

            # Fallback: 如果actor失败或返回"LLMTool not available"，直接使用ModelCapability
            if actor_output is None or (actor_output.result.get("output", "") == "LLMTool not available"):
                try:
                    from flowforge.core.model_capability import ModelCapability
                    mc = ModelCapability()
                    memory_text = "\n".join(str(m) for m in memory[-3:]) if memory else ""
                    # P0-1/B2修复：优先使用agent的instructions（contentforge.writer.main等）
                    system_prompt = ""
                    if hasattr(ctx, 'instructions') and ctx.instructions:
                        system_prompt = ctx.instructions
                    else:
                        system_prompt = get_prompt("reflexion.actor", fallback="You are a helpful assistant.")
                    if memory_text:
                        system_prompt += f"\n\n之前的反思和改进建议:\n{memory_text}"
                    persona = ctx.persona or "default"
                    # B4修复：使用真实agent_name而非硬编码reflexion_actor
                    fb_agent_name = getattr(ctx, 'agent_name', None) or "contentforge:writer"
                    # P0-5修复：传递prefer_api
                    fb_prefer_api = False
                    if hasattr(ctx, 'input_data') and ctx.input_data:
                        fb_prefer_api = ctx.input_data.get('prefer_api', False)
                    elif hasattr(ctx, 'metadata') and ctx.metadata:
                        fb_prefer_api = ctx.metadata.get('prefer_api', False)
                    llm_result = await mc.chat(
                        prompt=task[:4000],
                        system=system_prompt,
                        persona=persona,
                        agent_name=fb_agent_name,
                        prefer_api=fb_prefer_api,
                    )
                    actor_output = AgentOutput(result={"output": llm_result.get("content", "")})
                    logger.info(f"Reflexion actor fallback via ModelCapability: len={len(llm_result.get('content', ''))}", task_id=ctx.task_id)
                except Exception as e:
                    logger.warning(f"Reflexion actor ModelCapability fallback failed: {e}", task_id=ctx.task_id)

            # 如果actor失败，跳过该迭代，保留之前的best_result（如果有）
            if actor_output is None or not actor_output.result.get("output"):
                logger.warning(f"Reflexion actor failed at iteration {iteration+1}, skipping")
                continue

            # 从actor输出中提取纯文本内容
            actor_text = self._extract_text(actor_output.result)
            _emit("reflexion.actor", {
                "iteration": iteration + 1,
                "output_preview": actor_text[:300],
            })

            # Evaluator阶段
            try:
                evaluator = ctx.agents.get("reflexion_evaluator") if ctx.agents else None
                if evaluator is None:
                    evaluator = DefaultLLMEvaluator()
                eval_input = AgentInput(params={"output": actor_output.result, "persona": "judge"})
                if hasattr(evaluator, 'execute_with_context'):
                    eval_output = await asyncio.wait_for(
                        evaluator.execute_with_context(eval_input, ctx), timeout=self.STEP_TIMEOUT)
                else:
                    eval_output = await asyncio.wait_for(
                        evaluator.execute(eval_input), timeout=self.STEP_TIMEOUT)
            except (asyncio.TimeoutError, Exception) as e:
                logger.warning(f"Reflexion evaluator failed at iteration {iteration+1}: {e}", task_id=ctx.task_id)
                score = 0.5
                issues = [f"评估超时或失败: {type(e).__name__}"]
                eval_output = type('obj', (object,), {'result': {'score': score, 'issues': issues}})()

            score = eval_output.result.get("score", 0)
            issues = eval_output.result.get("issues", [])
            _emit("reflexion.evaluator", {
                "iteration": iteration + 1, "score": score, "issues": issues,
            })

            if score > best_score:
                best_result = actor_output.result
                best_score = score
                best_text = actor_text
            if score >= self.QUALITY_THRESHOLD:
                _emit("reflexion.quality_passed", {
                    "iteration": iteration + 1, "score": score,
                })
                break

            # Reflector阶段
            try:
                reflector = ctx.agents.get("reflexion_reflector") if ctx.agents else None
                if reflector is None:
                    reflector = DefaultLLMReflector()
                reflect_input = AgentInput(params={"output": actor_output.result, "issues": issues, "persona": ctx.persona or "default"})
                if hasattr(reflector, 'execute_with_context'):
                    reflect_output = await asyncio.wait_for(
                        reflector.execute_with_context(reflect_input, ctx), timeout=self.STEP_TIMEOUT)
                else:
                    reflect_output = await asyncio.wait_for(
                        reflector.execute(reflect_input), timeout=self.STEP_TIMEOUT)
                memory.append(reflect_output.result.get("reflection", ""))
            except (asyncio.TimeoutError, Exception) as e:
                logger.warning(f"Reflexion reflector failed at iteration {iteration+1}: {e}", task_id=ctx.task_id)
                memory.append(f"反思阶段失败: {type(e).__name__}")

            _emit("reflexion.reflector", {
                "iteration": iteration + 1,
                "reflection_preview": str(memory[-1])[:300] if memory else "",
            })

        _emit("reflexion.complete", {
            "iterations": iteration + 1, "best_score": best_score,
        })

        # 使用提取的纯文本而非str(dict)
        final_text = best_text if best_text else (self._extract_text(best_result) if best_result else "")
        _emit("draft.update", {
            "content": final_text, "is_partial": False, "agent_name": "reflexion",
        })

        return {"result": best_result, "score": best_score, "iterations": iteration + 1, "content": final_text}

    @staticmethod
    def _build_rich_task(ctx: TaskContext, base_task: str) -> str:
        """构建富上下文任务描述（P0-6 修复）.

        将 research_materials、persona、platforms、draft 等完整上下文
        拼装到 task 中，确保 LLM 有足够素材生成高质量文章。

        原逻辑只从 topic_list 标题拼接（约167字符），导致 LLM 缺乏素材，
        生成内容空洞、偏题，触发多轮反思重试最终超时。

        Args:
            ctx: TaskContext，包含 input_data 中的完整上下文。
            base_task: 基础任务描述（来自 task/intent/topic_list）。

        Returns:
            富上下文任务描述字符串。
        """
        import json as _json
        sections = [base_task]

        # 人设上下文
        persona = ctx.input_data.get("persona", "") or (ctx.persona or "")
        if persona and persona != "default":
            sections.append(f"\n## 专栏人设\n{persona}")

        # 目标平台
        platforms = ctx.input_data.get("platforms", [])
        if platforms:
            if isinstance(platforms, list):
                platforms_text = "、".join(str(p) for p in platforms)
            else:
                platforms_text = str(platforms)
            sections.append(f"\n## 目标平台\n{platforms_text}")

        # 研究素材（关键上下文，截断到合理长度避免超出 token 限制）
        research_materials = ctx.input_data.get("research_materials", "")
        if research_materials:
            if isinstance(research_materials, (list, dict)):
                try:
                    research_text = _json.dumps(research_materials, ensure_ascii=False, indent=2)
                except Exception:
                    research_text = str(research_materials)
            else:
                research_text = str(research_materials)
            # 截断到 3000 字符，避免 prompt 过长
            if len(research_text) > 3000:
                research_text = research_text[:3000] + "\n...(素材已截断)"
            sections.append(f"\n## 研究素材\n{research_text}")

        # 已有草稿（反思重写场景）
        draft = ctx.input_data.get("draft", "")
        if draft and len(str(draft)) > 10:
            draft_text = str(draft)
            if len(draft_text) > 2000:
                draft_text = draft_text[:2000] + "\n...(草稿已截断)"
            sections.append(f"\n## 上一轮草稿（请在此基础上改进）\n{draft_text}")

        # 选题列表（完整信息，含角度和理由）
        topic_list = ctx.input_data.get("topic_list", [])
        if topic_list and isinstance(topic_list, list):
            topic_lines = []
            for t in topic_list[:5]:
                if isinstance(t, dict):
                    title = t.get("title", "")
                    angle = t.get("angle", t.get("reason", ""))
                    if title:
                        line = f"- {title}"
                        if angle:
                            line += f"（{angle}）"
                        topic_lines.append(line)
                elif t:
                    topic_lines.append(f"- {t}")
            if topic_lines:
                sections.append(f"\n## 选题列表\n" + "\n".join(topic_lines))

        return "\n".join(sections)

    @staticmethod
    def _detect_persona(task: str, current_persona: str = "") -> str:
        if current_persona and current_persona != "default":
            return current_persona
        task_lower = task.lower()
        code_keywords = ["代码", "编程", "写代码", "code", "python", "算法", "函数", "排序", "实现", "程序", "javascript", "java", "rust", "golang"]
        if any(kw in task_lower for kw in code_keywords):
            return "coding"
        return current_persona or "default"

    @staticmethod
    def _extract_text(result) -> str:
        """从agent输出结果中提取纯文本内容，而非dict的字符串表示。"""
        if not result:
            return ""
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            # 优先提取有意义的文本字段
            for key in ("output", "draft", "content", "text", "answer", "response"):
                val = result.get(key)
                if val and isinstance(val, str) and len(val.strip()) > 10:
                    return val
            # 如果没有有意义的文本字段，返回JSON格式
            import json
            return json.dumps(result, ensure_ascii=False)
        return str(result)
