from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class RefinerAgent(GenericAgent):
    name = "refiner"
    description = "迭代优化：根据评审反馈改进当前版本"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        draft = input.params.get("draft", "")
        critique = input.params.get("critique", {})
        task = input.params.get("task", input.params.get("query", ""))
        iteration = input.params.get("iteration", 0)

        weaknesses = critique.get("weaknesses", []) if isinstance(critique, dict) else []
        suggestions = critique.get("suggestions", []) if isinstance(critique, dict) else []

        prompt = (
            "You are a refinement agent. Improve the draft based on the critique feedback.\n"
            f"Original task: {task}\n"
            f"Current draft: {draft}\n"
            f"Weaknesses identified: {weaknesses}\n"
            f"Suggestions for improvement: {suggestions}\n"
            f"Iteration: {iteration}\n\n"
            "Produce an improved version as JSON:\n"
            '{"refined_draft": "your improved content", "changes_made": ["change1"], '
            '"remaining_issues": ["issue1"]}'
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"refined_draft": data, "changes_made": [], "remaining_issues": []}

        return AgentOutput(
            result={"refined_draft": data.get("refined_draft", ""), "changes_made": data.get("changes_made", []),
                    "remaining_issues": data.get("remaining_issues", [])},
            state_updates={"draft": data.get("refined_draft", ""), "refinement_iteration": iteration + 1}
        )
