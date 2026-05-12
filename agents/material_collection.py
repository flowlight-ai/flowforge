from core.base_agent import BaseAgent, AgentInput, AgentOutput
from core.base_tool import ToolInput
from core.task_context import TaskContext


class MaterialCollectionAgent(BaseAgent):
    name = "material_collection"
    description = "并行多源检索、素材清洗、关键事实提取"
    default_mode = "rewoo"

    async def execute(self, input: AgentInput) -> AgentOutput:
        raise NotImplementedError("请使用 execute_with_context")

    async def execute_with_context(self, input: AgentInput, context: TaskContext) -> AgentOutput:
        topics = input.params.get("topics", [])
        materials = []
        for topic in topics[:2]:
            query = topic.get("title", "") if isinstance(topic, dict) else str(topic)
            try:
                helix = context.tools.get_tool("helixrag_search")
                result = await helix.execute(
                    ToolInput(params={"query": query, "max_results": 3, "min_score": 0.3})
                )
                for r in result.result.get("results", []):
                    materials.append({
                        "title": r.get("title", ""),
                        "content": r.get("content", ""),
                        "url": r.get("url", ""),
                        "source_type": r.get("source_type", "web"),
                    })
            except Exception:
                try:
                    search = context.tools.get_tool("web_search")
                    result = await search.execute(ToolInput(params={"query": query}))
                    for r in result.result.get("results", []):
                        materials.append({
                            "title": r.get("title", ""),
                            "content": r.get("content", ""),
                            "url": r.get("url", ""),
                            "source_type": "web",
                        })
                except Exception:
                    pass
        return AgentOutput(result={"materials": materials})
