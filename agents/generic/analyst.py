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

        prompt = (
            "You are an analysis agent. Thoroughly analyze the task requirements.\n"
            f"Task: {task}\n"
        )
        if background:
            prompt += f"Background: {background}\n"
        if constraints:
            prompt += f"Constraints: {constraints}\n"
        prompt += (
            "\nProvide analysis as JSON:\n"
            '{"summary": "task summary", "key_requirements": ["req1"], "constraints": ["constraint1"], '
            '"assumptions": ["assumption1"], "scope": "scope description", '
            '"dependencies": ["dep1"], "risks": ["risk1"]}'
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"summary": data, "key_requirements": [], "constraints": [], "assumptions": [], "scope": "", "dependencies": [], "risks": []}

        return AgentOutput(
            result={"analysis": data},
            state_updates={"analysis": data}
        )
