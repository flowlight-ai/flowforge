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

        prompt = self._get_prompt(
            "flowforge.agent.drafter",
            "You are a drafting agent. Create an initial draft based on the given requirements.\n"
            "Task: {task}\n"
            "Style: {style}\n"
            "{requirements_section}"
            "{reference_section}"
            "\nCreate a complete initial draft. Output as JSON:\n"
            '{{"draft": "your draft content", "notes": "any notes about the draft"}}',
            task=task,
            style=style,
            requirements_section=f"Requirements: {requirements}\n" if requirements else "",
            reference_section=f"Reference material: {reference}\n" if reference else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"draft": data, "notes": ""}

        return AgentOutput(
            result={"draft": data.get("draft", ""), "notes": data.get("notes", "")},
            state_updates={"draft": data.get("draft", "")}
        )
