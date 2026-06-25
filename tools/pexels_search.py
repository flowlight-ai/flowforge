import os
from typing import Any, Dict, List

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("pexels_search")


class PexelsSearchTool(BaseTool):
    name = "pexels_search"
    description = "Search Pexels for royalty-free images"
    safety_level = "readonly"
    is_concurrency_safe = True
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {
                "type": "string",
                "description": "Search keywords",
            },
            "per_page": {
                "type": "integer",
                "default": 5,
                "description": "Number of results per page",
            },
            "orientation": {
                "type": "string",
                "default": "landscape",
                "enum": ["landscape", "portrait", "square"],
                "description": "Image orientation filter",
            },
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        query: str = input.params["query"]
        per_page: int = input.params.get("per_page", 5)
        orientation: str = input.params.get("orientation", "landscape")

        api_key = os.getenv("PEXELS_API_KEY", "")
        if not api_key:
            logger.info("PEXELS_API_KEY not configured, returning empty results")
            return ToolOutput(result={"images": [], "total": 0})

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

            images: List[Dict[str, Any]] = []
            for photo in data.get("photos", []):
                src = photo.get("src", {})
                images.append({
                    "url": src.get("large", ""),
                    "thumbnail": src.get("small", ""),
                    "width": photo.get("width", 0),
                    "height": photo.get("height", 0),
                    "alt": photo.get("alt", ""),
                    "photographer": photo.get("photographer", ""),
                })

            return ToolOutput(
                result={"images": images, "total": data.get("total_results", 0)}
            )
        except httpx.TimeoutException:
            logger.warning(f"Pexels search timeout for query: {query}")
            return ToolOutput(result={"images": [], "total": 0}, error="Request timeout")
        except httpx.HTTPStatusError as e:
            logger.warning(f"Pexels API error: {e.response.status_code}")
            return ToolOutput(
                result={"images": [], "total": 0},
                error=f"Pexels API returned {e.response.status_code}",
            )
        except Exception as e:
            logger.error(f"Pexels search failed: {e}")
            return ToolOutput(result={"images": [], "total": 0}, error=str(e))
