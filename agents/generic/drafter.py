from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class DrafterAgent(GenericAgent):
    name = "drafter"
    description = "初稿生成：根据需求生成初始版本"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        requirements = input.params.get("requirements", [])
        style = input.params.get("style", "professional")
        reference = input.params.get("reference", "")

        prompt = (
            "You are a drafting agent. Create an initial draft based on the given requirements.\n"
            f"Task: {task}\n"
            f"Style: {style}\n"
        )
        if requirements:
            prompt += f"Requirements: {requirements}\n"
        if reference:
            prompt += f"Reference material: {reference}\n"
        prompt += "\nCreate a complete initial draft. Output as JSON:\n"
        prompt += '{"draft": "your draft content", "notes": "any notes about the draft"}'

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"draft": data, "notes": ""}

        return AgentOutput(
            result={"draft": data.get("draft", ""), "notes": data.get("notes", "")},
            state_updates={"draft": data.get("draft", "")}
        )
