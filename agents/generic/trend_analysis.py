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

        prompt = (
            f"分析以下{domain}领域的热点数据，评估每个话题的热度、趋势方向和传播潜力。\n"
            f'输出JSON数组: [{{"topic": "话题", "heat_score": 8, "trend_direction": "上升/稳定/下降", '
            f'"spread_potential": "高/中/低", "analysis": "分析"}}]\n\n'
        )
        if data:
            prompt += f"数据: {data}\n"
        else:
            prompt += f"请基于{domain}领域的最新趋势进行分析。\n"

        content = await self._call_llm(context, prompt)
        result = self._extract_json(content)
        if isinstance(result, str):
            result = [{"topic": domain, "heat_score": 5, "trend_direction": "稳定", "spread_potential": "中", "analysis": result}]
        if isinstance(result, dict):
            result = [result]

        return AgentOutput(
            result={"trends": result},
            state_updates={"trends": result},
        )
