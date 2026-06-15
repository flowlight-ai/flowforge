from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class DelivererAgent(GenericAgent):
    name = "deliverer"
    description = "交付输出：格式化并交付最终结果"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        processed = input.params.get("processed", "")
        validation = input.params.get("validation", {})
        output_format = input.params.get("output_format", "default")

        prompt = self._get_prompt(
            "flowforge.agent.deliverer",
            "You are a delivery agent. Format and prepare the final deliverable.\n"
            "Original task: {task}\n"
            "Content to deliver: {processed}\n"
            "Output format: {output_format}\n"
            "{validation_section}"
            "\nPrepare the final deliverable as JSON:\n"
            '{{"deliverable": "formatted output", "format": "format description", '
            '"summary": "brief summary of deliverable", "metadata": {{}}}}',
            task=task,
            processed=processed,
            output_format=output_format,
            validation_section=f"Validation status: {validation}\n" if validation else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"deliverable": data, "format": output_format, "summary": "", "metadata": {}}

        return AgentOutput(
            result={"deliverable": data.get("deliverable", ""), "format": data.get("format", output_format),
                    "summary": data.get("summary", ""), "metadata": data.get("metadata", {})},
            state_updates={"deliverable": data.get("deliverable", "")}
        )
