import os
import json
import re
import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.prompt_manager import get_prompt
from flowforge.core.tracing import get_logger

logger = get_logger("web_search_tool")


class WebSearchTool(BaseTool):
    name = "web_search"
    description = "网络搜索工具：使用 HelixRAG 或 Tavily 进行搜索"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string"},
            "max_results": {"type": "integer", "default": 5}
        }
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)

        try:
            from flowforge.core.config import system_config
            if system_config.helixrag_enabled:
                from flowforge.tools.helixrag_client import HelixRAGClient
                client = HelixRAGClient()
                rag_input = ToolInput(params={"query": query, "max_results": max_results})
                result = await client.execute(rag_input)
                results = result.result.get("results", [])
                if results:
                    return ToolOutput(result={"results": results})
        except Exception:
            pass

        tavily_key = os.getenv("TAVILY_API_KEY", "")
        if tavily_key:
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.post(
                        "https://api.tavily.com/search",
                        json={"api_key": tavily_key, "query": query, "max_results": max_results}
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    results = data.get("results", [])
                    if results:
                        return ToolOutput(result={"results": results})
            except Exception as e:
                logger.warning(f"Tavily search failed: {e}")

        return ToolOutput(result={"results": [], "message": f"未找到与 '{query}' 相关的搜索结果"})
