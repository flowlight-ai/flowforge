"""Workflow execution engine.

Contains the WorkflowExecutor class that orchestrates multi-step
workflow execution, including SOP steps, intelligent chat, and
ReAct loops.

Heavy logic is delegated to sub-modules:
- workflow_context.py: LLM calls, memory, tool descriptions, templates
- workflow_tools.py: tool/agent execution, function schemas, search fallbacks
- workflow_react.py: ReAct loop execution
- workflow_chat.py: intelligent chat, normal chat, simple responses
"""

import asyncio
import copy
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import WorkflowRecursionError, StepTimeoutError
from flowforge.core.tracing import get_logger
from flowforge.modes.workflow_validator import (
    WorkflowValidator,
    STEP_TIMEOUT_SECONDS,
)
from flowforge.modes.workflow_context import ContextHandler
from flowforge.modes.workflow_tools import ToolHandler
from flowforge.modes.workflow_react import ReactHandler
from flowforge.modes.workflow_chat import ChatHandler

logger = get_logger("workflow_executor")


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

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._validator = WorkflowValidator()
        # Sub-module handlers (composition, not inheritance)
        self._context_handler = ContextHandler(self)
        self._tool_handler = ToolHandler(self)
        self._react_handler = ReactHandler(self)
        self._chat_handler = ChatHandler(self)

    # ── Proxy methods: delegate to ContextHandler ──

    async def _call_llm(self, ctx, messages: list, model_hint: str,
                         agent_name: str = "helm_assistant", persona: str = "default") -> str:
        return await self._context_handler.call_llm(ctx, messages, model_hint, agent_name, persona)

    async def _recall_memories(self, ctx, intent: str) -> list:
        return await self._context_handler.recall_memories(ctx, intent)

    async def _save_to_memory(self, ctx, intent: str, result: dict, plan: dict) -> None:
        return await self._context_handler.save_to_memory(ctx, intent, result, plan)

    def _build_tool_descriptions_text(self, ctx) -> str:
        return self._context_handler.build_tool_descriptions_text(ctx)

    def _render_template(self, text: str, context_data: dict) -> str:
        return self._context_handler.render_template(text, context_data)

    # ── Proxy methods: delegate to ToolHandler ──

    async def _execute_tool_or_agent(self, ctx, name: str, arguments: dict) -> dict:
        return await self._tool_handler.execute_tool_or_agent(ctx, name, arguments)

    def _build_function_schemas(self, ctx) -> list:
        return self._tool_handler.build_function_schemas(ctx)

    async def _llm_web_search_fallback(self, ctx, intent: str, model_hint: str, persona: str) -> dict:
        return await self._tool_handler.llm_web_search_fallback(ctx, intent, model_hint, persona)

    # ── Proxy methods: delegate to ReactHandler ──

    async def _run_react_loop(self, ctx, intent: str,
                               tool_schemas: list, model_hint: str, persona: str) -> dict:
        return await self._react_handler.run_react_loop(ctx, intent, tool_schemas, model_hint, persona)

    # ── Proxy methods: delegate to ChatHandler ──

    async def _execute_intelligent_chat(self, ctx, context_data: dict, is_auto: bool = False) -> dict:
        return await self._chat_handler.execute_intelligent_chat(ctx, context_data, is_auto)

    async def _execute_normal_chat(self, ctx, context_data: dict) -> dict:
        return await self._chat_handler.execute_normal_chat(ctx, context_data)

    async def _simple_response(self, ctx, context_data: dict,
                                model_hint: str, persona: str, intent: str) -> dict:
        return await self._chat_handler.simple_response(ctx, context_data, model_hint, persona, intent)

    # ── Core entry point ──

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

    # ── SOP step execution (kept in main class) ──

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
                if not auto_approve and ctx.interaction_mode in ("helm", "auto"):
                    auto_approve = True
                    logger.info(f"Step '{step_name}' is human review, auto-skipping in {ctx.interaction_mode} mode")
                if not auto_approve:
                    await self._pause_for_review(ctx, step)
                ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})
                continue

            agent_name = step.get("agent")
            step_mode = step.get("mode")
            force_mode = step.get("force_mode", False)

            if agent_name and ctx.agents:
                agent = ctx.agents.get(agent_name)
                # namespace fallback: try contentforge:{agent_name} if bare name not found
                if agent is None and ':' not in agent_name:
                    for ns_prefix in ('contentforge:', 'flowforge:'):
                        agent = ctx.agents.get(f'{ns_prefix}{agent_name}')
                        if agent:
                            logger.info(f"Step '{step_name}' agent '{agent_name}' resolved via namespace fallback to '{ns_prefix}{agent_name}'")
                            break
                if agent:
                    try:
                        merged_data = {**ctx.state, **context_data}
                        # [修复断点2] 合并metadata中的loop反馈，确保agent能看到评委建议
                        if hasattr(ctx, 'metadata') and ctx.metadata:
                            for key in ('loop_reflections', 'loop_verifier_errors', 'last_draft'):
                                if key in ctx.metadata:
                                    merged_data[key] = ctx.metadata[key]
                        agent_input = AgentInput(params=merged_data)

                        # [loop-trace] agent执行前详细日志
                        logger.info(f"[loop-trace] task_id={ctx.task_id} agent执行前: "
                                     f"agent_name={agent_name}, step_name={step_name}, "
                                     f"params_keys={list(agent_input.params.keys())}")
                        for _pk, _pv in agent_input.params.items():
                            if _pk.startswith("_"):
                                continue
                            _pv_len = len(str(_pv)) if _pv is not None else 0
                            _pv_preview = str(_pv)[:200] if _pv is not None else "None"
                            if isinstance(_pv, dict):
                                logger.info(f"[loop-trace] task_id={ctx.task_id} params[{_pk}] type=dict, keys={list(_pv.keys())}")
                            else:
                                logger.info(f"[loop-trace] task_id={ctx.task_id} params[{_pk}] type={type(_pv).__name__}, len={_pv_len}, preview={_pv_preview}")

                        agent_output = await asyncio.wait_for(
                            agent.execute_with_context(agent_input, ctx),
                            timeout=step_timeout,
                        )

                        # [loop-trace] agent执行后详细日志
                        logger.info(f"[loop-trace] task_id={ctx.task_id} agent执行后: agent_name={agent_name}")
                        if hasattr(agent_output, 'result') and isinstance(agent_output.result, dict):
                            logger.info(f"[loop-trace] task_id={ctx.task_id} agent_output.result_keys={list(agent_output.result.keys())}")
                            for _aok, _aov in agent_output.result.items():
                                if _aok.startswith("_"):
                                    continue
                                _aov_len = len(str(_aov)) if _aov is not None else 0
                                _aov_preview = str(_aov)[:200] if _aov is not None else "None"
                                if isinstance(_aov, dict):
                                    logger.info(f"[loop-trace] task_id={ctx.task_id} result[{_aok}] type=dict, keys={list(_aov.keys())}, len={_aov_len}")
                                else:
                                    logger.info(f"[loop-trace] task_id={ctx.task_id} result[{_aok}] type={type(_aov).__name__}, len={_aov_len}, preview={_aov_preview}")
                        else:
                            logger.info(f"[loop-trace] task_id={ctx.task_id} agent_output.result type={type(agent_output.result).__name__}, preview={str(agent_output.result)[:200]}")
                        if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                            logger.info(f"[loop-trace] task_id={ctx.task_id} agent_output.state_updates_keys={list(agent_output.state_updates.keys())}")
                            for _suk, _suv in agent_output.state_updates.items():
                                _suv_len = len(str(_suv)) if _suv is not None else 0
                                _suv_preview = str(_suv)[:200] if _suv is not None else "None"
                                logger.info(f"[loop-trace] task_id={ctx.task_id} state_updates[{_suk}] type={type(_suv).__name__}, len={_suv_len}, preview={_suv_preview}")

                        context_data.update(agent_output.result)
                        if step.get("output") and step["output"] not in agent_output.result:
                            context_data[step["output"]] = agent_output.result
                        if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                            ctx.state.update(agent_output.state_updates)
                            context_data.update(agent_output.state_updates)

                        # [loop-trace] context_data更新后详细日志
                        logger.info(f"[loop-trace] task_id={ctx.task_id} context_data更新后: keys={list(context_data.keys())}")
                        for _cdk, _cdv in context_data.items():
                            if _cdk.startswith("_"):
                                continue
                            _cdv_len = len(str(_cdv)) if _cdv is not None else 0
                            if isinstance(_cdv, dict):
                                logger.info(f"[loop-trace] task_id={ctx.task_id} context_data[{_cdk}] type=dict, keys={list(_cdv.keys())}, len={_cdv_len}")
                            else:
                                logger.info(f"[loop-trace] task_id={ctx.task_id} context_data[{_cdk}] type={type(_cdv).__name__}, len={_cdv_len}")
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
                    logger.warning(
                        f"Step '{step_name}' specifies agent '{agent_name}' but it is not registered. "
                        f"Falling back to mode executor with mode='{step_mode or 'plan_execute'}'"
                    )

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

    # ── Helper methods kept in main class ──

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
