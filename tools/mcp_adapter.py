import asyncio
import json
from typing import Any, Dict, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("mcp_adapter")


class MCPToolAdapter(BaseTool):
    name = "mcp"
    description = "MCP (Model Context Protocol) 工具适配器"
    parameters_schema = {
        "type": "object",
        "required": ["tool_name"],
        "properties": {
            "tool_name": {"type": "string"},
            "arguments": {"type": "object", "default": {}},
        },
    }

    def __init__(self, server_config: dict = None):
        self._server_config = server_config or {}
        self._process = None
        self._tools_cache: Dict[str, dict] = {}

    async def _ensure_process(self):
        if self._process is not None:
            return
        command = self._server_config.get("command", "")
        args = self._server_config.get("args", [])
        if not command:
            return
        try:
            self._process = await asyncio.create_subprocess_exec(
                command,
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await self._send_request(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "flowforge", "version": "0.1.0"},
                    },
                }
            )
        except Exception as e:
            logger.error(f"MCP process start failed: {e}")

    async def _send_request(self, request: dict) -> Optional[dict]:
        if not self._process or self._process.stdin is None:
            return None
        msg = json.dumps(request) + "\n"
        self._process.stdin.write(msg.encode())
        await self._process.stdin.drain()
        line = await self._process.stdout.readline()
        if line:
            return json.loads(line.decode().strip())
        return None

    async def execute(self, input: ToolInput) -> ToolOutput:
        tool_name = input.params["tool_name"]
        arguments = input.params.get("arguments", {})
        await self._ensure_process()
        if not self._process:
            return ToolOutput(result={}, error="MCP server not available")
        response = await self._send_request(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            }
        )
        if response and "result" in response:
            return ToolOutput(result=response["result"])
        error_msg = (
            response.get("error", {}).get("message", "Unknown MCP error")
            if response
            else "No response"
        )
        return ToolOutput(result={}, error=error_msg)

    async def list_tools(self) -> list:
        await self._ensure_process()
        if not self._process:
            return []
        response = await self._send_request(
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}}
        )
        if response and "result" in response:
            return response["result"].get("tools", [])
        return []

    async def close(self):
        if self._process:
            self._process.terminate()
            await self._process.wait()
            self._process = None
