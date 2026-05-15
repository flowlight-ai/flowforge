import asyncio
from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.task_context import TaskContext
from flowforge.core.errors import WorkflowRecursionError

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

        for step in sop_steps:
            step_name = step["name"]
            ctx.event_bus.emit(ctx.task_id, "workflow.step.start", {"step": step_name})

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
