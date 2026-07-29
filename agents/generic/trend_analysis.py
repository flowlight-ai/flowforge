from flowforge.agents.generic.base import GenericAgent, AgentInput, AgentOutput
from flowforge.core.task_context import TaskContext
from typing import Optional


class TrendAnalysisAgent(GenericAgent):
    name = "trend_analysis"
    description = "分析领域热点趋势，评估传播潜力"
    default_mode = "react"

    async def execute_with_context(self, input: AgentInput, context: Optional[TaskContext]) -> AgentOutput:
        domain = input.params.get("domain", "科技")
        data = input.params.get("data", "")

        prompt = self._get_prompt(
            "agent.trend_analyze",
            domain=domain,
            data=data or f"请基于{domain}领域的最新趋势进行分析。",
        )
        content = await self._call_llm(context, prompt) if prompt else ""
        result = self._extract_json(content) if content else []
        if isinstance(result, str):
            result = [{"topic": domain, "heat_score": 5, "trend_direction": "稳定", "spread_potential": "中", "analysis": result}]
        if isinstance(result, dict):
            result = [result]

        return AgentOutput(
            result={"trends": result},
            state_updates={"trends": result},
        )
