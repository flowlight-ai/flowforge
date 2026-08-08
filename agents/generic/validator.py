
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent, TaskContext


class ValidatorAgent(GenericAgent):
    name = "validator"
    description = "验证检查：验证处理结果是否正确和完整"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        processed = input.params.get("processed", "")
        analysis = input.params.get("analysis", {})
        validation_rules = input.params.get("validation_rules", [])

        prompt = self._get_prompt(
            "flowforge.agent.validator",
            task=task,
            processed=processed,
            analysis=analysis,
            validation_rules_section=f"Validation rules: {validation_rules}\n" if validation_rules else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"is_valid": False, "completeness": 0.5, "correctness": 0.5, "errors": [data], "warnings": [], "fix_suggestions": []}

        return AgentOutput(
            result={"validation": data},
            state_updates={"validation_passed": data.get("is_valid", False), "validation_completeness": data.get("completeness", 0.0)}
        )
