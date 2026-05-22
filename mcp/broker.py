"""MCP Broker - L3 Proxy Layer.

Implements FR-CAP-03 L3:
- Multi-server aggregation
- tool_name→server_name index (not traversal)
- Circuit breaker (5 consecutive failures trigger)
- Retry (3 times, exponential backoff)
"""

import time
import asyncio
from typing import Optional, Dict, Any, List
from flowforge.mcp.client import MCPClient
from flowforge.mcp.gateway import MCPGateway
from flowforge.core.tracing import get_logger

logger = get_logger("mcp.broker")

CIRCUIT_BREAKER_THRESHOLD = 5
RETRY_MAX = 3
RETRY_BASE_DELAY = 1.0


class MCPBroker:
    """MCP broker - multi-server aggregation and routing.

    Maintains an index of tool_name→server_name for efficient routing,
    with circuit breaker and retry mechanisms.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._servers: Dict[str, MCPClient] = {}
        self._gateways: Dict[str, MCPGateway] = {}
        self._tool_index: Dict[str, str] = {}  # tool_name → server_name
        self._circuit_breaker: Dict[str, int] = {}  # server_name → consecutive_failures
        self._circuit_open: Dict[str, bool] = {}  # server_name → is_open

    def register_server(self, name: str, client: MCPClient, gateway: Optional[MCPGateway] = None):
        """Register an MCP server."""
        self._servers[name] = client
        if gateway:
            self._gateways[name] = gateway
        self._circuit_breaker[name] = 0
        self._circuit_open[name] = False
        logger.info(f"MCP server registered: {name}")

    async def index_tools(self, server_name: str):
        """Index tools from a server into the tool_name→server_name map."""
        client = self._servers.get(server_name)
        if not client:
            return

        tools = await client.list_tools()
        for tool in tools:
            tool_name = tool.get("name", "")
            if tool_name:
                self._tool_index[tool_name] = server_name

        logger.info(f"Indexed {len(tools)} tools from server '{server_name}'")

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Route a tool call to the appropriate server.

        Uses tool_index for efficient routing. Falls back to
        traversal search if index miss.
        """
        # 1. Try index lookup
        server_name = self._tool_index.get(tool_name)

        if server_name:
            result = await self._execute_with_retry(server_name, tool_name, arguments)
            if result is not None:
                return result

        # 2. Fallback: traversal search
        for name, client in self._servers.items():
            if self._circuit_open.get(name, False):
                continue
            result = await self._execute_with_retry(name, tool_name, arguments)
            if result is not None and "error" not in result:
                # Update index on successful discovery
                self._tool_index[tool_name] = name
                return result

        return {"error": f"Tool '{tool_name}' not found on any server"}

    async def _execute_with_retry(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Execute with retry and circuit breaker."""
        if self._circuit_open.get(server_name, False):
            return {"error": f"Circuit breaker open for server '{server_name}'"}

        client = self._servers.get(server_name)
        gateway = self._gateways.get(server_name)

        if not client:
            return None

        for attempt in range(RETRY_MAX):
            try:
                if gateway:
                    result = await gateway.execute_tool(tool_name, arguments, client)
                else:
                    result = await client.call_tool(tool_name, arguments)

                # Success: reset circuit breaker
                self._circuit_breaker[server_name] = 0
                return result

            except Exception as e:
                self._circuit_breaker[server_name] = self._circuit_breaker.get(server_name, 0) + 1

                if self._circuit_breaker[server_name] >= CIRCUIT_BREAKER_THRESHOLD:
                    self._circuit_open[server_name] = True
                    logger.error(f"Circuit breaker opened for server '{server_name}'")
                    return {"error": f"Circuit breaker open: {e}"}

                if attempt < RETRY_MAX - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    await asyncio.sleep(delay)

        return {"error": f"All retries failed for tool '{tool_name}' on server '{server_name}'"}

    def list_all_tools(self) -> List[Dict[str, Any]]:
        """List all indexed tools."""
        return [{"name": name, "server": server} for name, server in self._tool_index.items()]

    def get_status(self) -> dict:
        """Get broker status."""
        return {
            "server_count": len(self._servers),
            "indexed_tools": len(self._tool_index),
            "circuit_breakers": {
                name: {"failures": count, "open": self._circuit_open.get(name, False)}
                for name, count in self._circuit_breaker.items()
            },
        }
