"""MCP Tool Adapter - L4 Adapter Layer.

Implements FR-CAP-03 L4:
- MCP Tool → FlowForge BaseTool automatic conversion
- Auto Schema generation
- Stream execution support
- Registration with FlowForge ToolRegistry
- Batch registration of tools from an MCP server
"""

from typing import Optional, Dict, Any, List
from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.mcp.gateway import MCPGateway
from flowforge.core.tracing import get_logger

logger = get_logger("mcp.tool_adapter")


class MCPToolAdapter(BaseTool):
    """Adapter that wraps an MCP tool as a FlowForge BaseTool.

    Automatically converts MCP tool schema to FlowForge format
    and delegates execution to the MCP gateway.
    """

    # Default safety level for MCP tools
    safety_level = "normal"
    is_concurrency_safe = True

    def __init__(self, tool_info: Dict[str, Any], gateway: Optional[MCPGateway] = None):
        self._tool_info = tool_info
        self._gateway = gateway

        # Extract tool metadata
        name = tool_info.get("name", "mcp_unknown")
        description = tool_info.get("description", "")

        # Convert MCP schema to FlowForge schema
        parameters_schema = self._convert_schema(tool_info.get("inputSchema", {}))

        # Set instance attributes (BaseTool uses class-level defaults)
        self.name = name
        self.description = description
        self.parameters_schema = parameters_schema

        # Override safety level if specified
        if "safety_level" in tool_info:
            self.safety_level = tool_info["safety_level"]

    def _convert_schema(self, mcp_schema: Dict[str, Any]) -> Dict[str, Any]:
        """Convert MCP JSON Schema to FlowForge parameters_schema."""
        if not mcp_schema:
            return {"type": "object", "properties": {}}

        # MCP uses standard JSON Schema, which is compatible with FlowForge
        return {
            "type": mcp_schema.get("type", "object"),
            "properties": mcp_schema.get("properties", {}),
            "required": mcp_schema.get("required", []),
        }

    async def execute(self, input: ToolInput) -> ToolOutput:
        """Execute the MCP tool through the gateway."""
        if not self._gateway:
            return ToolOutput(result={}, error="No MCP gateway configured")

        result = await self._gateway.execute_tool(
            tool_name=self.name,
            arguments=input.params,
        )

        if "error" in result and result.get("error") is not None:
            return ToolOutput(result={}, error=result["error"])

        return ToolOutput(result=result.get("result", result))

    async def execute_stream(self, input: ToolInput):
        """Execute the MCP tool with streaming support."""
        if not self._gateway:
            yield {"error": "No MCP gateway configured"}
            return

        async for chunk in self._gateway.execute_tool_stream(
            tool_name=self.name,
            arguments=input.params,
        ):
            yield chunk

    def get_tool_info(self) -> Dict[str, Any]:
        """Get the original MCP tool info."""
        return dict(self._tool_info)

    def register_with(self, tool_registry) -> None:
        """Register this tool with a FlowForge ToolRegistry.

        Args:
            tool_registry: A flowforge.tools.registry.ToolRegistry instance.
        """
        tool_registry.register(self)
        logger.info(f"MCP tool '{self.name}' registered with ToolRegistry")


async def register_mcp_tools(
    tool_registry,
    broker,
    server_name: Optional[str] = None,
    gateway: Optional[MCPGateway] = None,
    prefix: str = "",
) -> List[MCPToolAdapter]:
    """Discover and register all tools from MCP servers into FlowForge ToolRegistry.

    This is the primary bridge between MCP tool ecosystem and FlowForge.
    It discovers tools from MCP servers (via broker), creates MCPToolAdapter
    instances, and registers them with the ToolRegistry.

    Args:
        tool_registry: A flowforge.tools.registry.ToolRegistry instance.
        broker: A flowforge.mcp.broker.MCPBroker instance.
        server_name: Optional specific server to register tools from.
                     If None, registers tools from all servers.
        gateway: Optional MCPGateway for governance. If None, tools
                 execute directly through the client.
        prefix: Optional prefix for tool names (e.g., "mcp_" to avoid collisions).

    Returns:
        List of MCPToolAdapter instances that were registered.
    """
    adapters: List[MCPToolAdapter] = []

    if server_name:
        servers_to_index = {server_name: broker._servers.get(server_name)}
    else:
        servers_to_index = broker._servers

    for srv_name, client in servers_to_index.items():
        if not client:
            logger.warning(f"Server '{srv_name}' not found in broker")
            continue

        try:
            tools = await client.list_tools(force_refresh=True)
        except Exception as e:
            logger.error(f"Failed to list tools from '{srv_name}': {e}")
            continue

        for tool_info in tools:
            tool_name = tool_info.get("name", "")
            if not tool_name:
                continue

            # Apply prefix if specified
            if prefix and not tool_name.startswith(prefix):
                tool_info = dict(tool_info)
                tool_info["name"] = f"{prefix}{tool_name}"

            adapter = MCPToolAdapter(tool_info, gateway=gateway)
            adapter.register_with(tool_registry)
            adapters.append(adapter)

            # Update broker's tool index
            broker._tool_index[adapter.name] = srv_name

    logger.info(f"Registered {len(adapters)} MCP tools from {len(servers_to_index)} server(s)")
    return adapters
