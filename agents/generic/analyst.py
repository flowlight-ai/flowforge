from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class AnalystAgent(GenericAgent):
    name = "analyst"
    description = "需求分析：深入分析任务需求，提取关键信息和约束"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        background = input.params.get("background", "")
        constraints = input.params.get("constraints", [])

        prompt = self._get_prompt(
            "flowforge.agent.analyst",
            task=task,
            background_section=f"Background: {background}\n" if background else "",
            constraints_section=f"Constraints: {constraints}\n" if constraints else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"summary": data, "key_requirements": [], "constraints": [], "assumptions": [], "scope": "", "dependencies": [], "risks": []}

        return AgentOutput(
            result={"analysis": data},
            state_updates={"analysis": data}
        )
