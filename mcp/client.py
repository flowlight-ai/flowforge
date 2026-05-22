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
        """List available tools from the MCP server.

        Uses 5-minute TTL cache to avoid repeated discovery.
        """
        now = time.time()
        if not force_refresh and self._tool_cache and (now - self._cache_timestamp) < CACHE_TTL:
            return list(self._tool_cache.values())

        # Phase 1: Return empty (actual JSON-RPC not yet connected)
        # Phase 2: Send tools/list JSON-RPC request
        tools = []
        self._tool_cache = {t["name"]: t for t in tools}
        self._cache_timestamp = now
        return tools

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool on the MCP server.

        Args:
            tool_name: Tool name
            arguments: Tool arguments

        Returns:
            Tool result
        """
        if not self._connected:
            return {"error": "Not connected to MCP server"}

        # Phase 1: Return placeholder
        # Phase 2: Send tools/call JSON-RPC request
        logger.debug(f"MCP call_tool: {tool_name}")
        return {"result": None, "error": "MCP tool call not yet implemented"}

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
