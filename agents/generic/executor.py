
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent, TaskContext


class ExecutorAgent(GenericAgent):
    name = "executor"
    description = "计划执行：按计划逐步执行每个步骤"
    default_mode = "plan_execute"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        plan = input.params.get("plan", {})
        steps = plan.get("steps", []) if isinstance(plan, dict) else []
        current_step_index = input.params.get("current_step_index", 0)

        if not steps:
            return AgentOutput(result={"execution_result": "No plan steps to execute", "completed_steps": 0})

        completed = []
        for i, step in enumerate(steps):
            if i < current_step_index:
                continue
            step_desc = step.get("description", str(step)) if isinstance(step, dict) else str(step)
            prompt = self._get_prompt(
                "flowforge.agent.executor.step",
                step_index=i + 1,
                total_steps=len(steps),
                step_desc=step_desc,
            )
            content = await self._call_llm(context, prompt) if prompt else ""
            data = self._extract_json(content) if content else {}
            if isinstance(data, str):
                data = {"step_result": data, "status": "partial"}
            completed.append({"step": i + 1, "result": data})

        return AgentOutput(
            result={"execution_result": completed, "completed_steps": len(completed), "total_steps": len(steps)},
            state_updates={"execution_progress": f"{len(completed)}/{len(steps)}"}
        )
