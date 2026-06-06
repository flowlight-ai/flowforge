import os
import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("opensieve_client")


class OpenSieveClient(BaseTool):
    name = "opensieve_search"
    description = "OpenSieve/HelixRAG RAG 检索服务：混合语义搜索"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "搜索查询"},
            "max_results": {"type": "integer", "default": 5, "description": "最大结果数"},
            "min_score": {"type": "number", "default": 0.3, "description": "最低相关度分数"},
            "max_age_days": {"type": "integer", "default": 30, "description": "最大天数"},
        },
    }

    def __init__(self, endpoint: str = None, timeout: int = 90):
        self.endpoint = endpoint or os.getenv(
            "OPENSIEVE_ENDPOINT", "http://localhost:8100/api/v1/retrieve"
        )
        self.timeout = timeout

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        max_results = input.params.get("max_results", 5)
        min_score = input.params.get("min_score", 0.3)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    self.endpoint,
                    json={
                        "query": query,
                        "max_results": max_results,
                        "min_score": min_score,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results", data.get("items", []))
                return ToolOutput(result={"results": results, "source": "opensieve"})
        except httpx.ConnectError:
            logger.warning(f"OpenSieve service unavailable at {self.endpoint}")
            return ToolOutput(result={"results": [], "error": "service unavailable"})
        except Exception as e:
            logger.error(f"OpenSieve search error: {e}")
            return ToolOutput(result={"results": [], "error": str(e)})
