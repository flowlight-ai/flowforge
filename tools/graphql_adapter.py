import os

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("graphql_adapter")


class GraphQLAdapter(BaseTool):
    name = "graphql"
    description = "GraphQL API 适配工具"
    parameters_schema = {
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string"},
            "variables": {"type": "object", "default": {}},
            "endpoint": {"type": "string"},
        },
    }

    def __init__(self, default_endpoint: str = None, auth: dict = None):
        self._default_endpoint = default_endpoint or ""
        self._auth = auth or {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        query = input.params["query"]
        variables = input.params.get("variables", {})
        endpoint = input.params.get("endpoint", self._default_endpoint)
        if not endpoint:
            return ToolOutput(result={}, error="No GraphQL endpoint specified")
        headers = {"Content-Type": "application/json"}
        if self._auth.get("type") == "bearer":
            token = os.getenv(self._auth.get("token_env", ""), "")
            if token:
                headers["Authorization"] = f"Bearer {token}"
        payload = {"query": query, "variables": variables}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(endpoint, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                if "errors" in data:
                    return ToolOutput(
                        result={"data": data.get("data"), "errors": data["errors"]},
                        error=str(data["errors"]),
                    )
                return ToolOutput(result=data)
        except Exception as e:
            logger.error(f"GraphQL request failed: {e}")
            return ToolOutput(result={}, error=str(e))
