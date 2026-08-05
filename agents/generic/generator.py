
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent, TaskContext


class GeneratorAgent(GenericAgent):
    name = "generator"
    description = "AI 生成：根据任务需求生成内容"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        requirements = input.params.get("requirements", [])
        style = input.params.get("style", "professional")

        prompt = self._get_prompt(
            "flowforge.agent.generator",
            task=task,
            style=style,
            requirements_section=f"Requirements: {requirements}\n" if requirements else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"generated": data, "metadata": {"word_count": len(data), "quality_estimate": 0.5}}

        return AgentOutput(
            result={"generated": data.get("generated", ""), "metadata": data.get("metadata", {})},
            state_updates={"generated": data.get("generated", "")}
        )
