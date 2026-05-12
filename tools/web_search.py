import os
import httpx
from core.base_tool import BaseTool, ToolInput, ToolOutput
from core.config import system_config


class WebSearchTool(BaseTool):
    name = "web_search"
    description = "调用 HelixRAG 或 Tavily 进行实时网络检索"
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

        if system_config.helixrag_enabled:
            try:
                from tools.helixrag_client import HelixRAGClient
                client = HelixRAGClient()
                rag_input = ToolInput(params={"query": query, "max_results": max_results})
                result = await client.execute(rag_input)
                return ToolOutput(result={"results": result.result.get("results", [])})
            except Exception:
                pass

        tavily_key = os.getenv("TAVILY_API_KEY", "")
        if not tavily_key:
            return ToolOutput(result={"results": [], "error": "No search provider available"})
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": tavily_key, "query": query, "max_results": max_results}
                )
                resp.raise_for_status()
                data = resp.json()
                return ToolOutput(result={"results": data.get("results", [])})
        except Exception as e:
            return ToolOutput(result={"results": [], "error": str(e)})
