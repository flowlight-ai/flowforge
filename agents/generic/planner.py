from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class PlannerAgent(GenericAgent):
    name = "planner"
    description = "计划制定：分析任务需求，生成可执行的分步计划"
    default_mode = "plan_execute"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        constraints = input.params.get("constraints", [])
        resources = input.params.get("resources", [])

        prompt = (
            "You are a planning agent. Create a detailed, executable plan for the given task.\n"
            f"Task: {task}\n"
        )
        if constraints:
            prompt += f"Constraints: {constraints}\n"
        if resources:
            prompt += f"Available resources: {resources}\n"
        prompt += (
            "\nOutput the plan as JSON:\n"
            '{"plan_name": "name", "steps": [{"id": 1, "description": "step description", '
            '"estimated_effort": "low/medium/high", "dependencies": []}], '
            '"estimated_total_effort": "low/medium/high", "risks": ["risk1"]}'
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"plan_name": task, "steps": [{"id": 1, "description": data, "estimated_effort": "medium", "dependencies": []}], "estimated_total_effort": "medium", "risks": []}

        return AgentOutput(
            result={"plan": data},
            state_updates={"plan": data}
        )
