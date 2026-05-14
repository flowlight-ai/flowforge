from flowforge.core.base_mode_executor import BaseModeExecutor
from flowforge.core.base_agent import AgentInput
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

        actor_input = AgentInput(params={"task": task})
        if hasattr(actor, 'execute_with_context'):
            actor_output = await actor.execute_with_context(actor_input, ctx)
        else:
            actor_output = await actor.execute(actor_input)

        judge_input = AgentInput(params={"output": actor_output.result})
        if hasattr(judge, 'execute_with_context'):
            judge_output = await judge.execute_with_context(judge_input, ctx)
        else:
            judge_output = await judge.execute(judge_input)

        ctx.event_bus.emit(ctx.task_id, "agent_judge.verdict", {"score": judge_output.result.get("score"), "issues": judge_output.result.get("issues")})
        return {"actor_result": actor_output.result, "judge_result": judge_output.result}
