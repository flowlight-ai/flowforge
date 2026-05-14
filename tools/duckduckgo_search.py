import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("duckduckgo_search")


class DuckDuckGoSearchTool(BaseTool):
    name = "duckduckgo_search"
    description = "DuckDuckGo 搜索，无需 API Key"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string"},
            "max_results": {"type": "integer", "default": 5},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.duckduckgo.com/",
                    params={"q": query, "format": "json", "no_html": 1},
                )
                resp.raise_for_status()
                data = resp.json()
                results = []
                for topic in data.get("RelatedTopics", [])[:max_results]:
                    if isinstance(topic, dict) and "Text" in topic:
                        results.append(
                            {
                                "title": topic.get("Text", "")[:100],
                                "url": topic.get("FirstURL", ""),
                                "content": topic.get("Text", ""),
                            }
                        )
                abstract = data.get("Abstract", "")
                if abstract:
                    results.insert(
                        0,
                        {
                            "title": data.get("Heading", ""),
                            "url": data.get("AbstractURL", ""),
                            "content": abstract,
                        },
                    )
                return ToolOutput(result={"results": results})
        except Exception as e:
            logger.error(f"DuckDuckGo search failed: {e}")
            return ToolOutput(result={"results": [], "error": str(e)})
