
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent, TaskContext


class DrafterAgent(GenericAgent):
    name = "drafter"
    description = "初稿生成：根据需求生成初始版本"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        requirements = input.params.get("requirements", [])
        style = input.params.get("style", "professional")
        reference = input.params.get("reference", "")

        prompt = self._get_prompt(
            "flowforge.agent.drafter",
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
