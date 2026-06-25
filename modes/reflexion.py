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
        # 获取任务描述：优先使用task，其次intent，最后从topic_list构建
        task = ctx.input_data.get("task", "") or ctx.input_data.get("intent", "")
        if not task:
            topic_list = ctx.input_data.get("topic_list", [])
            if topic_list and isinstance(topic_list, list):
                titles = [t.get("title", "") if isinstance(t, dict) else str(t) for t in topic_list[:3]]
                task = "创作关于以下选题的文章：" + "、".join(titles)
            persona = ctx.input_data.get("persona", "")
            if persona and task:
                task = f"[{persona}专栏] {task}"
        if not task:
            task = str(ctx.input_data)[:2000]
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
                    system_prompt = get_prompt("reflexion.actor", fallback="You are a helpful assistant.")
                    if memory_text:
                        system_prompt += f"\n\n之前的反思和改进建议:\n{memory_text}"
                    persona = ctx.persona or "default"
                    llm_result = await mc.chat(
                        prompt=task[:2000],
                        system=system_prompt,
                        persona=persona,
                        agent_name="reflexion_actor",
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
