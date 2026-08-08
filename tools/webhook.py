import httpx

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("webhook")


class WebhookTool(BaseTool):
    name = "webhook"
    description = "通用 Webhook 调用工具"
    parameters_schema = {
        "type": "object",
        "required": ["url"],
        "properties": {
            "url": {"type": "string"},
            "method": {
                "type": "string",
                "default": "POST",
                "enum": ["GET", "POST", "PUT", "DELETE"],
            },
            "headers": {"type": "object", "default": {}},
            "body": {"type": "object", "default": {}},
            "timeout": {"type": "integer", "default": 15},
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        url = input.params["url"]
        method = input.params.get("method", "POST").upper()
        headers = input.params.get("headers", {})
        body = input.params.get("body", {})
        timeout = input.params.get("timeout", 15)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if method == "GET":
                    resp = await client.get(url, headers=headers, params=body)
                elif method == "POST":
                    resp = await client.post(url, headers=headers, json=body)
                elif method == "PUT":
                    resp = await client.put(url, headers=headers, json=body)
                elif method == "DELETE":
                    resp = await client.delete(url, headers=headers)
                else:
                    return ToolOutput(result={}, error=f"Unsupported method: {method}")
                return ToolOutput(
                    result={"status_code": resp.status_code, "body": resp.text[:2000]}
                )
        except Exception as e:
            logger.error(f"Webhook call failed: {e}")
            return ToolOutput(result={"status_code": 0, "error": str(e)})
