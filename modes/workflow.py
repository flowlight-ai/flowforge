import asyncio
import copy
import json
import re
import time
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import WorkflowRecursionError, StepTimeoutError
from flowforge.core.tracing import get_logger
from flowforge.core.prompt_manager import get_prompt

logger = get_logger("workflow_executor")

_ERROR_KEYWORDS = {"error", "timeout", "timed out", "failed", "不可用", "失败", "超时"}
_ERROR_PREFIX_PATTERNS = [
    "error:", "error：", "failed:", "failed：", "timeout:", "timeout：",
    "超时", "失败", "不可用", "抱歉", "生成失败", "调用失败",
]
# Conversational reply patterns — LLM asking user for clarification instead of
# producing actual content. These indicate the LLM didn't understand the task
# or the prompt was too vague.
_CONVERSATIONAL_PATTERNS = [
    "需要我帮你", "需要我为您", "请提供", "请您提供", "请告诉我",
    "你能告诉我", "你能提供", "你想了解", "您想了解",
    "do you need", "would you like", "please provide", "could you tell",
    "can you provide", "what would you like",
]


def _is_error_content(text: str) -> bool:
    """Check if text is an error message rather than actual content.

    Only considers short text (< 300 chars) that contains error keywords,
    OR text that starts with an error prefix pattern. This avoids filtering
    out valid long-form content that happens to mention error-related terms.
    Also detects conversational replies where the LLM asks for clarification
    instead of producing content.
    """
    text_lower = text.lower().strip()
    if not text_lower:
        return True
    # Long content is very unlikely to be an error message
    if len(text_lower) > 300:
        return False
    # Check if text starts with an error prefix
    for prefix in _ERROR_PREFIX_PATTERNS:
        if text_lower.startswith(prefix.lower()):
            return True
    # Check for conversational reply patterns (LLM asking user for input)
    for pattern in _CONVERSATIONAL_PATTERNS:
        if pattern in text_lower:
            return True
    # For short text, check if it contains error keywords
    return any(kw in text_lower for kw in _ERROR_KEYWORDS)


TASK_TIMEOUT_SECONDS = 1200
STEP_TIMEOUT_SECONDS = 300


