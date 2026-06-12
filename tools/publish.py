from typing import Any, Dict, List

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("publish")


class PublishTool(BaseTool):
    name = "publish"
    description = "Publish content to platforms via browser automation"
    safety_level = "dangerous"
    is_concurrency_safe = False
    parameters_schema = {
        "type": "object",
        "required": ["platform", "title", "content"],
        "properties": {
            "platform": {
                "type": "string",
                "description": "Target platform (e.g. wechat, toutiao, zhihu)",
            },
            "title": {
                "type": "string",
                "description": "Article title",
            },
            "content": {
                "type": "string",
                "description": "Article content in HTML or Markdown",
            },
            "publish_mode": {
                "type": "string",
                "default": "draft",
                "enum": ["draft", "publish"],
                "description": "Publish as draft or directly",
            },
            "images": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
                "description": "List of local image paths to attach",
            },
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        platform: str = input.params["platform"]
        title: str = input.params["title"]
        content: str = input.params["content"]
        publish_mode: str = input.params.get("publish_mode", "draft")
        images: List[str] = input.params.get("images", [])

        # Validate required params
        if not platform.strip():
            return ToolOutput(result={}, error="Platform cannot be empty")
        if not title.strip():
            return ToolOutput(result={}, error="Title cannot be empty")
        if not content.strip():
            return ToolOutput(result={}, error="Content cannot be empty")

        # STUB: actual Playwright automation will be ported from hiclaw later
        logger.info(
            f"Publish stub: platform={platform}, title={title[:30]}..., "
            f"mode={publish_mode}, images={len(images)}"
        )

        return ToolOutput(
            result={
                "success": False,
                "url": "",
                "message": "Publish not yet implemented — Playwright automation pending",
                "platform": platform,
                "publish_mode": publish_mode,
            }
        )
