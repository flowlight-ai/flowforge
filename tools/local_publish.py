import os
from datetime import datetime
from pathlib import Path
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("local_publish")


class LocalPublishTool(BaseTool):
    name = "local_publish"
    description = "本地文件发布：将文章保存为本地 Markdown 文件"
    parameters_schema = {
        "type": "object",
        "required": ["title", "content"],
        "properties": {
            "title": {"type": "string", "description": "文章标题"},
            "content": {"type": "string", "description": "文章内容"},
            "platform": {"type": "string", "default": "local", "description": "平台标识"},
        },
    }

    def __init__(self, output_dir: str = None):
        self.output_dir = output_dir or os.getenv(
            "LOCAL_PUBLISH_DIR", "data/published"
        )

    async def execute(self, input: ToolInput) -> ToolOutput:
        title = input.params.get("title", "untitled")
        content = input.params.get("content", "")
        platform = input.params.get("platform", "local")

        output_path = Path(self.output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        safe_title = "".join(c for c in title if c.isalnum() or c in " _-").strip()
        if not safe_title:
            safe_title = f"article_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        filename = f"{safe_title}.md"
        filepath = output_path / filename

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            logger.info(f"Local publish: saved '{title}' to {filepath}")
            return ToolOutput(result={
                "success": True,
                "path": str(filepath),
                "platform": platform,
            })
        except Exception as e:
            logger.error(f"Local publish failed: {e}")
            return ToolOutput(result={"success": False, "error": str(e)})
