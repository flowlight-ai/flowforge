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

        prompt = self._get_prompt(
            "flowforge.agent.refiner",
            task=task,
            draft=draft,
            weaknesses=weaknesses,
            suggestions=suggestions,
            iteration=iteration,
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
