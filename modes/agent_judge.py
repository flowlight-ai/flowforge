from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext


class AgentJudgeExecutor(BaseModeExecutor):
    mode_name = "agent_judge"
    capabilities = ["evaluation"]

    async def _execute_core(self, ctx: TaskContext) -> dict:
        task = ctx.input_data.get("task", "")

        actor = ctx.agents.get("judge_actor") if ctx.agents else None
        if actor is None:
            from flowforge.modes.default_llm_actors import DefaultLLMActor
            actor = DefaultLLMActor()

        judge = ctx.agents.get("judge_evaluator") if ctx.agents else None
        if judge is None:
            from flowforge.modes.default_llm_actors import DefaultLLMEvaluator
            judge = DefaultLLMEvaluator()

        ctx.event_bus.emit(ctx.task_id, "agent_judge.actor_start", {"task": task[:200]})
        actor_input = AgentInput(params={"task": task})
        if hasattr(actor, 'execute_with_context'):
            actor_output = await actor.execute_with_context(actor_input, ctx)
        else:
            actor_output = await actor.execute(actor_input)
        ctx.event_bus.emit(ctx.task_id, "agent_judge.actor_complete", {
            "output_preview": str(actor_output.result)[:300],
        })

        ctx.event_bus.emit(ctx.task_id, "agent_judge.judge_start", {})
        judge_input = AgentInput(params={"output": actor_output.result})
        if hasattr(judge, 'execute_with_context'):
            judge_output = await judge.execute_with_context(judge_input, ctx)
        else:
            judge_output = await judge.execute(judge_input)

        score = judge_output.result.get("score", 0)
        issues = judge_output.result.get("issues", [])
        ctx.event_bus.emit(ctx.task_id, "agent_judge.verdict", {
            "score": score, "issues": issues,
        })

        ctx.event_bus.emit(ctx.task_id, "draft.update", {
            "content": str(actor_output.result), "is_partial": False,
        })

        return {"actor_result": actor_output.result, "judge_result": judge_output.result}
