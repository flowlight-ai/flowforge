from flowforge.core.base_agent import BaseAgent, AgentInput, AgentOutput
from flowforge.core.base_tool import ToolInput
from flowforge.core.task_context import TaskContext

class TopicResearchAgent(BaseAgent):
    name = "topic_research"
    description = "多级检索策略：缓存→HelixRAG→热榜→自定义"
    default_mode = "rewoo"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        query = input.params.get("topic", input.params.get("query", ""))
        if not query:
            return AgentOutput(result={"topics": []})

        try:
            cache = context.tools.get_tool("cache")
            cached = await cache.execute(ToolInput(params={"key": f"topic:{query}"}))
            if cached.result.get("data"):
                return AgentOutput(result={"topics": cached.result["data"]})
        except Exception:
            pass

        try:
            helix = context.tools.get_tool("helixrag_search")
            result = await helix.execute(ToolInput(params={"query": query, "max_results": 5}))
            topics = [{"title": r.get("title", ""), "angle": r.get("angle", "综合"), "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            if topics:
                return AgentOutput(result={"topics": topics})
        except Exception:
            pass

        try:
            search = context.tools.get_tool("web_search")
            result = await search.execute(ToolInput(params={"query": query, "max_results": 5}))
            topics = [{"title": r.get("title", ""), "angle": "综合", "url": r.get("url", "")}
                       for r in result.result.get("results", [])][:5]
            return AgentOutput(result={"topics": topics})
        except Exception:
            pass

        return AgentOutput(result={"topics": []})
