"""MCP Client - L1 Protocol Layer.

Implements FR-CAP-03 L1:
- JSON-RPC 2.0 client
- stdio / HTTP / WebSocket triple transport
- Tool discovery with 5-minute TTL cache
- Server-name aware routing (for broker integration)
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
    over stdio, HTTP, or WebSocket transport.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._tool_cache: Dict[str, Any] = {}
        self._cache_timestamp: float = 0
        self._process: Optional[subprocess.Popen] = None
        self._ws: Optional[Any] = None  # websockets client
        self._connected = False
        self._request_id = 0
        self._timeout = self.config.get("timeout", 30)
        self._server_name: Optional[str] = self.config.get("server_name")
        self._transport: Optional[str] = None  # "stdio" | "http" | "ws"

    @property
    def server_name(self) -> Optional[str]:
        """Get the server name this client is connected to."""
        return self._server_name

    async def connect(
        self,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        url: Optional[str] = None,
        ws_url: Optional[str] = None,
        server_name: Optional[str] = None,
    ) -> bool:
        """Connect to an MCP server.

        Args:
            command: Command to start stdio server
            args: Command arguments
            url: HTTP server URL
            ws_url: WebSocket server URL
            server_name: Logical name for this server (used by broker)

        Returns:
            True if connected successfully
        """
        if server_name:
            self._server_name = server_name

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
                self._transport = "stdio"
                logger.info(f"MCP client connected via stdio: {command}")
                return True
            except Exception as e:
                logger.error(f"Failed to connect MCP server via stdio: {e}")
                return False

        if ws_url:
            try:
                import websockets
                self._ws = await asyncio.wait_for(
                    websockets.connect(ws_url),
                    timeout=self._timeout,
                )
                self.config["ws_url"] = ws_url
                self._connected = True
                self._transport = "ws"
                logger.info(f"MCP client connected via WebSocket: {ws_url}")
                return True
            except ImportError:
                logger.warning("websockets library not installed, falling back to HTTP")
            except Exception as e:
                logger.error(f"Failed to connect MCP server via WebSocket: {e}")
                return False

        if url:
            self.config["url"] = url
            self._connected = True
            self._transport = "http"
            logger.info(f"MCP client connected via HTTP: {url}")
            return True

        logger.warning("No connection method specified")
        return False

    async def list_tools(self, server_name: Optional[str] = None, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """List available tools from the MCP server.

        Args:
            server_name: Optional server name (ignored for single-server client,
                         used for API consistency with broker).
            force_refresh: Force refresh the tool cache.

        Returns:
            List of tool definitions.
        """
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

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        server_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Call a tool on the MCP server via JSON-RPC 2.0.

        Args:
            tool_name: Name of the tool to call.
            arguments: Arguments to pass to the tool.
            server_name: Optional server name (ignored for single-server client,
                         used for API consistency with broker).

        Returns:
            Dict with 'result' and 'error' keys.
        """
        if not self._connected:
            return {"result": None, "error": "Not connected to MCP server"}

        try:
            response = await self._send_jsonrpc("tools/call", {"name": tool_name, "arguments": arguments})
            if "error" in response:
                return {"result": None, "error": response["error"].get("message", str(response["error"]))}
            return {"result": response.get("result"), "error": None}
        except Exception as e:
            logger.error(f"MCP call_tool '{tool_name}' failed: {e}")
            return {"result": None, "error": str(e)}

    async def _send_jsonrpc(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send a JSON-RPC 2.0 request and return the response.

        Automatically selects the transport based on connection state:
        stdio > websocket > http
        """
        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }

        if self._process and self._process.stdin and self._process.stdout:
            return await self._send_jsonrpc_stdio(request)
        elif self._ws is not None:
            return await self._send_jsonrpc_ws(request)
        elif "url" in self.config:
            return await self._send_jsonrpc_http(request)
        else:
            raise RuntimeError("No transport available (neither stdio process, WebSocket, nor HTTP url configured)")

    async def _send_jsonrpc_stdio(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send JSON-RPC request via stdio transport."""
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
        """Send JSON-RPC request via HTTP transport."""
        url = self.config["url"]
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=request, headers={"Content-Type": "application/json"})
            resp.raise_for_status()
            return resp.json()

    async def _send_jsonrpc_ws(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send JSON-RPC request via WebSocket transport."""
        if self._ws is None:
            raise RuntimeError("WebSocket not connected")

        payload = json.dumps(request)
        await asyncio.wait_for(self._ws.send(payload), timeout=self._timeout)

        response_raw = await asyncio.wait_for(self._ws.recv(), timeout=self._timeout)
        response = json.loads(response_raw)

        if "error" in response:
            return response

        return response

    async def disconnect(self):
        """Disconnect from the MCP server."""
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        if self._process:
            self._process.terminate()
            self._process = None

        self._connected = False
        self._transport = None
        self._tool_cache = {}
        logger.info("MCP client disconnected")

    def get_status(self) -> dict:
        """Get client status."""
        return {
            "connected": self._connected,
            "transport": self._transport,
            "server_name": self._server_name,
            "cached_tools": len(self._tool_cache),
            "cache_age_seconds": time.time() - self._cache_timestamp if self._cache_timestamp else 0,
        }
