"""OpenSieve RAG Client — FlowForge's primary retrieval service.

Replaces the old HelixRAGClient with a ToolPlugin-compatible implementation.
All config is injected through the constructor — no direct `system_config` import,
no hardcoded URLs.

OpenSieve is the renamed HelixRAG service, providing vector search and
document retrieval capabilities via HTTP API.
"""

import httpx
from typing import Any, Dict, Optional

from flowforge.core.interfaces.tools import (
    PluginHealth,
    PluginManifest,
    PluginState,
    ToolPlugin,
)
from flowforge.core.tracing import get_logger

logger = get_logger("opensieve_client")


class OpenSieveClient(ToolPlugin):
    """OpenSieve RAG retrieval tool — ToolPlugin implementation.

    Accepts all config through constructor (DI injection).
    No direct imports of system_config or other tools.

    Usage via PluginRegistry:
        result = await registry.execute("opensieve_search", {"query": "..."})
    """

    manifest = PluginManifest(
        name="opensieve_search",
        description="OpenSieve RAG 检索服务",
        tags=["search", "retrieval"],
        parameters_schema={
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "description": "搜索查询"},
                "max_results": {"type": "integer", "default": 5},
                "min_score": {"type": "number", "default": 0.3},
                "max_age_days": {"type": "integer", "default": 30},
            },
        },
    )

    def __init__(
        self,
        endpoint: str = "http://localhost:8100/api/v1/retrieve",
        timeout: int = 90,
        **kwargs: Any,
    ):
        """Initialize OpenSieve client with config injection.

        Args:
            endpoint: Full URL to the retrieve endpoint.
            timeout: HTTP request timeout in seconds.
            **kwargs: Additional config (ignored for forward compatibility).
        """
        full_url = endpoint
        if "/api/v1/retrieve" in full_url:
            self.base_url = full_url.rsplit("/api/v1/retrieve", 1)[0]
            self.retrieve_url = full_url
        else:
            self.base_url = full_url
            self.retrieve_url = f"{full_url}/api/v1/retrieve"
        self.timeout = int(timeout)
        self.enabled = True

    async def startup(self) -> None:
        """Called by PluginRegistry after registration."""
        logger.info(
            f"OpenSieveClient initialized: endpoint={self.retrieve_url}, "
            f"timeout={self.timeout}"
        )

    async def shutdown(self) -> None:
        """No resources to clean up."""
        pass

    async def health_check(self) -> PluginHealth:
        """Check OpenSieve service health via /health endpoint."""
        try:
            start_time = __import__("time").time()
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base_url}/health")
                latency = (__import__("time").time() - start_time) * 1000
                if resp.status_code == 200:
                    return PluginHealth(
                        state=PluginState.READY,
                        latency_ms=latency,
                        last_check=__import__("time").time(),
                    )
                return PluginHealth(
                    state=PluginState.DEGRADED,
                    message=f"Health endpoint returned {resp.status_code}",
                    latency_ms=latency,
                    last_check=__import__("time").time(),
                )
        except Exception as e:
            return PluginHealth(
                state=PluginState.STOPPED,
                message=str(e),
                last_check=__import__("time").time(),
            )

    async def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a search query against OpenSieve.

        Args:
            params: Must contain 'query'. Optional: max_results, min_score, max_age_days.

        Returns:
            Dict with 'results' list and optional 'metadata'.
        """
        if not self.enabled:
            logger.warning("OpenSieve is disabled")
            return {"results": [], "metadata": {}}

        query = params["query"]
        max_results = params.get("max_results", 5)
        min_score = params.get("min_score", 0.3)
        max_age_days = params.get("max_age_days", 30)

        payload = {
            "query": query,
            "min_score": min_score,
            "max_results": max_results,
            "max_age_days": max_age_days,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(self.retrieve_url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                logger.info(
                    f"OpenSieve search returned {len(data.get('results', []))} results"
                )
                return data
        except Exception as e:
            logger.error(f"OpenSieve search failed: {e}")
            return {"results": [], "metadata": {}, "error": str(e)}

    async def scrape_url(self, url: str, timeout: int = 15) -> dict:
        """Scrape a URL through OpenSieve's scrape endpoint.

        Args:
            url: URL to scrape.
            timeout: Request timeout.

        Returns:
            Dict with content, images, and metadata.
        """
        scrape_url = f"{self.base_url}/api/scrape"
        payload = {"url": url, "timeout": timeout}
        try:
            async with httpx.AsyncClient(timeout=timeout + 10) as client:
                resp = await client.post(scrape_url, json=payload)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.error(f"OpenSieve scrape failed for {url}: {e}")
            return {"content": "", "images": [], "metadata": {}}
