from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ValidatorAgent(GenericAgent):
    name = "validator"
    description = "验证检查：验证处理结果是否正确和完整"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        processed = input.params.get("processed", "")
        analysis = input.params.get("analysis", {})
        validation_rules = input.params.get("validation_rules", [])

        prompt = (
            "You are a validation agent. Verify that the processed result is correct and complete.\n"
            f"Original task: {task}\n"
            f"Processed result: {processed}\n"
            f"Requirements: {analysis}\n"
        )
        if validation_rules:
            prompt += f"Validation rules: {validation_rules}\n"
        prompt += (
            "\nProvide validation as JSON:\n"
            '{"is_valid": true/false, "completeness": 0.0-1.0, "correctness": 0.0-1.0, '
            '"errors": ["error1"], "warnings": ["warning1"], "fix_suggestions": ["fix1"]}'
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"is_valid": False, "completeness": 0.5, "correctness": 0.5, "errors": [data], "warnings": [], "fix_suggestions": []}

        return AgentOutput(
            result={"validation": data},
            state_updates={"validation_passed": data.get("is_valid", False), "validation_completeness": data.get("completeness", 0.0)}
        )
