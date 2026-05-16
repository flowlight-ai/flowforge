from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class GeneratorAgent(GenericAgent):
    name = "generator"
    description = "AI 生成：根据任务需求生成内容"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        requirements = input.params.get("requirements", [])
        style = input.params.get("style", "professional")

        prompt = (
            "You are a generation agent. Produce content based on the task requirements.\n"
            f"Task: {task}\n"
            f"Style: {style}\n"
        )
        if requirements:
            prompt += f"Requirements: {requirements}\n"
        prompt += "\nGenerate the content as JSON:\n"
        prompt += '{"generated": "your generated content", "metadata": {"word_count": 0, "quality_estimate": 0.0-1.0}}'

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"generated": data, "metadata": {"word_count": len(data), "quality_estimate": 0.5}}

        return AgentOutput(
            result={"generated": data.get("generated", ""), "metadata": data.get("metadata", {})},
            state_updates={"generated": data.get("generated", "")}
        )
