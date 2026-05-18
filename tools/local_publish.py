import os
import json
import time
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("local_publish_tool")


class LocalPublishTool(BaseTool):
    name = "publish_local"
    description = "本地发布工具：将内容保存为本地文件，模拟发布流程"
    parameters_schema = {
        "type": "object",
        "required": ["title", "content"],
        "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"},
            "platform": {"type": "string", "default": "local"},
        }
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        title = input.params.get("title", "untitled")
        content = input.params.get("content", "")
        platform = input.params.get("platform", "local")

        publish_dir = os.path.join(os.getcwd(), "data", "published")
        os.makedirs(publish_dir, exist_ok=True)

        safe_title = "".join(c for c in title[:50] if c.isalnum() or c in " _-").strip()
        if not safe_title:
            safe_title = f"article_{int(time.time())}"
        filename = f"{safe_title}.md"
        filepath = os.path.join(publish_dir, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n")
            f.write(content)

        url = f"file://{filepath}"
        logger.info(f"Published to {platform}: {url}")

        return ToolOutput(result={
            "url": url,
            "platform": platform,
            "status": "published",
            "filename": filename,
        })
