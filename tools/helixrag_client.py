import httpx
from core.base_tool import BaseTool, ToolInput, ToolOutput
from core.tracing import get_logger
from core.config import system_config

logger = get_logger("helixrag_client")


class HelixRAGClient(BaseTool):
    name = "helixrag_search"
    description = "HelixRAG 检索工具，封装对 HelixRAG 服务的 HTTP 调用"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string"},
            "max_results": {"type": "integer", "default": 5},
            "min_score": {"type": "number", "default": 0.3},
            "max_age_days": {"type": "integer", "default": 30},
        }
    }

    def __init__(self):
        full_url = system_config.helixrag_endpoint
        if "/api/v1/retrieve" in full_url:
            self.base_url = full_url.rsplit("/api/v1/retrieve", 1)[0]
            self.retrieve_url = full_url
        else:
            self.base_url = full_url
            self.retrieve_url = f"{full_url}/api/v1/retrieve"
        self.timeout = system_config.helixrag_timeout
        self.enabled = system_config.helixrag_enabled

    async def execute(self, input: ToolInput) -> ToolOutput:
        if not self.enabled:
            logger.warning("HelixRAG is disabled")
            return ToolOutput(result={"results": [], "metadata": {}})

        query = input.params["query"]
        max_results = input.params.get("max_results", 5)
        min_score = input.params.get("min_score", 0.3)
        max_age_days = input.params.get("max_age_days", 30)

        payload = {"query": query, "min_score": min_score, "max_results": max_results, "max_age_days": max_age_days}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(self.retrieve_url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                logger.info(f"HelixRAG search returned {len(data.get('results', []))} results")
                return ToolOutput(result=data)
        except Exception as e:
            logger.error(f"HelixRAG search failed: {e}")
            return ToolOutput(result={"results": [], "metadata": {}}, error=str(e))

    async def scrape_url(self, url: str, timeout: int = 15) -> dict:
        scrape_url = f"{self.base_url}/api/scrape"
        payload = {"url": url, "timeout": timeout}
        try:
            async with httpx.AsyncClient(timeout=timeout + 10) as client:
                resp = await client.post(scrape_url, json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.error(f"HelixRAG scrape failed for {url}: {e}")
            return {"content": "", "images": [], "metadata": {}}

    async def health_check(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/health")
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {"status": "unhealthy"}