class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    capabilities = ["orchestration", "planning"]

    DEFAULT_DEFENSE = {
        "max_tool_calls": 50,
        "tool_timeout": 120,
        "repetition_limit": 3,
        "reflexion_retries": 2,
        "checkpoint_enabled": True,
    }

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data.copy()
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= 3:
            raise WorkflowRecursionError("Max workflow depth exceeded")

        if not sop_steps:
            interaction_mode = ctx.interaction_mode
            if interaction_mode == "normal":
                return await self._execute_normal_chat(ctx, context_data)
            elif interaction_mode == "auto":
                return await self._execute_intelligent_chat(ctx, context_data, is_auto=True)
            else:
                return await self._execute_intelligent_chat(ctx, context_data, is_auto=False)

        return await self._execute_sop_steps(ctx, sop_steps, context_data, depth)

    async def _recall_memories(self, ctx: TaskContext, intent: str) -> list:
        if not ctx.memory:
            return []
        try:
            results = await ctx.memory.hybrid_search(intent, types=["episodic", "long_term"])
            if results:
                logger.info(f"Memory recall: found {len(results)} relevant memories for '{intent[:50]}'")
            return results
        except Exception as e:
            logger.warning(f"Memory recall failed: {e}")
            return []

    async def _save_to_memory(self, ctx: TaskContext, intent: str, result: dict, plan: dict) -> None:
        if not ctx.memory:
            return
        try:
            trace = {
                "task_id": ctx.task_id,
                "intent": intent[:200],
                "mode": ctx.mode,
                "persona": ctx.persona,
                "intent_type": plan.get("intent_type", "chat"),
                "complexity": plan.get("complexity", "simple"),
                "step_count": len(plan.get("plan", [])),
                "response_length": len(str(result.get("response", ""))),
                "status": "completed",
            }
            await ctx.memory.save("episodic", ctx.task_id, trace)
            await ctx.memory.save("working", "last_task", trace)
            if plan.get("intent_type") != "chat":
                await ctx.memory.save("long_term", intent[:100], trace)
            logger.info(f"Memory saved: episodic+working for task {ctx.task_id}")
        except Exception as e:
            logger.warning(f"Memory save failed: {e}")

    async def _execute_sop_steps(self, ctx, sop_steps, context_data, depth):
        defense_config = {**self.DEFAULT_DEFENSE, **ctx.metadata.get("defense", {})}
        ctx.metadata["_defense"] = defense_config
        step_timeout = ctx.metadata.get("step_timeout", STEP_TIMEOUT_SECONDS)

        intent = context_data.get("task", context_data.get("intent", ""))
        recalled = await self._recall_memories(ctx, intent)
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                context_data["_recalled_memories"] = memory_snippets

        if defense_config.get("checkpoint_enabled") and hasattr(ctx, 'checkpoint') and ctx.checkpoint:
            await self._save_checkpoint(ctx, context_data)

        from flowforge.core.workspace import get_workspace_manager as _get_ws_mgr

        for step_idx, step in enumerate(sop_steps):
            # ── Handle parallel_group BEFORE accessing step["name"] ──
            # parallel_group steps don't have a "name" key at the top level,
            # so we must check for them first to avoid KeyError.
            if step.get("parallel_group"):
                pg_label = f"parallel_group_{step_idx}"
                ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                    "step": pg_label, "label": pg_label,
                    "order": step_idx + 1, "total": len(sop_steps),
                })
                try:
                    results = await asyncio.wait_for(
                        self._execute_parallel(ctx, step["parallel_group"], context_data),
                        timeout=step_timeout * len(step["parallel_group"]),
                    )
                    context_data.update(results)
                except asyncio.TimeoutError:
                    logger.warning(f"Parallel group {pg_label} timed out, skipping")
                except Exception as e:
                    logger.error(f"Parallel group {pg_label} failed: {e}")
                    on_error = step.get("on_error", "abort")
                    if on_error != "skip":
                        raise
                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": pg_label})
                continue

            if step.get("prompt"):
                step["prompt"] = self._render_template(step["prompt"], context_data)

            step_name = step.get("name", f"step_{step_idx}")
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": step_name, "label": step_name,
                "order": step_idx + 1, "total": len(sop_steps),
            })

            if step.get("human"):
                auto_approve = ctx.metadata.get("auto_approve_review", False)
                # Solo/Auto模式下自动跳过人工审核步骤（无人审核）
                if not auto_approve and ctx.interaction_mode in ("solo", "auto"):
                    auto_approve = True
                    logger.info(f"Step '{step_name}' is human review, auto-skipping in {ctx.interaction_mode} mode")
                if not auto_approve:
                    await self._pause_for_review(ctx, step)
                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})
                continue

            agent_name = step.get("agent")
            step_mode = step.get("mode")
            force_mode = step.get("force_mode", False)

            # ── Agent execution path ──
            # Priority: if agent_name is specified, try the agent directly.
            # If agent is NOT registered, log warning and fall back to mode executor.
            if agent_name and ctx.agents:
                agent = ctx.agents.get(agent_name)
                if agent:
                    try:
                        merged_data = {**ctx.state, **context_data}
                        agent_input = AgentInput(params=merged_data)
                        agent_output = await asyncio.wait_for(
                            agent.execute_with_context(agent_input, ctx),
                            timeout=step_timeout,
                        )
                        context_data.update(agent_output.result)
                        if step.get("output") and step["output"] not in agent_output.result:
                            context_data[step["output"]] = agent_output.result
                        if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                            ctx.state.update(agent_output.state_updates)
                            context_data.update(agent_output.state_updates)
                    except asyncio.TimeoutError:
                        logger.warning(f"Step '{step_name}' agent '{agent_name}' timed out after {step_timeout}s")
                        on_error = step.get("on_error", "abort")
                        if on_error == "skip":
                            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name, "timed_out": True})
                            continue
                        raise StepTimeoutError(f"Step '{step_name}' agent '{agent_name}' timed out after {step_timeout}s")
                    except Exception as e:
                        on_error = step.get("on_error", "abort")
                        if on_error == "skip":
                            logger.warning(f"Step '{step_name}' agent '{agent_name}' failed, skipping: {e}")
                            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})
                            continue
                        elif on_error == "retry":
                            retry_count = min(step.get("retry_count", 1), 3)
                            for i in range(retry_count):
                                try:
                                    await asyncio.sleep(step.get("retry_delay", 2))
                                    merged_data = {**ctx.state, **context_data}
                                    agent_input = AgentInput(params=merged_data)
                                    agent_output = await asyncio.wait_for(
                                        agent.execute_with_context(agent_input, ctx),
                                        timeout=step_timeout,
                                    )
                                    context_data.update(agent_output.result)
                                    break
                                except asyncio.TimeoutError:
                                    if i == retry_count - 1:
                                        logger.warning(f"Step '{step_name}' retry {i+1} timed out")
                                        if on_error != "skip":
                                            raise StepTimeoutError(f"Step '{step_name}' retry {i+1} timed out after {step_timeout}s")
                                except Exception:
                                    if i == retry_count - 1:
                                        raise
                        elif on_error == "reflexion_retry":
                            reflexion_ctx = TaskContext.from_parent(
                                ctx,
                                input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(e)}"},
                                metadata={"mode": "reflexion"}
                            )
                            reflexion_result = await ctx.executor.run(reflexion_ctx, mode_hint="reflexion", _is_substep=True)
                            context_data["_reflexion_fix"] = reflexion_result
                            retry_count = step.get("retry_count", 2)
                            for i in range(retry_count):
                                try:
                                    merged_data = {**ctx.state, **context_data}
                                    agent_input = AgentInput(params=merged_data)
                                    agent_output = await asyncio.wait_for(
                                        agent.execute_with_context(agent_input, ctx),
                                        timeout=step_timeout,
                                    )
                                    context_data.update(agent_output.result)
                                    if step.get("output") and step["output"] not in agent_output.result:
                                        context_data[step["output"]] = agent_output.result
                                    if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                                        ctx.state.update(agent_output.state_updates)
                                        context_data.update(agent_output.state_updates)
                                    break
                                except asyncio.TimeoutError:
                                    if i == retry_count - 1:
                                        logger.warning(f"Step '{step_name}' reflexion retry {i+1} timed out")
                                        raise StepTimeoutError(f"Step '{step_name}' reflexion retry timed out after {step_timeout}s")
                                except Exception:
                                    if i == retry_count - 1:
                                        raise
                        else:
                            raise
                    ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})
                    continue
                else:
                    # Agent not registered — log warning and fall through to mode executor
                    logger.warning(
                        f"Step '{step_name}' specifies agent '{agent_name}' but it is not registered. "
                        f"Falling back to mode executor with mode='{step_mode or 'plan_execute'}'"
                    )

            # ── Mode executor path (no agent, or agent not registered) ──
            mode = step.get("mode", "plan_execute")
            if mode == "workflow":
                raise ValueError("Nested workflow mode is forbidden")

            sub_input_data = {**context_data}
            if agent_name:
                sub_input_data["_target_agent"] = agent_name
            sub_ctx = TaskContext.from_parent(ctx, input_data=sub_input_data,
                                              metadata={"_workflow_depth": depth + 1})
            try:
                sub_result = await asyncio.wait_for(
                    ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True),
                    timeout=step_timeout,
                )
                context_data[step.get("output", step_name)] = sub_result
            except asyncio.TimeoutError:
                logger.warning(f"Step '{step_name}' mode executor timed out after {step_timeout}s")
                on_error = step.get("on_error", "abort")
                if on_error == "skip":
                    ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name, "timed_out": True})
                    continue
                raise StepTimeoutError(f"Step '{step_name}' mode executor timed out after {step_timeout}s")
            except Exception as e:
                on_error = step.get("on_error", "abort")
                if on_error == "skip":
                    continue
                elif on_error == "reflexion_retry":
                    reflexion_ctx = TaskContext.from_parent(
                        ctx,
                        input_data={"task": f"分析步骤'{step['name']}'失败原因并修正: {str(e)}"},
                        metadata={"mode": "reflexion"}
                    )
                    reflexion_result = await ctx.executor.run(reflexion_ctx, mode_hint="reflexion", _is_substep=True)
                    context_data["_reflexion_fix"] = reflexion_result
                    retry_count = step.get("retry_count", 2)
                    for i in range(retry_count):
                        try:
                            sub_result = await asyncio.wait_for(
                                ctx.executor.run(sub_ctx, mode_hint=step.get("mode"), _is_substep=True),
                                timeout=step_timeout,
                            )
                            context_data[step.get("output", step_name)] = sub_result
                            break
                        except asyncio.TimeoutError:
                            if i == retry_count - 1:
                                logger.warning(f"Step '{step_name}' reflexion retry {i+1} timed out")
                                raise StepTimeoutError(f"Step '{step_name}' reflexion retry timed out after {step_timeout}s")
                        except Exception:
                            if i == retry_count - 1:
                                raise
                else:
                    raise

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})

            try:
                _ws_mgr = _get_ws_mgr()
                _ws_mgr.save_checkpoint(ctx.task_id, {
                    "step_idx": step_idx,
                    "step_name": step_name,
                    "context_data_keys": list(context_data.keys()),
                    "sop_steps_total": len(sop_steps),
                })
            except Exception:
                pass

        await self._save_to_memory(ctx, intent, context_data, {"intent_type": "sop", "plan": sop_steps})
        return context_data

    async def _execute_normal_chat(self, ctx: TaskContext, context_data: dict) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")
        persona = ctx.persona or "default"

        recalled = await self._recall_memories(ctx, intent)

        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "normal_chat", "label": "普通对话", "order": 1, "total": 1,
        })

        system_prompt = get_prompt("response.normal")
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": intent}]
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                messages.insert(1, {"role": "system", "content": f"相关历史记忆：\n" + "\n".join(memory_snippets)})

        result_content = ""
        try:
            result_content = await self._call_llm(ctx, messages, model_hint, "normal_assistant", persona)
        except Exception as e:
            logger.error(f"Normal chat LLM call failed: {e}")
            result_content = f"AI 调用失败: {str(e)[:200]}"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "normal_chat"})
        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": result_content, "is_partial": False, "agent_name": "solo_assistant",
        })

        result = {**context_data, "response": result_content}
        await self._save_to_memory(ctx, intent, result, {"intent_type": "chat", "plan": []})
        return result

    async def _execute_intelligent_chat(self, ctx: TaskContext, context_data: dict, is_auto: bool = False) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")
        persona = ctx.persona or "default"
        mode_label = "全自动" if is_auto else "Solo"

        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= 3:
            raise WorkflowRecursionError("Max workflow depth exceeded in intelligent_chat")

        is_simple = self._is_simple_message(intent)
        logger.info(f"Fast-path check: intent='{intent[:50]}', is_simple={is_simple}, is_auto={is_auto}")
        if is_simple:
            logger.info(f"Fast-path: simple message detected, skipping planning for '{intent[:30]}'")
            return await self._simple_response(ctx, context_data, model_hint, persona, intent)

        recalled = await self._recall_memories(ctx, intent)

        # ── Stage 1: Plan ──
        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "planning", "label": f"{mode_label}意图识别",
            "order": 1, "stage": "planning",
        })

        tool_descriptions = self._build_tool_descriptions_text(ctx)
        planning_prompt = get_prompt("planning.system", tool_descriptions=tool_descriptions)
        plan_messages = [{"role": "system", "content": planning_prompt}, {"role": "user", "content": intent}]
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                plan_messages.insert(1, {"role": "system", "content": f"相关历史记忆：\n" + "\n".join(memory_snippets)})

        plan_content = ""
        try:
            plan_content = await self._call_llm(ctx, plan_messages, model_hint, "planner", persona)
        except Exception as e:
            logger.warning(f"Planning LLM call failed: {e}")

        plan = self._parse_execution_plan(plan_content)
        steps = plan.get("plan", [])
        intent_type = plan.get("intent_type", "chat")

        # ── Fallback: if planner returned empty plan, infer intent from user input ──
        if not steps:
            # First: try to infer intent_type from user's original input
            inferred_type = self._infer_intent_type_from_text(intent)
            if inferred_type != "chat":
                # Override intent_type when inferred type is more specific
                # (e.g., planner said "write" but user input has "python"/"算法" → "code")
                if intent_type == "chat" or (inferred_type != intent_type and inferred_type != "chat"):
                    intent_type = inferred_type
                    plan["intent_type"] = inferred_type
                    plan["complexity"] = "medium"
                    logger.info(f"Planner returned {plan.get('intent_type', 'chat')} but user intent looks like {inferred_type}, overriding")

            # Second: if intent_type is not chat, infer steps from template
            if intent_type not in ("chat",):
                inferred_steps = self._infer_steps_from_intent(intent_type, intent)
                if inferred_steps:
                    steps = inferred_steps
                    plan["plan"] = steps
                    logger.info(f"Inferred {len(steps)} steps for intent_type={intent_type}")
        elif intent_type == "chat":
            inferred_type = self._infer_intent_type_from_text(intent)
            if inferred_type != "chat" and inferred_type in ("creation", "research", "write", "code"):
                intent_type = inferred_type
                plan["intent_type"] = inferred_type
                inferred_steps = self._infer_steps_from_intent(inferred_type, intent)
                if inferred_steps:
                    steps = inferred_steps
                    plan["plan"] = steps
                    logger.info(f"Overriding chat→{inferred_type} based on user input keywords")

        # Emit plan summary via step.intermediate (compact, avoid showing raw LLM output)
        plan_summary = plan.get("summary", intent_type)
        step_count = len(steps)

        # ── Compound intent detection: append missing steps for compound requests ──
        if steps:
            intent_lower = intent.lower()
            step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
            all_steps_text = " ".join(step_names_lower)

            # Check for missing translation step when user mentions "翻译"
            if any(kw in intent_lower for kw in ["翻译", "translate"]):
                has_translate = any("翻译" in s or "translat" in s or "multilingual" in s for s in step_names_lower)
                if not has_translate:
                    translate_step = {"name": "翻译文本", "type": "agent", "agent": "multilingual",
                                     "input": {"query": intent, "topic": intent, "task": intent},
                                     "description": "翻译文本"}
                    steps.append(translate_step)
                    step_count = len(steps)
                    logger.info(f"Compound intent: added translation step for '翻译' in user input")

            # Check for missing search step when user mentions "搜索/调研"
            if any(kw in intent_lower for kw in ["搜索", "调研", "研究", "search", "research"]):
                has_search = any("搜索" in s or "search" in s or "web_search" in s or "research" in s for s in step_names_lower)
                if not has_search:
                    search_step = {"name": "搜索信息", "type": "tool", "tool": "web_search",
                                   "input": {"query": intent, "topic": intent, "task": intent},
                                   "description": "搜索相关信息"}
                    steps.insert(0, search_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added search step for '搜索/调研' in user input")

            # Check for missing writing step when user mentions "写/文章/分析"
            if any(kw in intent_lower for kw in ["写", "文章", "撰写", "分析", "write", "article"]):
                has_writing = any("撰写" in s or "写作" in s or "writing" in s or "article_writing" in s for s in step_names_lower)
                if not has_writing:
                    write_step = {"name": "撰写内容", "type": "agent", "agent": "article_writing",
                                  "input": {"query": intent, "topic": intent, "task": intent},
                                  "description": "撰写文章内容"}
                    steps.append(write_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added writing step for '写/文章' in user input")

                has_eval = any("评估" in s or "eval" in s or "article_eval" in s for s in step_names_lower)
                if not has_eval:
                    eval_step = {"name": "文章评估", "type": "agent", "agent": "article_eval",
                                 "input": {"query": intent, "topic": intent, "task": intent},
                                 "description": "评估文章质量"}
                    steps.append(eval_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added eval step for '写/文章' in user input")

                has_audit = any("审核" in s or "audit" in s or "content_audit" in s for s in step_names_lower)
                if not has_audit:
                    audit_step = {"name": "内容审核", "type": "agent", "agent": "content_audit",
                                  "input": {"query": intent, "topic": intent, "task": intent},
                                  "description": "内容合规审核"}
                    steps.append(audit_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added audit step for '写/文章' in user input")

            # Check for missing code step when user mentions "代码/编程/写代码"
            if any(kw in intent_lower for kw in ["代码", "编程", "写代码", "code", "python", "算法"]):
                has_code = any("代码" in s or "code" in s or "code_writer" in s for s in step_names_lower)
                if not has_code:
                    code_step = {"name": "编写代码", "type": "agent", "agent": "code_writer",
                                 "input": {"query": intent, "topic": intent, "task": intent},
                                 "description": "编写代码"}
                    steps.append(code_step)
                    step_count = len(steps)
                    step_names_lower = [s.get("name", "").lower() + s.get("agent", "").lower() + s.get("tool", "").lower() for s in steps]
                    logger.info(f"Compound intent: added code step for '代码/编程' in user input")

        if step_count > 0:
            step_names = [s.get("name", s.get("step", "")) for s in steps[:5]]
            plan_label = f"规划完成: {plan_summary} (共{step_count}步) → {' → '.join(step_names)}"
            if step_count > 5:
                plan_label += f" ...+{step_count-5}"
        else:
            plan_label = f"规划完成: {plan_summary or '简单对话'} (无需分步)"

        ctx.event_bus.emit(ctx.task_id, "step.intermediate", {
            "step_name": plan_label,
            "content": "",
            "stage": "planning",
        })

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
            "step": "planning",
            "intent_type": plan.get("intent_type", "chat"),
            "complexity": plan.get("complexity", "simple"),
            "step_count": step_count,
        })

        # ── Stage 2: Execute ──
        if not steps:
            # === SIMPLE: single LLM call ===
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "response", "label": "生成回复",
                "order": 2, "stage": "response",
            })

            response_prompt = get_prompt("response.simple")
            response_messages = [
                {"role": "system", "content": response_prompt},
                {"role": "user", "content": intent},
            ]

            final_content = ""
            try:
                final_content = await self._call_llm(ctx, response_messages, model_hint, "solo_assistant", persona)
            except Exception as e:
                final_content = f"生成回复失败: {str(e)[:200]}"

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "response"})
        else:
            # === MULTI-STEP: execute each step ===
            # Auto-assign agents based on intent_type when planner didn't specify
            _INTENT_AGENT_MAP = {
                "creation": "article_writing",
                "code": "code_writer_agent",
                "write": "article_writing",
                "research": "research_agent",
                "translate": "multilingual",
            }
            detected_intent = plan.get("intent_type", "chat")
            for step in steps:
                if not step.get("agent") and not step.get("tool"):
                    step_type = step.get("type", "generate")
                    if step_type == "generate" and detected_intent in _INTENT_AGENT_MAP:
                        # Auto-assign the appropriate agent for this intent type
                        step["agent"] = _INTENT_AGENT_MAP[detected_intent]
                        step["type"] = "agent"
                        logger.info(f"Auto-assigned agent '{step['agent']}' for intent_type='{detected_intent}' step '{step.get('name', '')}'")

            step_results = []
            step_context = {}  # Accumulated outputs from previous steps
            step_order = 2
            for step in steps:
                step_name = step.get("name", step.get("step", f"步骤{step_order-1}"))
                step_type = step.get("type", "generate")
                agent_name = step.get("agent", "")
                tool_name = step.get("tool", "")
                step_input = step.get("input", step.get("params", {}))
                step_desc = step.get("description", "")

                # Merge accumulated step context into step input
                # This allows subsequent steps (e.g., multilingual) to access
                # outputs from previous steps (e.g., article_writing)
                if step_input and step_context:
                    merged_input = {**step_input}
                    if agent_name == "multilingual" and "text" not in merged_input:
                        best_text = self._find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["text"] = best_text
                            merged_input["draft"] = best_text
                            logger.info(f"Multilingual step: passing previous step output as text ({len(best_text)} chars)")
                    if agent_name == "article_writing":
                        best_text = self._find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["materials"] = [{"content": best_text[:3000]}]
                            merged_input["draft"] = best_text
                            logger.info(f"ArticleWriting step: passing previous step output as materials ({len(best_text)} chars)")
                    if agent_name in ("article_eval", "article_reflect", "content_audit", "fact_check"):
                        best_text = self._find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["draft"] = best_text
                            logger.info(f"{agent_name} step: passing previous step output as draft ({len(best_text)} chars)")
                        if agent_name == "article_reflect":
                            eval_output = step_context.get("_output_article_eval", "")
                            if eval_output:
                                try:
                                    import json as _json
                                    eval_data = _json.loads(eval_output) if isinstance(eval_output, str) else eval_output
                                    merged_input["issues"] = eval_data.get("issues", []) if isinstance(eval_data, dict) else []
                                except Exception:
                                    pass
                    if agent_name == "code_writer":
                        best_text = self._find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["reference"] = best_text[:2000]
                        merged_input.setdefault("requirements", intent)
                    if agent_name == "code_writer_agent":
                        best_text = self._find_best_text_in_context(step_context)
                        if best_text:
                            merged_input["reference"] = best_text[:2000]
                        merged_input.setdefault("requirements", intent)
                    step_input = merged_input
                elif not step_input and step_context:
                    step_input = {"topic": intent, "task": intent, "query": intent, **step_context}

                ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                    "step": step_name, "label": step_name,
                    "order": step_order, "stage": step_name,
                })
                step_order += 1

                if step_type == "tool" or (tool_name and not agent_name):
                    # ── Tool call ──
                    tn = tool_name or step_name
                    ctx.event_bus.emit(ctx.task_id, "tool.start", {
                        "tool_name": tn,
                        "input": step_input or {"query": intent},
                        "step": step_name,
                    })

                    try:
                        result = await self._execute_tool_or_agent(ctx, tn, step_input or {"query": intent})
                    except Exception as e:
                        result = {"success": False, "error": str(e)[:300]}

                    ctx.event_bus.emit(ctx.task_id, "tool.end", {
                        "tool_name": tn,
                        "result": result,
                        "success": result.get("success", False),
                        "step": step_name,
                    })
                    # If search tool returned no results and marked as unavailable,
                    # add a hint for the compile stage to use LLM's own knowledge
                    if isinstance(result, dict) and result.get("search_available") is False:
                        step_results.append({
                            "step": step_name, "type": "tool", "tool": tn,
                            "result": result,
                            "search_unavailable": True,
                            "hint": "搜索服务不可用，请用LLM自身知识回答",
                        })
                    else:
                        step_results.append({"step": step_name, "type": "tool", "tool": tn, "result": result})
                        # Update step_context with extracted content for subsequent steps
                        if result.get("success"):
                            extracted = self._extract_step_content({"step": step_name, "type": "tool", "result": result})
                            if extracted and len(extracted.strip()) > 10:
                                step_context[f"_output_{tn}"] = extracted
                                step_context["_last_output"] = extracted

                elif step_type == "agent" or agent_name:
                    # ── Agent call ──
                    an = agent_name or step_name
                    ctx.event_bus.emit(ctx.task_id, "tool.start", {
                        "tool_name": an,
                        "input": step_input or {"topic": intent, "task": intent},
                        "step": step_name,
                        "is_agent": True,
                    })

                    agent_input = step_input or {"topic": intent, "task": intent, "query": intent}
                    try:
                        result = await self._execute_tool_or_agent(ctx, an, agent_input)
                    except Exception as e:
                        result = {"success": False, "error": str(e)[:300]}

                    ctx.event_bus.emit(ctx.task_id, "tool.end", {
                        "tool_name": an,
                        "result": result,
                        "success": result.get("success", False),
                        "step": step_name,
                        "is_agent": True,
                    })
                    step_results.append({"step": step_name, "type": "agent", "agent": an, "result": result})
                    # Update step_context with extracted content for subsequent steps
                    if result.get("success"):
                        extracted = self._extract_step_content({"step": step_name, "type": "agent", "result": result})
                        if extracted and len(extracted.strip()) > 10:
                            step_context[f"_output_{an}"] = extracted
                            step_context["_last_output"] = extracted

                else:
                    # ── Generate (LLM) ──
                    # Build a specific prompt based on intent_type and step description
                    intent_type = plan.get("intent_type", "chat")
                    step_persona = persona
                    if any(kw in step_name.lower() for kw in ["audit", "review", "fact_check", "judge", "eval"]):
                        step_persona = "judge"
                    if intent_type == "translate":
                        system_prompt = "你是一个专业翻译。请准确翻译用户提供的文本，保持原文的语气和格式。直接输出翻译结果，不要添加解释。"
                    elif intent_type == "code":
                        system_prompt = "你是一个编程专家。请编写高质量的代码，并简要解释算法原理。使用markdown代码块格式。"
                    else:
                        system_prompt = f"你正在执行「{step_name}」。请给出详细、完整的回复，不要反问用户，直接输出内容。"

                    # Build user prompt: include previous step results for context
                    prompt = step_desc or intent
                    if step_context:
                        # Include accumulated context from previous steps
                        context_parts = []
                        for key, val in step_context.items():
                            if isinstance(val, str) and len(val.strip()) > 20 and key.startswith("_output_"):
                                context_parts.append(f"【{key}】\n{val[:2000]}")
                        if context_parts:
                            prompt = f"以下是之前步骤的结果：\n\n{''.join(context_parts)}\n\n请基于以上信息，{prompt}"
                    gen_messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ]

                    gen_content = ""
                    try:
                        gen_content = await self._call_llm(ctx, gen_messages, model_hint, step_name, step_persona)
                    except Exception as e:
                        gen_content = f"生成失败: {str(e)[:200]}"

                    ctx.event_bus.emit(ctx.task_id, "step.intermediate", {
                        "step_name": step_name,
                        "content": gen_content[:1000],
                    })
                    step_results.append({"step": step_name, "type": "generate", "content": gen_content})
                    if gen_content and len(gen_content.strip()) > 10:
                        step_context[f"_output_{step_name}"] = gen_content
                        step_context["_last_output"] = gen_content

                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                    "step": step_name, "success": True,
                })

            # ── Compile: synthesize step results into final content ──
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "compile", "label": "整理输出",
                "order": step_order, "stage": "compile",
            })

            # Debug: log each step result's extracted content
            for i, sr in enumerate(step_results):
                extracted = self._extract_step_content(sr)
                is_err = _is_error_content(extracted) if extracted else True
                logger.info(
                    f"Compile step_result[{i}]: step={sr.get('step')}, type={sr.get('type')}, "
                    f"agent={sr.get('agent')}, extracted_len={len(extracted) if extracted else 0}, "
                    f"is_error={is_err}, preview={extracted[:100] if extracted else 'None'}"
                )

            # Check if search was unavailable or any step failed — if so, tell compile LLM to use its own knowledge
            search_unavailable = any(sr.get("search_unavailable") for sr in step_results)
            any_step_failed = any(
                isinstance(sr.get("result"), dict) and sr["result"].get("success") is False
                for sr in step_results if sr.get("type") in ("agent", "tool")
            )
            any_step_error = any(
                "error" in str(sr.get("result", "")).lower() or "timeout" in str(sr.get("result", "")).lower()
                for sr in step_results
            )
            collected_json = json.dumps(step_results, ensure_ascii=False)[:6000]

            # When search is unavailable, try to use step results directly first
            # to avoid another slow LLM call that may return short content due to
            # web chat conversation history interference
            final_content = ""
            valid_step_parts = []
            _QUALITY_CHECK_AGENTS = {"article_eval", "article_reflect", "content_audit", "fact_check"}
            for sr in step_results:
                if sr.get("search_unavailable"):
                    continue
                if sr.get("agent") in _QUALITY_CHECK_AGENTS:
                    continue
                c = self._extract_step_content(sr)
                if c and len(c.strip()) > 20 and not _is_error_content(c):
                    valid_step_parts.append(c)

            if valid_step_parts:
                final_content = "\n\n".join(valid_step_parts)
                logger.info(f"Compile: using {len(valid_step_parts)} step results directly ({len(final_content)} chars), skipping LLM call")

            # Single LLM call fallback: only if step results are insufficient
            if len(final_content.strip()) < 50:
                if search_unavailable or any_step_failed or any_step_error:
                    compile_system = (
                        "搜索服务暂不可用，无法获取实时信息。请基于你自身的知识和训练数据，"
                        "尽可能完整、详细地回答用户的问题。如果问题涉及近期事件，"
                        "请说明你的知识截止日期，并基于已有信息给出最佳回答。"
                        "⚠️ 重要：在回答开头明确标注「以下内容基于AI自身知识生成，未经实时搜索验证」。"
                    )
                    response_messages = [
                        {"role": "system", "content": compile_system},
                        {"role": "user", "content": intent},
                    ]
                else:
                    response_prompt = get_prompt("response.solo",
                        intent=intent, collected_context=collected_json)
                    response_messages = [
                        {"role": "system", "content": response_prompt},
                        {"role": "user", "content": f"请根据以上信息完成用户的任务：{intent}"},
                    ]

                try:
                    final_content = await self._call_llm(ctx, response_messages, model_hint, "solo_assistant", persona)
                except Exception as e:
                    logger.error(f"Compile LLM call failed: {e}")
                    final_content = ""

            # Last resort: if LLM also failed, try step results with lower threshold
            if len(final_content.strip()) < 50 and valid_step_parts:
                final_content = "\n\n".join(valid_step_parts)
                logger.info(f"Compile: LLM insufficient, using {len(valid_step_parts)} step results ({len(final_content)} chars)")
            elif len(final_content.strip()) < 50:
                final_content = "抱歉，处理您的请求时遇到了问题。请稍后重试。"

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "compile"})

        # ── Stage 3: Save to workspace files (only for genuinely long content) ──
        LONG_CONTENT_THRESHOLD = 800
        if final_content and len(final_content) > LONG_CONTENT_THRESHOLD:
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                "step": "save", "label": "保存文件",
                "order": 99, "stage": "save",
            })

            safe_intent = re.sub(r'[^\w\u4e00-\u9fff]', '_', intent[:30]).strip('_') or "output"
            filename = f"{safe_intent}.md"

            from flowforge.core.workspace import get_workspace_manager
            ws = get_workspace_manager()
            file_info = ws.save_content_file(ctx.task_id, filename, final_content)

            if file_info:
                ctx.event_bus.emit(ctx.task_id, "draft.file", {
                    "filename": file_info["filename"],
                    "path": file_info["path"],
                    "size": file_info["size"],
                    "file_path": f"/api/v1/workspace/{ctx.task_id}/files/{file_info['path']}",
                })

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                "step": "save", "file_info": file_info,
            })

        # ── Final draft update (single source of truth for AI content) ──
        draft_payload = {
            "content": final_content,
            "is_partial": False,
            "agent_name": "solo_assistant",
        }
        if final_content and len(final_content) > LONG_CONTENT_THRESHOLD:
            draft_payload["saved_to_file"] = True
            draft_payload["content_preview"] = final_content[:300] + "..."
        ctx.event_bus.emit(ctx.task_id, "draft.update", draft_payload)

        result = {
            **context_data,
            "response": final_content,
            "plan": plan,
        }
        await self._save_to_memory(ctx, intent, result, plan)
        return result

    async def _run_react_loop(self, ctx: TaskContext, intent: str,
                               tool_schemas: list, model_hint: str, persona: str) -> dict:
        defense_config = ctx.metadata.get("_defense", self.DEFAULT_DEFENSE)
        max_tool_calls = defense_config.get("max_tool_calls", 50)
        tool_timeout = defense_config.get("tool_timeout", 120)
        repetition_limit = defense_config.get("repetition_limit", 3)

        tool_desc_text = self._build_tool_descriptions_text(ctx)
        system_prompt = get_prompt("react.orchestrator", tool_descriptions=tool_desc_text)

        all_messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": intent}]

        execution_trace = []
        collected_context = ""
        tool_calls_made = 0
        tool_call_history = []
        max_iterations = 3
        iteration = -1

        for iteration in range(max_iterations):
            if tool_calls_made >= max_tool_calls:
                logger.warning(f"Tool call limit reached: {tool_calls_made}/{max_tool_calls}")
                break

            if len(all_messages) > 10:
                all_messages = [all_messages[0]] + all_messages[-8:]

            llm_params = {
                "messages": all_messages,
                "stream": False,
                "persona": persona,
                "agent_name": "react_orchestrator",
                "task_id": ctx.task_id,
            }
            if tool_schemas:
                llm_params["tools"] = tool_schemas
            if model_hint and model_hint != "auto":
                llm_params["model"] = model_hint

            tool_input = ToolInput(params=llm_params)
            try:
                tool_output = await ctx.tools.execute("llm", tool_input)
            except Exception as e:
                logger.error(f"ReAct LLM call failed: {e}")
                break

            if not tool_output or not tool_output.result:
                break

            result = tool_output.result
            content_text = result.get("content", "")
            tool_calls = result.get("tool_calls")
            raw_message = result.get("raw_message")

            if not tool_calls:
                if content_text:
                    collected_context += f"\n\n{content_text[:2000]}"
                break

            assistant_msg = raw_message if raw_message else {"role": "assistant", "content": content_text}
            if "role" not in assistant_msg:
                assistant_msg["role"] = "assistant"
            all_messages.append(assistant_msg)

            if content_text:
                collected_context += f"\n\n## 思考\n{content_text[:500]}"

            for tool_call in tool_calls:
                if tool_calls_made >= max_tool_calls:
                    logger.warning(f"Tool call limit reached during tool_calls processing")
                    break

                func_info = tool_call.get("function", {})
                call_name = func_info.get("name", "")
                arguments_str = func_info.get("arguments", "{}")
                tool_call_id = tool_call.get("id", "")

                try:
                    arguments = json.loads(arguments_str) if isinstance(arguments_str, str) else arguments_str
                except json.JSONDecodeError:
                    arguments = {}

                ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
                    "step": call_name, "label": f"调用 {call_name}",
                    "stage": call_name, "iteration": iteration + 1,
                })

                tool_result = await self._execute_tool_or_agent(ctx, call_name, arguments)

                tool_call_history.append(call_name)
                if len(tool_call_history) >= repetition_limit:
                    recent = tool_call_history[-repetition_limit:]
                    if len(set(recent)) == 1:
                        logger.warning(f"ReAct loop detected: {call_name} called {repetition_limit} times in a row, forcing stop")
                        collected_context += f"\n\n## {call_name} 已完成（检测到重复调用，自动终止）"
                        break

                tool_result_content = json.dumps(tool_result, ensure_ascii=False)[:1500]
                all_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": tool_result_content,
                })

                tool_calls_made += 1

                if tool_result.get("success"):
                    result_data = tool_result.get("result", {})
                    result_summary = json.dumps(result_data, ensure_ascii=False)[:1000]
                    collected_context += f"\n\n## {call_name} 结果\n{result_summary}"
                else:
                    collected_context += f"\n\n## {call_name} 失败\n{tool_result.get('error', '未知错误')}"

                execution_trace.append({
                    "iteration": iteration + 1,
                    "name": call_name,
                    "success": tool_result.get("success", False),
                })

                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {
                    "step": call_name,
                    "success": tool_result.get("success", False),
                })

        return {
            "iterations": iteration + 1,
            "tool_calls_made": tool_calls_made,
            "collected_context": collected_context,
            "execution_trace": execution_trace,
        }

    async def _execute_tool_or_agent(self, ctx: TaskContext, name: str, arguments: dict) -> dict:
        if ctx.agents:
            agent = ctx.agents.get(name)
            if agent:
                try:
                    task_desc = arguments.get("task", arguments.get("query", arguments.get("intent", str(arguments))))
                    agent_input = AgentInput(params={"task": task_desc, **arguments})
                    # 发射 agent.start 事件
                    ctx.event_bus.emit(ctx.task_id, "agent.start", {"agent_name": name, "task": task_desc[:200]})
                    result = await agent.execute_with_context(agent_input, ctx)
                    # 发射 agent.end 事件
                    ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": True})
                    return {"success": True, "result": result.result}
                except NotImplementedError:
                    try:
                        agent_input = AgentInput(params={"task": task_desc, **arguments})
                        result = await agent.execute(agent_input)
                        ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": True})
                        return {"success": True, "result": result.result}
                    except Exception as e:
                        ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": False, "error": str(e)[:200]})
                        return {"success": False, "error": str(e)[:300]}
                except Exception as e:
                    logger.warning(f"Agent {name} execution failed: {e}")
                    error_msg = str(e) if str(e) else type(e).__name__
                    ctx.event_bus.emit(ctx.task_id, "agent.end", {"agent_name": name, "success": False, "error": error_msg[:200]})
                    return {"success": False, "error": error_msg[:300]}

        if ctx.tools:
            try:
                tool = ctx.tools.get_tool(name)
                # 兼容 BaseTool (execute(ToolInput)) 和 ToolPlugin (execute(dict))
                from flowforge.core.base_tool import BaseTool
                if isinstance(tool, BaseTool):
                    tool_input = ToolInput(params=arguments)
                    tool_output = await tool.execute(tool_input)
                    return {"success": True, "result": tool_output.result}
                else:
                    # ToolPlugin — execute 接收 dict
                    result = await tool.execute(arguments)
                    return {"success": True, "result": result}
            except Exception as e:
                logger.debug(f"Tool {name} execution in ToolRegistry failed: {e}, trying PluginRegistry")

        # Fallback: try PluginRegistry (for tools like web_search that are registered as plugins)
        try:
            from flowforge.app.deps import get_plugin_registry
            plugin_reg = get_plugin_registry()
            if plugin_reg:
                plugin = plugin_reg.get_plugin(name)
                if plugin:
                    result = await plugin_reg.execute(name, arguments)
                    return {"success": True, "result": result}
        except Exception as e:
            logger.debug(f"Plugin {name} not found in PluginRegistry either: {e}")

        return {"success": False, "error": f"Unknown tool/agent: {name}"}

    def _build_function_schemas(self, ctx: TaskContext) -> list:
        schemas = []
        if ctx.tools:
            try:
                for name in ctx.tools.list_tools():
                    if name in ("llm", "shell_command"):
                        continue
                    try:
                        tool = ctx.tools.get_tool(name)
                        desc = getattr(tool, 'description', '') or name
                        params = getattr(tool, 'parameters_schema', None) or {
                            "type": "object",
                            "properties": {"query": {"type": "string", "description": "查询内容"}},
                        }
                        schemas.append({
                            "type": "function",
                            "function": {"name": name, "description": desc[:200], "parameters": params},
                        })
                    except Exception:
                        continue
            except Exception:
                pass
        if len(schemas) > 8:
            schemas = schemas[:8]
        return schemas

    def _build_tool_descriptions_text(self, ctx: TaskContext) -> str:
        lines = []
        # Include agents
        if ctx.agents:
            try:
                for name in ctx.agents.list_agents():
                    try:
                        agent = ctx.agents.get(name)
                        desc = getattr(agent, 'description', '') or ''
                        lines.append(f"- **{name}** (Agent): {desc}")
                    except Exception:
                        lines.append(f"- **{name}** (Agent)")
            except Exception:
                pass
        # Include tools
        if ctx.tools:
            try:
                for name in ctx.tools.list_tools():
                    if name == "llm":
                        continue
                    try:
                        tool = ctx.tools.get_tool(name)
                        desc = getattr(tool, 'description', '') or ''
                        lines.append(f"- **{name}** (Tool): {desc}")
                    except Exception:
                        lines.append(f"- **{name}** (Tool)")
            except Exception:
                pass
        return "\n".join(lines) if lines else "无可用工具"

    async def _call_llm(self, ctx: TaskContext, messages: list, model_hint: str,
                         agent_name: str = "solo_assistant", persona: str = "default") -> str:
        llm_params = {
            "messages": messages,
            "stream": False,
            "persona": persona,
            "agent_name": agent_name,
            "task_id": ctx.task_id,
        }
        if model_hint and model_hint != "auto":
            llm_params["model"] = model_hint

        if ctx.tools:
            tool_input = ToolInput(params=llm_params)
            tool_output = await ctx.tools.execute("llm", tool_input)
            content = tool_output.result.get("content", "") if tool_output.result else ""
            # 检测LLM失败：error非空或content为空
            if tool_output.error and not content:
                logger.warning(f"_call_llm LLM failed: {tool_output.error[:200]}", task_id=ctx.task_id)
            return content
        else:
            from flowforge.tools.llm_client import LLMClient
            llm = LLMClient(event_bus=ctx.event_bus)
            tool_input = ToolInput(params=llm_params)
            tool_output = await llm.execute(tool_input)
            content = tool_output.result.get("content", "") if tool_output.result else ""
            if tool_output.error and not content:
                logger.warning(f"_call_llm LLM failed (no ctx.tools): {tool_output.error[:200]}", task_id=ctx.task_id)
            return content

    def _parse_execution_plan(self, content: str) -> dict:
        """Robust JSON extraction from potentially malformed LLM output.
        
        Handles: JSON inside markdown blocks, extra text before/after JSON,
        conversational responses (treats as simple chat), and partial JSON.
        Also handles LLM outputting intent classification without full plan
        by inferring steps from intent_type.
        """
        if not content or not content.strip():
            return {"intent_type": "chat", "complexity": "simple", "plan": []}

        cleaned = content.strip()

        # Strip markdown code blocks
        for marker in ["```json", "```JSON", "```"]:
            if marker in cleaned:
                start = cleaned.find(marker) + len(marker)
                end = cleaned.rfind("```")
                if end > start:
                    cleaned = cleaned[start:end].strip()
                else:
                    cleaned = cleaned[start:].strip()
                break

        # Try direct JSON parse
        try:
            json_match = re.search(r'\{[\s\S]*\}', cleaned)
            if json_match:
                candidate = json_match.group()
                plan = json.loads(candidate)
                if "plan" in plan or "intent_type" in plan:
                    # Normalize: ensure 'plan' is a list
                    if not isinstance(plan.get("plan"), list):
                        plan["plan"] = []
                    # Validate plan steps have required fields
                    validated_steps = []
                    for step in plan.get("plan", []):
                        if isinstance(step, dict):
                            step_name = step.get("name") or step.get("step")
                            if step_name:
                                if "name" not in step:
                                    step["name"] = step_name
                                validated_steps.append(step)
                    plan["plan"] = validated_steps
                    return plan
        except (json.JSONDecodeError, KeyError, ValueError):
            pass

        # If content looks like conversational text (not JSON-like), treat as simple chat
        if len(content) > 100 and '{' not in content:
            logger.info("Planning output is conversational → treating as simple chat")

        return {"intent_type": "chat", "complexity": "simple", "plan": []}

    async def _pause_for_review(self, ctx, step):
        ctx.event_bus.emit(ctx.task_id, "review.ready", {"step": step["name"]})
        review_event = ctx.executor.register_review_wait(ctx.task_id)
        ctx._review_event = review_event
        await review_event.wait()

    async def _execute_parallel(self, ctx, group, context_data):
        results = {}
        tasks = []
        for item in group:
            mode = item.get("mode", "plan_execute")
            sub_ctx = TaskContext.from_parent(ctx, input_data=copy.deepcopy(context_data))
            tasks.append(ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True))
        completed = await asyncio.gather(*tasks, return_exceptions=True)
        for item, result in zip(group, completed):
            if isinstance(result, Exception):
                if item.get("on_error", "abort") == "skip":
                    continue
                raise result
            results[item.get("output", item["name"])] = result
        return results

    async def _save_checkpoint(self, ctx, state):
        if hasattr(ctx, 'checkpoint') and ctx.checkpoint:
            ctx.checkpoint.save(ctx.task_id, "auto", state)

    def _render_template(self, text: str, context_data: dict) -> str:
        def replace_var(match):
            key = match.group(1)
            return str(context_data.get(key, match.group(0)))
        return re.sub(r'\{\{(\w+)\}\}', replace_var, text)

    # ── Simple message detection and fast-path response ──

    # Intent keywords for fallback detection from user input
    _INTENT_KEYWORDS = {
        "creation": ["写一篇", "写篇文章", "创作文章", "创作一篇", "撰写文章", "撰写一篇", "写一篇文章", "帮我写一篇", "写一篇关于", "write an article", "create an article"],
        "write": ["写", "文章", "创作", "撰写", "编写", "write", "article", "generate"],
        "search": ["搜索", "搜", "查", "search", "find", "lookup"],
        "research": ["研究", "调研", "分析", "research", "investigate", "study"],
        "code": ["代码", "编程", "函数", "code", "program", "function", "python", "javascript", "算法", "排序", "程序", "脚本", "script", "java", "c++", "rust", "golang", "typescript"],
        "translate": ["翻译", "translate", "translation"],
        "analyze": ["分析", "评估", "analyze", "evaluate", "assess"],
    }

    # Programming language keywords that strongly indicate code intent (double weight)
    _CODE_STRONG_KEYWORDS = {"python", "javascript", "java", "c++", "rust", "golang", "typescript", "代码", "编程", "程序", "脚本", "code", "program", "script", "算法"}

    # Intent-based step inference: when planner fails to generate steps,
    # we infer them from the intent_type to ensure proper agent/tool routing.
    _INTENT_STEP_TEMPLATES = {
        "creation": [
            {"name": "选题研究", "type": "agent", "agent": "topic_research", "input": {}, "description": "研究选题角度"},
            {"name": "搜索素材", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关素材"},
            {"name": "撰写文章", "type": "agent", "agent": "article_writing", "input": {}, "description": "撰写文章初稿"},
            {"name": "文章评估", "type": "agent", "agent": "article_eval", "input": {}, "description": "评估文章质量"},
            {"name": "内容审核", "type": "agent", "agent": "content_audit", "input": {}, "description": "内容合规审核"},
        ],
        "write": [
            {"name": "搜索素材", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关素材"},
            {"name": "撰写内容", "type": "agent", "agent": "article_writing", "input": {}, "description": "撰写文章内容"},
        ],
        "search": [
            {"name": "搜索信息", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关信息"},
            {"name": "整理回复", "type": "generate", "description": "整理搜索结果并回复"},
        ],
        "research": [
            {"name": "搜索资料", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索研究资料"},
            {"name": "深度研究", "type": "agent", "agent": "research_agent", "input": {}, "description": "深度研究分析"},
            {"name": "整理报告", "type": "generate", "description": "整理研究报告"},
        ],
        "code": [
            {"name": "编写代码", "type": "agent", "agent": "code_writer_agent", "input": {}, "description": "编写代码"},
        ],
        "translate": [
            {"name": "翻译文本", "type": "agent", "agent": "multilingual", "input": {}, "description": "翻译文本"},
        ],
        "analyze": [
            {"name": "搜索信息", "type": "tool", "tool": "web_search", "input": {}, "description": "搜索相关信息"},
            {"name": "分析整理", "type": "generate", "description": "分析并整理结果"},
        ],
    }

    def _infer_steps_from_intent(self, intent_type: str, intent: str) -> list:
        """Infer execution steps from intent_type when planner returns empty plan.
        
        This is a fallback mechanism: when the LLM planner fails to generate
        a proper execution plan (returns empty plan[]), we use predefined
        step templates based on the intent_type to ensure proper routing
        to agents and tools.
        """
        template = self._INTENT_STEP_TEMPLATES.get(intent_type, [])
        if not template:
            return []

        # Fill in the intent as input for each step
        inferred = []
        for step in template:
            s = dict(step)
            if not s.get("input"):
                s["input"] = {}
            s["input"].setdefault("query", intent)
            s["input"].setdefault("topic", intent)
            s["input"].setdefault("task", intent)
            if s.get("agent") != "multilingual":
                s["input"].setdefault("text", intent)
            inferred.append(s)
        return inferred

    _CREATION_STRONG_KEYWORDS = {"写一篇", "写篇文章", "创作文章", "创作一篇", "撰写文章", "撰写一篇", "写一篇文章", "帮我写一篇", "写一篇关于", "write an article", "create an article"}

    def _infer_intent_type_from_text(self, text: str) -> str:
        if not text:
            return "chat"
        text_lower = text.lower()
        for kw in self._CREATION_STRONG_KEYWORDS:
            if kw in text_lower:
                return "creation"
        best_type = "chat"
        best_score = 0
        for intent_type, keywords in self._INTENT_KEYWORDS.items():
            if intent_type == "creation":
                continue
            score = 0
            for kw in keywords:
                if kw in text_lower:
                    if intent_type == "code" and kw in self._CODE_STRONG_KEYWORDS:
                        score += 2
                    else:
                        score += 1
            if score > best_score:
                best_score = score
                best_type = intent_type
        return best_type if best_score > 0 else "chat"

    def _extract_step_content(self, sr: dict) -> str:
        """Extract readable text content from a step result dict.

        Handles various result formats from agents and tools:
        - {"content": "text"} (generate step)
        - {"success": True, "result": {"output": "text", "draft": "text"}} (agent)
        - {"success": True, "result": {"result": "text"}} (tool)
        - Nested dicts with "content", "text", "output" keys
        """
        # Direct content from generate steps
        if sr.get("content"):
            return sr["content"]

        result = sr.get("result")
        if not result:
            return ""

        if isinstance(result, str):
            return result

        if isinstance(result, dict):
            # Try common keys in order of preference
            for key in ["content", "text", "output", "draft", "result", "response", "answer"]:
                val = result.get(key)
                if val:
                    if isinstance(val, str) and len(val.strip()) > 5:
                        return val
                    if isinstance(val, dict):
                        # Recurse one level
                        for k2 in ["content", "text", "output", "draft"]:
                            v2 = val.get(k2)
                            if isinstance(v2, str) and len(v2.strip()) > 5:
                                return v2
            # Last resort: find the longest string value in the dict
            longest = ""
            for v in result.values():
                if isinstance(v, str) and len(v) > len(longest):
                    longest = v
                elif isinstance(v, dict):
                    for v2 in v.values():
                        if isinstance(v2, str) and len(v2) > len(longest):
                            longest = v2
            if longest.strip():
                return longest

        return str(result) if result else ""

    def _find_best_text_in_context(self, step_context: dict) -> str:
        """Find the best text content from accumulated step context.

        Prioritizes longer content (likely article drafts) over shorter content.
        """
        best = ""
        for key, val in step_context.items():
            if not isinstance(val, str):
                continue
            if key.startswith("_output_") and len(val) > len(best):
                best = val
        # Also check _last_output
        last = step_context.get("_last_output", "")
        if isinstance(last, str) and len(last) > len(best):
            best = last
        return best

    _SIMPLE_PATTERNS = [
        (r'^(你好|hi|hello|hey|嗨|哈喽|在吗|在不在|有人吗|hello there)[\s!！。.]*$', True),
        (r'^(谢谢|感谢|thanks|thank you|thx|3q|多谢)[\s!！。.]*$', True),
        (r'^(好的|ok|okay|行|可以|明白了|知道了|懂了|收到|了解|get it|got it)[\s!！。.]*$', True),
        (r'^(再见|拜拜|bye|goodbye|88|晚安|早安|早上好|中午好|晚上好|下午好)[\s!！。.]*$', True),
        # Compound identity questions: "你是谁？你能做什么？" etc.
        (r'^(你是谁|你叫什么|what are you|who are you|what is your name)[\s?？!！。.]*(你能做什么|what can you do|介绍一下你自己|自我介绍|介绍下你自己)?[\s?？!！。.]*$', True),
        (r'^(你能做什么|what can you do|介绍一下你自己|自我介绍|介绍下你自己)[\s?？!！。.]*$', True),
    ]

    _COMPLEX_PATTERNS = [
        (r'写.*文章|创作|写一篇|帮我写|写个|generate.*article|write.*article|写.*报告', False),
        (r'搜索|帮我搜|search.*for|搜一下|查一下|帮我查|研究.*现状|research|调研', False),
        (r'分析|analyze|深度分析|帮我分析|分析一下', False),
        (r'翻译|translate|帮我翻译|翻译成', False),
        (r'写.*代码|编程|帮我写.*代码|generate.*code|write.*code|写个.*程序', False),
    ]

    def _is_simple_message(self, intent: str) -> bool:
        """Detect trivial messages that don't need planning phase.
        
        Returns True for greetings, thanks, acknowledgements, and very short
        trivial messages where a separate planning LLM call is wasteful.
        """
        if not intent or not isinstance(intent, str):
            return True
        stripped = intent.strip()

        # Check complex patterns first (explicit task requests)
        for pattern, _ in self._COMPLEX_PATTERNS:
            if re.search(pattern, stripped, re.IGNORECASE):
                return False

        # Check simple patterns
        for pattern, _ in self._SIMPLE_PATTERNS:
            if re.search(pattern, stripped, re.IGNORECASE):
                return True

        # Very short messages (<= 8 chars) likely trivial
        if len(stripped) <= 8:
            return True

        return False

    async def _simple_response(self, ctx: TaskContext, context_data: dict,
                                model_hint: str, persona: str, intent: str) -> dict:
        """Fast-path: generate a response without planning phase (1 LLM call only)."""
        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "response", "label": "生成回复",
            "order": 1, "stage": "response",
        })

        recalled = await self._recall_memories(ctx, intent)

        response_prompt = get_prompt("response.simple")
        response_messages = [
            {"role": "system", "content": response_prompt},
            {"role": "user", "content": intent},
        ]
        if recalled:
            memory_snippets = []
            for r in recalled[:3]:
                if isinstance(r, dict):
                    memory_snippets.append(str(r.get("intent", r.get("trace", "")))[:200])
            if memory_snippets:
                response_messages.insert(1, {"role": "system", "content": f"相关历史记忆：\n" + "\n".join(memory_snippets)})

        final_content = ""
        try:
            final_content = await self._call_llm(ctx, response_messages, model_hint, "solo_assistant", persona)
        except Exception as e:
            final_content = f"生成回复失败: {str(e)[:200]}"

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "response"})

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": final_content,
            "is_partial": False,
            "agent_name": "solo_assistant",
        })

        result = {
            **context_data,
            "response": final_content,
            "plan": {"intent_type": "chat", "complexity": "simple", "plan": []},
        }
        await self._save_to_memory(ctx, intent, result, result["plan"])
        return result
