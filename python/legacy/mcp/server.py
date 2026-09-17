"""FlowForge MCP Server — exposes registered tools to external MCP clients.

Supports SSE transport for web-based clients and stdio for CLI clients.
Only exposes tools with safety_level <= 'normal' by default.
"""

from typing import Any, Dict, List, Optional
from flowforge.core.tracing import get_logger

logger = get_logger("mcp.server")


class MCPServer:
    """Model Context Protocol Server for FlowForge.

    Exposes registered tools as MCP resources that external clients
    (Claude Desktop, Cursor, etc.) can discover and invoke.
    """

    def __init__(
        self,
        tool_registry=None,
        agent_registry=None,
        max_safety_level: str = "normal",
        host: str = "0.0.0.0",
        port: int = 9000,
    ):
        self._tool_registry = tool_registry
        self._agent_registry = agent_registry
        self._max_safety_level = max_safety_level
        self._host = host
        self._port = port
        self._safety_order = {"readonly": 0, "normal": 1, "dangerous": 2}

    def _is_safe(self, safety_level: str) -> bool:
        """Check if a tool's safety level is within allowed range."""
        return (
            self._safety_order.get(safety_level, 3)
            <= self._safety_order.get(self._max_safety_level, 1)
        )

    def list_tools(self) -> List[Dict[str, Any]]:
        """List all available tools in MCP format."""
        if not self._tool_registry:
            return []

        tools = []
        # Get tools from registry
        for name, tool in self._tool_registry._tools.items():
            safety = getattr(tool, "safety_level", "normal")
            if not self._is_safe(safety):
                continue

            schema = getattr(tool, "parameters_schema", {})
            tools.append({
                "name": name,
                "description": getattr(tool, "description", ""),
                "inputSchema": schema,
            })

        return tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Invoke a tool by name with given arguments."""
        if not self._tool_registry:
            raise RuntimeError("Tool registry not available")

        tool = self._tool_registry._tools.get(name)
        if not tool:
            raise ValueError(f"Tool not found: {name}")

        safety = getattr(tool, "safety_level", "normal")
        if not self._is_safe(safety):
            raise PermissionError(
                f"Tool '{name}' has safety_level='{safety}', "
                f"exceeds max '{self._max_safety_level}'"
            )

        from flowforge.core.base_tool import ToolInput
        result = await tool.execute(ToolInput(params=arguments))
        return result.result if hasattr(result, "result") else result

    def get_sse_endpoint(self):
        """Return FastAPI route for SSE-based MCP communication."""
        from fastapi import APIRouter
        router = APIRouter(prefix="/mcp", tags=["mcp"])

        @router.get("/tools")
        async def list_tools():
            return self.list_tools()

        @router.post("/tools/{tool_name}")
        async def call_tool(tool_name: str, arguments: Dict[str, Any]):
            try:
                result = await self.call_tool(tool_name, arguments)
                return {"status": "success", "result": result}
            except Exception as e:
                return {"status": "error", "error": str(e)}

        @router.get("/health")
        async def health():
            return {"status": "healthy", "tools_count": len(self.list_tools())}

        return router
