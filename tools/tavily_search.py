import os
import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("tavily_search")


class TavilySearchTool(BaseTool):
    name = "tavily_search"
    description = "Tavily AI Search API：高质量AI搜索"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "max_results": {"type": "integer", "default": 5, "description": "最大结果数"},
            "search_depth": {"type": "string", "default": "basic", "enum": ["basic", "advanced"]},
            "include_answer": {"type": "boolean", "default": True, "description": "包含AI摘要"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)
        search_depth = input.params.get("search_depth", "basic")
        include_answer = input.params.get("include_answer", True)

        api_key = os.getenv("TAVILY_API_KEY", "")
        if not api_key:
            return ToolOutput(
                result={"results": [], "error": "TAVILY_API_KEY 未配置"},
                error="TAVILY_API_KEY 未配置",
            )

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": api_key,
                        "query": query,
                        "max_results": max_results,
                        "search_depth": search_depth,
                        "include_answer": include_answer,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            results = []
            for item in data.get("results", []):
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", ""),
                    "score": item.get("score", 0),
                })

            answer = data.get("answer", "")
            return ToolOutput(result={"results": results, "answer": answer, "source": "tavily"})
        except Exception as e:
            logger.error(f"Tavily search failed: {e}")
            return ToolOutput(result={"results": [], "error": str(e)})
