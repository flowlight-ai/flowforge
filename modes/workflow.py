import asyncio
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import WorkflowRecursionError
from flowforge.core.tracing import get_logger

logger = get_logger("workflow_executor")


class WorkflowExecutor(BaseModeExecutor):
    mode_name = "workflow"
    capabilities = ["orchestration", "planning"]
    MAX_DEPTH = 3

    async def _execute_core(self, ctx: TaskContext) -> dict:
        sop_steps = ctx.metadata.get("sop_steps", [])
        context_data = ctx.input_data.copy()
        depth = ctx.metadata.get("_workflow_depth", 0)
        if depth >= self.MAX_DEPTH:
            raise WorkflowRecursionError("Max workflow depth exceeded")

        if not sop_steps and ctx.interaction_mode == "solo":
            return await self._execute_solo_chat(ctx, context_data)

        for step in sop_steps:
            step_name = step["name"]
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {"step": step_name, "label": step_name, "order": 1, "total": len(sop_steps)})

            if step.get("human"):
                auto_approve = ctx.metadata.get("auto_approve_review", False)
                if auto_approve:
                    ctx.event_bus.emit(ctx.task_id, "review.auto_approved", {"step": step_name})
                else:
                    await self._pause_for_review(ctx, step)
                continue

            if step.get("parallel_group"):
                results = await self._execute_parallel(ctx, step["parallel_group"], context_data)
                context_data.update(results)
                continue

            agent_name = step.get("agent")
            if agent_name and ctx.agents:
                agent = ctx.agents.get(agent_name)
                if agent:
                    merged_data = {**ctx.state, **context_data}
                    try:
                        agent_input = AgentInput(params=merged_data)
                        agent_output = await agent.execute(agent_input)
                        context_data[step.get("output", step_name)] = agent_output.result
                        if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                            ctx.state.update(agent_output.state_updates)
                            context_data.update(agent_output.state_updates)
                    except Exception as e:
                        on_error = step.get("on_error", "abort")
                        if on_error == "skip":
                            ctx.event_bus.emit(ctx.task_id, "workflow.step.skipped", {"step": step_name, "error": str(e)})
                            continue
                        elif on_error == "retry":
                            retry_count = step.get("retry_count", 1)
                            delay = step.get("retry_delay", 2)
                            for i in range(retry_count):
                                try:
                                    await asyncio.sleep(delay)
                                    merged_data = {**ctx.state, **context_data}
                                    agent_input = AgentInput(params=merged_data)
                                    agent_output = await agent.execute(agent_input)
                                    context_data[step.get("output", step_name)] = agent_output.result
                                    if hasattr(agent_output, 'state_updates') and agent_output.state_updates:
                                        ctx.state.update(agent_output.state_updates)
                                        context_data.update(agent_output.state_updates)
                                    break
                                except Exception:
                                    if i == retry_count - 1:
                                        raise
                        else:
                            raise
                    ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})
                    continue

            mode = step.get("mode", "plan_execute")
            if mode == "workflow":
                raise ValueError("Nested workflow mode is forbidden")

            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data,
                                              metadata={"_workflow_depth": depth + 1})
            try:
                sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                context_data[step.get("output", step_name)] = sub_result
            except Exception as e:
                on_error = step.get("on_error", "abort")
                if on_error == "skip":
                    continue
                elif on_error == "retry":
                    retry_count = step.get("retry_count", 1)
                    delay = step.get("retry_delay", 2)
                    for i in range(retry_count):
                        try:
                            await asyncio.sleep(delay)
                            sub_result = await ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True)
                            context_data[step.get("output", step_name)] = sub_result
                            break
                        except Exception:
                            if i == retry_count - 1:
                                raise
                else:
                    raise

            ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": step_name})

        return context_data

    async def _execute_solo_chat(self, ctx: TaskContext, context_data: dict) -> dict:
        intent = context_data.get("task", context_data.get("intent", ""))
        model_hint = ctx.metadata.get("model", "auto")

        ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {
            "step": "solo_chat", "label": "AI 对话", "order": 1, "total": 1,
        })

        messages = [{"role": "user", "content": intent}]

        saved_messages = []
        try:
            from flowforge.core.workspace import get_workspace_manager
            ws = get_workspace_manager()
            saved_messages = ws.load_messages(ctx.task_id)
        except Exception:
            pass

        if saved_messages:
            chat_messages = []
            for m in saved_messages:
                role = m.get("role", "user")
                if role == "assistant":
                    role = "assistant"
                content = m.get("content", "")
                if content:
                    chat_messages.append({"role": role, "content": content})
            if chat_messages:
                messages = chat_messages
                last_user = [m for m in messages if m["role"] == "user"]
                if not last_user or last_user[-1]["content"] != intent:
                    messages.append({"role": "user", "content": intent})

        llm_params = {
            "messages": messages,
            "stream": True,
            "persona": ctx.persona or "default",
            "agent_name": "solo_assistant",
            "task_id": ctx.task_id,
        }
        if model_hint and model_hint != "auto":
            llm_params["model"] = model_hint

        result_content = ""
        try:
            if ctx.tools:
                tool_input = ToolInput(params=llm_params)
                tool_output = await ctx.tools.execute("llm", tool_input)
                result_content = tool_output.result.get("content", "") if tool_output.result else ""
            else:
                from flowforge.tools.llm_client import LLMClient
                llm = LLMClient(event_bus=ctx.event_bus)
                tool_input = ToolInput(params=llm_params)
                tool_output = await llm.execute(tool_input)
                result_content = tool_output.result.get("content", "") if tool_output.result else ""
        except Exception as e:
            logger.error(f"Solo chat LLM call failed: {e}")
            ctx.event_bus.emit(ctx.task_id, "task.error", {
                "step_name": "solo_chat",
                "error_message": f"AI 调用失败: {str(e)[:200]}",
            })
            return {**context_data, "error": str(e)}

        try:
            from flowforge.core.workspace import get_workspace_manager
            ws = get_workspace_manager()
            ws.save_message(ctx.task_id, {
                "role": "assistant",
                "content": result_content[:2000],
            })
        except Exception:
            pass

        ctx.event_bus.emit(ctx.task_id, "workflow.step.complete", {"step": "solo_chat"})

        return {**context_data, "response": result_content}

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
            sub_ctx = TaskContext.from_parent(ctx, input_data=context_data)
            tasks.append(ctx.executor.run(sub_ctx, mode_hint=mode, _is_substep=True))
        completed = await asyncio.gather(*tasks, return_exceptions=True)
        for item, result in zip(group, completed):
            if isinstance(result, Exception):
                if item.get("on_error", "abort") == "skip":
                    continue
                raise result
            results[item.get("output", item["name"])] = result
        return results
