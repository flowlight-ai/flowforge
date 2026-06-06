import httpx
import re
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("web_scraper")


class WebScraperTool(BaseTool):
    name = "web_scraper"
    description = "网页内容抓取：抓取指定URL的全文内容"
    parameters_schema = {
        "type": "object",
        "required": ["url"],
        "properties": {
            "url": {"type": "string", "description": "目标URL"},
            "timeout": {"type": "integer", "default": 15, "description": "超时秒数"},
            "max_length": {"type": "integer", "default": 5000, "description": "最大内容长度"},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        url = input.params["url"]
        timeout = input.params.get("timeout", 15)
        max_length = input.params.get("max_length", 5000)

        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                text = resp.text
                text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', text)
                text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', text)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()[:max_length]
                return ToolOutput(result={"content": text, "url": url, "length": len(text)})
        except httpx.TimeoutException:
            return ToolOutput(result={"error": "timeout", "url": url}, error="Request timeout")
        except httpx.ConnectError as e:
            return ToolOutput(result={"error": "connection failed", "url": url}, error=str(e))
        except Exception as e:
            return ToolOutput(result={"error": str(e), "url": url}, error=str(e))
