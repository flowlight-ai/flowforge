import os
import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("tavily_search")


class TavilySearchTool(BaseTool):
    name = "tavily_search"
    description = "Tavily AI 搜索引擎，专为 AI Agent 设计的搜索 API"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "max_results": {"type": "integer", "default": 5},
            "search_depth": {"type": "string", "default": "basic", "enum": ["basic", "advanced"]},
            "include_answer": {"type": "boolean", "default": True},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        api_key = os.getenv("TAVILY_API_KEY", "")
        if not api_key:
            return ToolOutput(
                result={"results": [], "answer": "", "error": "TAVILY_API_KEY not set"}
            )
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)
        search_depth = input.params.get("search_depth", "basic")
        include_answer = input.params.get("include_answer", True)
        payload = {
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
            "include_answer": include_answer,
        }
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.tavily.com/search", json=payload
                )
                resp.raise_for_status()
                data = resp.json()
                results = [
                    {
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "content": r.get("content", ""),
                        "score": r.get("score", 0),
                    }
                    for r in data.get("results", [])
                ]
                return ToolOutput(
                    result={"results": results, "answer": data.get("answer", "")}
                )
        except Exception as e:
            logger.error(f"Tavily search failed: {e}")
            return ToolOutput(result={"results": [], "answer": "", "error": str(e)})
