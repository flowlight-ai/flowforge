import os

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("pexels_image")


class PexelsImageTool(BaseTool):
    name = "pexels_image"
    description = "Pexels 图片搜索工具"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string"},
            "per_page": {"type": "integer", "default": 5},
            "orientation": {
                "type": "string",
                "default": "landscape",
                "enum": ["landscape", "portrait", "square"],
            },
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        api_key = os.getenv("PEXELS_API_KEY", "")
        if not api_key:
            return ToolOutput(result={"images": [], "error": "PEXELS_API_KEY not set"})
        query = input.params["query"]
        per_page = input.params.get("per_page", 5)
        orientation = input.params.get("orientation", "landscape")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.pexels.com/v1/search",
                    params={
                        "query": query,
                        "per_page": per_page,
                        "orientation": orientation,
                    },
                    headers={"Authorization": api_key},
                )
                resp.raise_for_status()
                data = resp.json()
                images = [
                    {
                        "url": p.get("url", ""),
                        "src": p.get("src", {}).get("large", ""),
                        "alt": p.get("alt", ""),
                        "photographer": p.get("photographer", ""),
                    }
                    for p in data.get("photos", [])
                ]
                return ToolOutput(result={"images": images})
        except Exception as e:
            logger.error(f"Pexels search failed: {e}")
            return ToolOutput(result={"images": [], "error": str(e)})
