import os
import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("pexels_image")


class PexelsImageTool(BaseTool):
    name = "pexels_image"
    description = "Pexels 图片搜索：搜索高质量免费图片"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "搜索关键词"},
            "per_page": {"type": "integer", "default": 5, "description": "每页结果数"},
            "orientation": {"type": "string", "default": "landscape", "enum": ["landscape", "portrait", "square"]},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        per_page = input.params.get("per_page", 5)
        orientation = input.params.get("orientation", "landscape")

        api_key = os.getenv("PEXELS_API_KEY", "")
        if not api_key:
            return ToolOutput(
                result={"images": [], "error": "PEXELS_API_KEY 未配置"},
                error="PEXELS_API_KEY 未配置",
            )

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.pexels.com/v1/search",
                    params={"query": query, "per_page": per_page, "orientation": orientation},
                    headers={"Authorization": api_key},
                )
                resp.raise_for_status()
                data = resp.json()

            images = []
            for photo in data.get("photos", []):
                images.append({
                    "id": photo.get("id"),
                    "url": photo.get("src", {}).get("large", ""),
                    "thumbnail": photo.get("src", {}).get("small", ""),
                    "alt": photo.get("alt", ""),
                    "photographer": photo.get("photographer", ""),
                    "width": photo.get("width", 0),
                    "height": photo.get("height", 0),
                })

            return ToolOutput(result={"images": images, "total": data.get("total_results", 0)})
        except Exception as e:
            logger.error(f"Pexels search failed: {e}")
            return ToolOutput(result={"images": [], "error": str(e)})
