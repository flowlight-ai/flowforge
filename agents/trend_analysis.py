from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class TrendAnalysisAgent(BaseAgent):
    name = "trend_analysis"
    description = "实时热点趋势分析、热度预测"
    default_mode = "react"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        domain = input.params.get("domain", "综合")
        try:
            search = context.tools.get_tool("web_search")
            result = await search.execute(
                ToolInput(params={"query": f"{domain} 今日热点", "max_results": 10})
            )
            trends = [
                {"title": r.get("title", ""), "url": r.get("url", ""), "heat": r.get("score", 0)}
                for r in result.result.get("results", [])
            ][:5]
            return AgentOutput(result={"trends": trends})
        except Exception:
            return AgentOutput(result={"trends": []})
