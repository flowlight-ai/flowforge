
from flowforge.agents.generic.base import AgentInput, AgentOutput, GenericAgent, TaskContext


class CriticAgent(GenericAgent):
    name = "critic"
    description = "评审反馈：对当前版本进行质量评审，指出问题和改进方向"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: TaskContext | None) -> AgentOutput:
        draft = input.params.get("draft", "")
        task = input.params.get("task", input.params.get("query", ""))
        criteria = input.params.get("criteria", [])
        iteration = input.params.get("iteration", 0)

        prompt = self._get_prompt(
            "flowforge.agent.critic",
            task=task,
            draft=draft,
            iteration=iteration,
            criteria_section=f"Evaluation criteria: {criteria}\n" if criteria else "",
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"score": 0.5, "strengths": [], "weaknesses": [data], "suggestions": [], "meets_quality_gate": False}

        return AgentOutput(
            result={"critique": data},
            state_updates={"critique_score": data.get("score", 0.0), "meets_quality_gate": data.get("meets_quality_gate", False)}
        )
