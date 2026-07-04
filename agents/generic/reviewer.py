from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ReviewerAgent(GenericAgent):
    name = "reviewer"
    description = "审核协调：协调人工审核流程，汇总审核意见"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        content_to_review = input.params.get("generated", input.params.get("execution_result", ""))
        review_type = input.params.get("review_type", "general")

        prompt = self._get_prompt(
            "flowforge.agent.reviewer",
            task=task,
            content_to_review=content_to_review,
            review_type=review_type,
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"summary": data, "key_points": [], "risk_areas": [], "recommendation": "revise"}

        return AgentOutput(
            result={"review_result": data},
            state_updates={"review_recommendation": data.get("recommendation", "revise")}
        )
