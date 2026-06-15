from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput, TaskContext
from typing import Optional


class FinalizerAgent(GenericAgent):
    name = "finalizer"
    description = "最终定稿：对迭代优化后的内容进行最终润色和定稿"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        draft = input.params.get("draft", input.params.get("refined_draft", ""))
        task = input.params.get("task", input.params.get("query", ""))
        critique = input.params.get("critique", {})

        prompt = self._get_prompt(
            "flowforge.agent.finalizer",
            "You are a finalization agent. Polish and finalize the content after iterative refinement.\n"
            "Original task: {task}\n"
            "Content to finalize: {draft}\n"
            "{critique_section}"
            "\nProduce the final polished version as JSON:\n"
            '{{"final_output": "your finalized content", "quality_notes": "notes on quality", '
            '"final_score_estimate": 0.0-1.0}}',
            task=task,
            draft=draft,
            critique_section=f"Last critique: {critique}\n" if critique else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"final_output": data, "quality_notes": "", "final_score_estimate": 0.7}

        return AgentOutput(
            result={"final_output": data.get("final_output", ""), "quality_notes": data.get("quality_notes", ""),
                    "final_score_estimate": data.get("final_score_estimate", 0.0)},
            state_updates={"final_output": data.get("final_output", "")}
        )
