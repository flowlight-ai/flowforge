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

    # Or connect via HTTP/SSE
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
        if not self._integration.is_available():
            return ToolOutput(
                result={},
                error="MCP integration is not available — no MCPClient could be loaded",
            )
        try:
            result = await self._integration._call_mcp_tool(
                server_name=self._server_name,
                tool_name=self._mcp_tool_name,
                arguments=input.params,
            )
            if isinstance(result, dict) and "error" in result and result.get("result") is None:
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

    Uses :class:`flowforge.mcp.client.MCPClient` for real JSON-RPC 2.0
    communication. If MCPClient is not available, the integration reports
    itself as unavailable via :meth:`is_available`.
    """

    def __init__(self, tool_registry: ToolRegistry) -> None:
        self._tool_registry = tool_registry
        # server_name -> {client, config, tools}
        self._servers: Dict[str, Dict[str, Any]] = {}
        self._mcp_client_available: Optional[bool] = None

    def is_available(self) -> bool:
        """Check whether the MCP client library is available.

        Returns False if the ``flowforge.mcp.client.MCPClient`` cannot
        be imported, meaning all MCP operations will fail gracefully.
        """
        if self._mcp_client_available is None:
            try:
                from flowforge.mcp.client import MCPClient  # noqa: F401
                self._mcp_client_available = True
            except ImportError:
                self._mcp_client_available = False
                logger.warning(
                    "MCPClient is not available — MCP integration is disabled. "
                    "Ensure flowforge.mcp.client is importable."
                )
        return self._mcp_client_available

    def _create_client(self, **kwargs) -> Any:
        """Instantiate an MCPClient, raising if unavailable."""
        from flowforge.mcp.client import MCPClient
        return MCPClient(config=kwargs)

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
            url: URL for HTTP/SSE transport.
            env: Extra environment variables for the server process.

        Raises:
            ValueError: If neither *command* nor *url* is provided, or
                a server with *name* is already connected.
            RuntimeError: If MCPClient is not available.
        """
        if not command and not url:
            raise ValueError("Either 'command' or 'url' must be provided")

        if name in self._servers:
            raise ValueError(f"MCP server '{name}' is already connected")

        if not self.is_available():
            raise RuntimeError(
                "Cannot connect to MCP server: MCPClient is not available. "
                "Ensure flowforge.mcp.client is importable."
            )

        # Create and connect the real MCPClient
        client = self._create_client(server_name=name)
        connected = await client.connect(
            command=command,
            args=args,
            url=url,
            server_name=name,
        )
        if not connected:
            raise RuntimeError(
                f"Failed to connect to MCP server '{name}' "
                f"(command={command}, url={url})"
            )

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
            "client": client,
        }

        # Discover tools via the real MCPClient
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

        # Disconnect the real MCPClient
        client = server.get("client")
        if client:
            try:
                await client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting MCP client for '{name}': {e}")

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

    # ── Internal dispatch ────────────────────────────────────────────

    async def _call_mcp_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Any:
        """Dispatch a tool call to the MCP server via MCPClient."""
        server = self._servers.get(server_name)
        if not server or not server.get("connected"):
            return {"result": None, "error": f"MCP server '{server_name}' is not connected"}

        client = server.get("client")
        if not client:
            return {"result": None, "error": f"No MCPClient for server '{server_name}'"}

        logger.info(
            f"MCP tool call: mcp.{server_name}.{tool_name} "
            f"(args keys: {list(arguments.keys())})"
        )

        try:
            response = await client.call_tool(
                tool_name=tool_name,
                arguments=arguments,
                server_name=server_name,
            )
            error = response.get("error")
            result = response.get("result")
            if error:
                return {"result": None, "error": error}
            return result if isinstance(result, dict) else {"result": result}
        except Exception as e:
            logger.error(f"MCP tool call failed: {e}")
            return {"result": None, "error": str(e)}

    async def _discover_tools(
        self,
        server_name: str,
        server_config: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Discover tools exposed by an MCP server via MCPClient."""
        client = server_config.get("client")
        if not client:
            logger.warning(f"No MCPClient for server '{server_name}', cannot discover tools")
            return []

        transport = server_config.get("transport", "unknown")
        logger.info(
            f"Discovering tools from MCP server '{server_name}' "
            f"(transport={transport})"
        )

        try:
            tools = await client.list_tools(server_name=server_name)
            if tools:
                logger.info(f"Discovered {len(tools)} tool(s) from MCP server '{server_name}'")
                return tools
            logger.info(f"No tools discovered from MCP server '{server_name}'")
            return []
        except Exception as e:
            logger.error(f"Tool discovery failed for MCP server '{server_name}': {e}")
            return []
