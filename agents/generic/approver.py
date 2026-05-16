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

        prompt = (
            "You are an approval agent. Process the review decision and prepare for release.\n"
            f"Original task: {task}\n"
            f"Content: {generated}\n"
            f"Review result: {review_result}\n"
            f"Review decision: {review_decision}\n\n"
            "Produce the approval outcome as JSON:\n"
            '{"approved": true/false, "approval_note": "note", "release_ready": true/false, '
            '"post_approval_actions": ["action1"]}'
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"approved": review_decision == "approved", "approval_note": data, "release_ready": False, "post_approval_actions": []}

        return AgentOutput(
            result={"approval": data},
            state_updates={"approved": data.get("approved", False), "release_ready": data.get("release_ready", False)}
        )
