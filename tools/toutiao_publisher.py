import os

import httpx

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("toutiao_publisher")


class ToutiaoPublisherTool(BaseTool):
    name = "publish_toutiao"
    description = "今日头条/头条号文章发布工具"
    parameters_schema = {
        "type": "object",
        "required": ["title", "content"],
        "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"},
            "cover_image": {"type": "string"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        title = input.params["title"]
        content = input.params["content"]
        access_token = os.getenv("TOUTIAO_ACCESS_TOKEN", "")
        if not access_token:
            return ToolOutput(
                result={
                    "url": "",
                    "status": "skipped",
                    "reason": "TOUTIAO_ACCESS_TOKEN not configured",
                }
            )
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://open.toutiao.com/api/v2/article/create",
                    json={
                        "title": title,
                        "content": content,
                        "access_token": access_token,
                    },
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()
                article_id = data.get("data", {}).get("article_id", "")
                return ToolOutput(
                    result={
                        "url": f"https://www.toutiao.com/article/{article_id}",
                        "article_id": article_id,
                        "status": "published",
                    }
                )
        except Exception as e:
            logger.error(f"Toutiao publish failed: {e}")
            return ToolOutput(result={"url": "", "status": "failed", "error": str(e)})
