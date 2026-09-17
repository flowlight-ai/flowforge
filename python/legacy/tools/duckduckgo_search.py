import re
import urllib.parse
import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("duckduckgo_search")

_DDGS_HTML_URL = "https://html.duckduckgo.com/html/"
_DDGS_API_URL = "https://api.duckduckgo.com/"


class DuckDuckGoSearchTool(BaseTool):
    name = "duckduckgo_search"
    description = "DuckDuckGo 搜索工具：通过 HTML 解析获取搜索结果"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "max_results": {"type": "integer", "default": 5, "description": "最大结果数"},
        },
    }

    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)

        try:
            results = await self._search_html(query, max_results)
            if results:
                return ToolOutput(result={"results": results, "source": "duckduckgo"})
        except Exception as e:
            logger.warning(f"DuckDuckGo HTML search failed: {e}")

        try:
            results = await self._search_instant_answer(query, max_results)
            if results:
                return ToolOutput(result={"results": results, "source": "duckduckgo"})
        except Exception as e:
            logger.warning(f"DuckDuckGo Instant Answer search failed: {e}")

        return ToolOutput(result={"results": [], "error": "DuckDuckGo search returned no results"})

    async def _search_html(self, query: str, max_results: int) -> list[dict]:
        params = {"q": query, "b": ""}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }

        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            resp = await client.post(_DDGS_HTML_URL, data=params, headers=headers)
            resp.raise_for_status()
            return self._parse_html_results(resp.text, max_results)

    def _parse_html_results(self, html: str, max_results: int) -> list[dict]:
        results = []
        result_blocks = re.findall(
            r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
            r'.*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
            html,
            re.DOTALL,
        )
        for url, title, snippet in result_blocks[:max_results]:
            clean_title = re.sub(r"<[^>]+>", "", title).strip()
            clean_snippet = re.sub(r"<[^>]+>", "", snippet).strip()
            results.append({
                "title": clean_title,
                "url": url,
                "content": clean_snippet,
                "source_type": "duckduckgo_search",
            })

        if not results:
            result_blocks = re.findall(
                r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
                html,
                re.DOTALL,
            )
            for url, title in result_blocks[:max_results]:
                clean_title = re.sub(r"<[^>]+>", "", title).strip()
                results.append({
                    "title": clean_title,
                    "url": url,
                    "content": "",
                    "source_type": "duckduckgo_search",
                })

        return results

    async def _search_instant_answer(self, query: str, max_results: int) -> list[dict]:
        params = {
            "q": query,
            "format": "json",
            "no_html": 1,
            "skip_disambig": 1,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(_DDGS_API_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        results = []
        abstract = data.get("Abstract")
        if abstract:
            results.append({
                "title": data.get("Heading", query),
                "url": data.get("AbstractURL", ""),
                "content": abstract,
                "source_type": "duckduckgo_search",
            })

        for topic in data.get("RelatedTopics", [])[:max_results - len(results)]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append({
                    "title": topic.get("Text", "")[:80],
                    "url": topic.get("FirstURL", ""),
                    "content": topic.get("Text", ""),
                    "source_type": "duckduckgo_search",
                })

        return results[:max_results]
