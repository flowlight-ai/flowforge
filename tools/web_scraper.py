import re

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("web_scraper")


class WebScraperTool(BaseTool):
    name = "web_scraper"
    description = "网页抓取工具，提取页面文本和元数据"
    parameters_schema = {
        "type": "object",
        "required": ["url"],
        "properties": {
            "url": {"type": "string"},
            "timeout": {"type": "integer", "default": 15},
            "max_length": {"type": "integer", "default": 5000},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        url = input.params["url"]
        timeout = input.params.get("timeout", 15)
        max_length = input.params.get("max_length", 5000)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (compatible; FlowForge/1.0)"},
                )
                resp.raise_for_status()
                html = resp.text
                text = self._extract_text(html)
                title = self._extract_title(html)
                return ToolOutput(
                    result={
                        "title": title,
                        "content": text[:max_length],
                        "url": url,
                        "length": len(text),
                    }
                )
        except Exception as e:
            logger.error(f"Web scrape failed for {url}: {e}")
            return ToolOutput(
                result={"title": "", "content": "", "url": url, "error": str(e)}
            )

    def _extract_text(self, html: str) -> str:
        html = re.sub(
            r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(
            r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE
        )
        html = re.sub(r"<[^>]+>", " ", html)
        html = re.sub(r"\s+", " ", html)
        return html.strip()

    def _extract_title(self, html: str) -> str:
        match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
        return match.group(1).strip() if match else ""
