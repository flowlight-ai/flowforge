"""MCP Server Integration — Native Model Context Protocol support.

Connects to MCP (Model Context Protocol) servers and registers their
tools as FlowForge tools. This enables interoperability with the
growing MCP ecosystem.

Usage:
    from flowforge.core.mcp_integration import MCPIntegration

    mcp = MCPIntegration(tool_registry=tool_registry)

    # Connect to an MCP server via stdio
    await mcp.connect_server(
        name="filesystem",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    )

    # Or connect via SSE
    await mcp.connect_server(
        name="remote-api",
        url="http://localhost:3001/sse",
    )

    # All MCP tools are now available as FlowForge tools
    result = await tool_registry.execute(
        "mcp.filesystem.read_file",
        ToolInput(params={"path": "/tmp/test.txt"}),
    )
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger
from flowforge.tools.registry import ToolRegistry

logger = get_logger("mcp_integration")


class MCPToolWrapper(BaseTool):
    """Wraps an MCP tool as a FlowForge BaseTool.

    The tool name is prefixed with ``mcp.{server_name}.`` so that it
    integrates cleanly into the FlowForge tool namespace without
    colliding with native tools.

    Attributes:
        name: Fully-qualified tool name (e.g. ``mcp.filesystem.read_file``).
        description: Human-readable description from the MCP tool metadata.
        parameters_schema: JSON Schema converted from MCP inputSchema.
        _server_name: The MCP server this tool belongs to.
        _mcp_tool_name: The original tool name on the MCP server.
        _integration: Back-reference to the MCPIntegration for dispatch.
    """

    safety_level: str = "normal"
    is_concurrency_safe: bool = True

    def __init__(
        self,
        server_name: str,
        tool_info: Dict[str, Any],
        integration: MCPIntegration,
    ) -> None:
        self._server_name = server_name
        self._mcp_tool_name: str = tool_info.get("name", "unknown")
        self._tool_info = tool_info
        self._integration = integration

        # Build the prefixed name
        self.name = f"mcp.{server_name}.{self._mcp_tool_name}"
        self.description = tool_info.get("description", "")
        self.parameters_schema = self._convert_schema(
            tool_info.get("inputSchema", {})
        )

    @staticmethod
    def _convert_schema(mcp_schema: Dict[str, Any]) -> Dict[str, Any]:
        """Convert MCP JSON Schema to FlowForge parameters_schema."""
        if not mcp_schema:
            return {"type": "object", "properties": {}}
        return {
            "type": mcp_schema.get("type", "object"),
            "properties": mcp_schema.get("properties", {}),
            "required": mcp_schema.get("required", []),
        }

    async def execute(self, input: ToolInput) -> ToolOutput:
        """Execute the MCP tool through the integration layer."""
        try:
            result = await self._integration._call_mcp_tool(
                server_name=self._server_name,
                tool_name=self._mcp_tool_name,
                arguments=input.params,
            )
            if isinstance(result, dict) and "error" in result:
                return ToolOutput(result={}, error=result["error"])
            if isinstance(result, ToolOutput):
                return result
            return ToolOutput(
                result=result if isinstance(result, dict) else {"result": result}
            )
        except Exception as e:
            logger.error(
                f"MCP tool '{self.name}' execution failed: {e}"
            )
            return ToolOutput(result={}, error=str(e))

    def get_tool_info(self) -> Dict[str, Any]:
        """Return the original MCP tool metadata."""
        return dict(self._tool_info)


class MCPIntegration:
    """Bridges MCP Server tools into FlowForge's ToolRegistry.

    Manages connections to multiple MCP servers, auto-discovers their
    tools, and registers each as an :class:`MCPToolWrapper` in the
    target :class:`ToolRegistry`.

    The current implementation uses a simplified stub for the MCP
    protocol communication.  The real JSON-RPC 2.0 transport will be
    added in a future phase; the architecture and tool-bridging logic
    are production-ready.
    """

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self._tool_registry = tool_registry
        # server_name -> {client, config, tools}
        self._servers: Dict[str, Dict[str, Any]] = {}

    # ── Server lifecycle ────────────────────────────────────────────

    async def connect_server(
        self,
        name: str,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        url: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
    ) -> None:
        """Connect to an MCP server and register its tools.

        Args:
            name: Logical name for this server (used as namespace prefix).
            command: Executable command for stdio transport.
            args: Command arguments for stdio transport.
            url: URL for SSE/HTTP transport.
            env: Extra environment variables for the server process.

        Raises:
            ValueError: If neither *command* nor *url* is provided, or
                a server with *name* is already connected.
        """
        if not command and not url:
            raise ValueError("Either 'command' or 'url' must be provided")

        if name in self._servers:
            raise ValueError(f"MCP server '{name}' is already connected")

        # --- Simplified stub: log the connection and discover tools ---
        # In a future phase this will delegate to flowforge.mcp.client.MCPClient
        # for real JSON-RPC 2.0 communication.
        transport = "stdio" if command else "sse"
        logger.info(
            f"MCP connection to {name} established "
            f"(transport={transport}, "
            f"command={command or 'N/A'}, "
            f"url={url or 'N/A'})"
        )

        server_config: Dict[str, Any] = {
            "name": name,
            "transport": transport,
            "command": command,
            "args": args or [],
            "url": url,
            "env": env or {},
            "connected": True,
        }

        # Discover tools (stub: returns placeholder tools)
        discovered_tools = await self._discover_tools(name, server_config)

        # Wrap and register each tool
        wrappers: List[MCPToolWrapper] = []
        for tool_info in discovered_tools:
            wrapper = MCPToolWrapper(
                server_name=name,
                tool_info=tool_info,
                integration=self,
            )
            self._tool_registry.register(wrapper)
            wrappers.append(wrapper)
            logger.info(
                f"Registered MCP tool: {wrapper.name} "
                f"(from server '{name}')"
            )

        server_config["tools"] = wrappers
        self._servers[name] = server_config

        logger.info(
            f"MCP server '{name}' connected: "
            f"{len(wrappers)} tool(s) registered"
        )

    async def disconnect_server(self, name: str) -> None:
        """Disconnect from an MCP server and unregister its tools.

        Args:
            name: The logical server name used in :meth:`connect_server`.

        Raises:
            KeyError: If no server with *name* is connected.
        """
        if name not in self._servers:
            raise KeyError(f"MCP server '{name}' is not connected")

        server = self._servers[name]
        for wrapper in server.get("tools", []):
            try:
                self._tool_registry.unregister(wrapper.name)
            except KeyError:
                logger.debug(
                    f"Tool '{wrapper.name}' already unregistered"
                )

        del self._servers[name]
        logger.info(f"MCP server '{name}' disconnected")

    # ── Query helpers ───────────────────────────────────────────────

    async def list_servers(self) -> List[Dict[str, Any]]:
        """List all connected MCP servers.

        Returns:
            A list of dicts with keys: name, transport, tool_count, connected.
        """
        result: List[Dict[str, Any]] = []
        for name, server in self._servers.items():
            result.append({
                "name": name,
                "transport": server.get("transport", "unknown"),
                "tool_count": len(server.get("tools", [])),
                "connected": server.get("connected", False),
            })
        return result

    async def list_tools(
        self, server_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List available MCP tools, optionally filtered by server.

        Args:
            server_name: If provided, only list tools from this server.

        Returns:
            A list of tool info dicts with keys: name, server, description.
        """
        tools: List[Dict[str, Any]] = []
        for name, server in self._servers.items():
            if server_name and name != server_name:
                continue
            for wrapper in server.get("tools", []):
                tools.append({
                    "name": wrapper.name,
                    "server": name,
                    "description": wrapper.description,
                })
        return tools

    # ── Internal dispatch (stub) ────────────────────────────────────

    async def _call_mcp_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Any:
        """Dispatch a tool call to the MCP server.

        Currently a stub that logs the call.  Will be replaced with
        real JSON-RPC 2.0 dispatch via :class:`MCPClient`.
        """
        server = self._servers.get(server_name)
        if not server or not server.get("connected"):
            return {"error": f"MCP server '{server_name}' is not connected"}

        logger.info(
            f"MCP tool call: mcp.{server_name}.{tool_name} "
            f"(args keys: {list(arguments.keys())})"
        )

        # Stub: return a placeholder indicating the call was received.
        # Real implementation will delegate to MCPClient.call_tool().
        return {
            "status": "stub",
            "message": (
                f"MCP tool call to '{tool_name}' on server "
                f"'{server_name}' received (stub mode)"
            ),
            "arguments": arguments,
        }

    async def _discover_tools(
        self,
        server_name: str,
        server_config: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Discover tools exposed by an MCP server.

        Currently a stub that returns placeholder tool definitions.
        Will be replaced with real discovery via
        :meth:`MCPClient.list_tools`.
        """
        transport = server_config.get("transport", "unknown")
        logger.info(
            f"Discovering tools from MCP server '{server_name}' "
            f"(transport={transport})"
        )

        # Stub: return a single placeholder tool per server so the
        # architecture is exercised end-to-end.
        return [
            {
                "name": "call",
                "description": (
                    f"Execute a request on MCP server '{server_name}' "
                    f"({transport} transport). "
                    f"This is a stub tool; real tools will be discovered "
                    f"via the MCP protocol in a future phase."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "method": {
                            "type": "string",
                            "description": "The method or action to invoke",
                        },
                        "params": {
                            "type": "object",
                            "description": "Parameters for the method",
                        },
                    },
                    "required": ["method"],
                },
            }
        ]
