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

        prompt = self._get_prompt(
            "flowforge.agent.planner",
            task=task,
            constraints_section=f"Constraints: {constraints}\n" if constraints else "",
            resources_section=f"Available resources: {resources}\n" if resources else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"plan_name": task, "steps": [{"id": 1, "description": data, "estimated_effort": "medium", "dependencies": []}], "estimated_total_effort": "medium", "risks": []}

        return AgentOutput(
            result={"plan": data},
            state_updates={"plan": data}
        )
