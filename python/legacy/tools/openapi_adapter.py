import os
from typing import Dict

import httpx
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("openapi_adapter")


class OpenAPIAdapter(BaseTool):
    name = "openapi"
    description = "OpenAPI 规范自动适配工具"
    parameters_schema = {
        "type": "object",
        "required": ["operation_id"],
        "properties": {
            "operation_id": {"type": "string"},
            "parameters": {"type": "object", "default": {}},
            "request_body": {"type": "object", "default": {}},
        },
    }

    def __init__(self, spec_url: str = None, auth: dict = None):
        self._spec_url = spec_url
        self._auth = auth or {}
        self._spec = None
        self._base_url = ""

    async def _load_spec(self):
        if self._spec is not None:
            return
        if not self._spec_url:
            return
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(self._spec_url)
                resp.raise_for_status()
                self._spec = resp.json()
                servers = self._spec.get("servers", [])
                if servers:
                    self._base_url = servers[0].get("url", "")
        except Exception as e:
            logger.error(f"OpenAPI spec load failed: {e}")

    async def execute(self, input: ToolInput) -> ToolOutput:
        await self._load_spec()
        if not self._spec:
            return ToolOutput(result={}, error="OpenAPI spec not loaded")
        operation_id = input.params["operation_id"]
        parameters = input.params.get("parameters", {})
        request_body = input.params.get("request_body", {})
        for path, methods in self._spec.get("paths", {}).items():
            for method, details in methods.items():
                if details.get("operationId") == operation_id:
                    url = self._base_url + path
                    for param_name, param_value in parameters.items():
                        url = url.replace(f"{{{param_name}}}", str(param_value))
                    headers = {"Content-Type": "application/json"}
                    if self._auth.get("type") == "bearer":
                        token_env = self._auth.get("token_env", "")
                        token = os.getenv(token_env, "")
                        if token:
                            headers["Authorization"] = f"Bearer {token}"
                    try:
                        async with httpx.AsyncClient(timeout=15) as client:
                            if method.lower() == "get":
                                resp = await client.get(
                                    url, headers=headers, params=parameters
                                )
                            elif method.lower() == "post":
                                resp = await client.post(
                                    url, headers=headers, json=request_body
                                )
                            elif method.lower() == "put":
                                resp = await client.put(
                                    url, headers=headers, json=request_body
                                )
                            elif method.lower() == "delete":
                                resp = await client.delete(url, headers=headers)
                            else:
                                return ToolOutput(
                                    result={}, error=f"Unsupported method: {method}"
                                )
                            try:
                                return ToolOutput(result=resp.json())
                            except Exception:
                                return ToolOutput(
                                    result={
                                        "status_code": resp.status_code,
                                        "text": resp.text[:1000],
                                    }
                                )
                    except Exception as e:
                        return ToolOutput(result={}, error=str(e))
        return ToolOutput(
            result={}, error=f"Operation '{operation_id}' not found in spec"
        )
