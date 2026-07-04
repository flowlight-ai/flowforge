from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class ApproverAgent(GenericAgent):
    name = "approver"
    description = "确认发布：根据审核结果执行最终确认和发布操作"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        task = input.params.get("task", input.params.get("query", ""))
        generated = input.params.get("generated", "")
        review_result = input.params.get("review_result", {})
        review_decision = input.params.get("review_decision", "approved")

        prompt = self._get_prompt(
            "flowforge.agent.approver",
            task=task,
            generated=generated,
            review_result=review_result,
            review_decision=review_decision,
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"approved": review_decision == "approved", "approval_note": data, "release_ready": False, "post_approval_actions": []}

        return AgentOutput(
            result={"approval": data},
            state_updates={"approved": data.get("approved", False), "release_ready": data.get("release_ready", False)}
        )
