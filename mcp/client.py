"""MCP Client - L1 Protocol Layer.

Implements FR-CAP-03 L1:
- JSON-RPC 2.0 client
- stdio / Streamable HTTP dual transport
- Tool discovery with 5-minute TTL cache
"""

import json
import time
import asyncio
import subprocess
from typing import Optional, Dict, Any, List
import httpx
from flowforge.core.tracing import get_logger

logger = get_logger("mcp.client")

CACHE_TTL = 300  # 5 minutes


class MCPClient:
    """MCP protocol client.

    Communicates with MCP servers via JSON-RPC 2.0
    over stdio or HTTP transport.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._tool_cache: Dict[str, Any] = {}
        self._cache_timestamp: float = 0
        self._process: Optional[subprocess.Popen] = None
        self._connected = False
        self._request_id = 0
        self._timeout = self.config.get("timeout", 30)

    async def connect(self, command: Optional[str] = None, args: Optional[List[str]] = None,
                      url: Optional[str] = None) -> bool:
        """Connect to an MCP server.

        Args:
            command: Command to start stdio server
            args: Command arguments
            url: HTTP server URL

        Returns:
            True if connected successfully
        """
        if command:
            try:
                full_cmd = [command] + (args or [])
                self._process = subprocess.Popen(
                    full_cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                self._connected = True
                logger.info(f"MCP client connected via stdio: {command}")
                return True
            except Exception as e:
                logger.error(f"Failed to connect MCP server: {e}")
                return False

        if url:
            self._connected = True
            logger.info(f"MCP client connected via HTTP: {url}")
            return True

        logger.warning("No connection method specified")
        return False

    async def list_tools(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        if not force_refresh and self._tool_cache and (now - self._cache_timestamp) < CACHE_TTL:
            return list(self._tool_cache.values())

        if not self._connected:
            logger.warning("MCP list_tools called while not connected")
            return []

        try:
            response = await self._send_jsonrpc("tools/list", {})
            tools = response.get("result", {}).get("tools", [])
            self._tool_cache = {t["name"]: t for t in tools if "name" in t}
            self._cache_timestamp = now
            return tools
        except Exception as e:
            logger.error(f"MCP list_tools failed: {e}")
            return []

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if not self._connected:
            return {"error": "Not connected to MCP server"}

        try:
            response = await self._send_jsonrpc("tools/call", {"name": tool_name, "arguments": arguments})
            if "error" in response:
                return {"result": None, "error": response["error"].get("message", str(response["error"]))}
            return {"result": response.get("result"), "error": None}
        except Exception as e:
            logger.error(f"MCP call_tool '{tool_name}' failed: {e}")
            return {"result": None, "error": str(e)}

    async def _send_jsonrpc(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }

        if self._process and self._process.stdin and self._process.stdout:
            return await self._send_jsonrpc_stdio(request)
        elif "url" in self.config:
            return await self._send_jsonrpc_http(request)
        else:
            raise RuntimeError("No transport available (neither stdio process nor HTTP url configured)")

    async def _send_jsonrpc_stdio(self, request: Dict[str, Any]) -> Dict[str, Any]:
        payload = json.dumps(request) + "\n"
        loop = asyncio.get_event_loop()

        def _write_and_read():
            if self._process is None or self._process.stdin is None or self._process.stdout is None:
                raise RuntimeError("stdio process not available")
            self._process.stdin.write(payload.encode("utf-8"))
            self._process.stdin.flush()
            response_line = self._process.stdout.readline()
            if not response_line:
                raise RuntimeError("Empty response from MCP server")
            return json.loads(response_line.decode("utf-8"))

        return await asyncio.wait_for(loop.run_in_executor(None, _write_and_read), timeout=self._timeout)

    async def _send_jsonrpc_http(self, request: Dict[str, Any]) -> Dict[str, Any]:
        url = self.config["url"]
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=request, headers={"Content-Type": "application/json"})
            resp.raise_for_status()
            return resp.json()

    async def disconnect(self):
        """Disconnect from the MCP server."""
        if self._process:
            self._process.terminate()
            self._process = None
        self._connected = False
        self._tool_cache = {}
        logger.info("MCP client disconnected")

    def get_status(self) -> dict:
        """Get client status."""
        return {
            "connected": self._connected,
            "cached_tools": len(self._tool_cache),
            "cache_age_seconds": time.time() - self._cache_timestamp if self._cache_timestamp else 0,
        }
