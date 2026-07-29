from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext
from typing import Optional


class FactCheckAgent(GenericAgent):
    name = "fact_check"
    description = "事实核查：检查文章中的事实性错误和可疑声明"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        draft = input.params.get("draft", "")

        prompt = self._get_prompt(
            "flowforge.agent.fact_check",
            draft=draft,
        )

        content = await self._call_llm(context, prompt)
        data = self._extract_json(content)
        if isinstance(data, str):
            data = {"issues": [], "is_clean": True}

        issues = data.get("issues", [])
        is_clean = data.get("is_clean", len(issues) == 0)

        return AgentOutput(
            result={"issues": issues, "is_clean": is_clean},
            state_updates={"fact_check_issues": issues, "fact_check_clean": is_clean},
        )
