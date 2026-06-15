from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class VerifierAgent(GenericAgent):
    name = "verifier"
    description = "结果验证：检查执行结果是否符合预期和标准"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        execution_result = input.params.get("execution_result", "")
        plan = input.params.get("plan", {})
        criteria = input.params.get("criteria", [])

        prompt = self._get_prompt(
            "flowforge.agent.verifier",
            "You are a verification agent. Check whether the execution results meet the task requirements.\n"
            "Original task: {task}\n"
            "Execution result: {execution_result}\n"
            "{plan_section}"
            "{criteria_section}"
            "\nOutput verification as JSON:\n"
            '{{"is_valid": true/false, "score": 0.0-1.0, "issues": ["issue1"], '
            '"strengths": ["strength1"], "recommendation": "accept/reject/revise"}}',
            task=task,
            execution_result=execution_result,
            plan_section=f"Original plan: {plan}\n" if plan else "",
            criteria_section=f"Success criteria: {criteria}\n" if criteria else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"is_valid": False, "score": 0.5, "issues": ["Could not parse verification"], "strengths": [], "recommendation": "revise"}

        return AgentOutput(
            result={"verification": data},
            state_updates={"verification_score": data.get("score", 0.0), "verification_passed": data.get("is_valid", False)}
        )
