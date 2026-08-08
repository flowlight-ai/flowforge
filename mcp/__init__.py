"""FlowForge v6.0 MCP Module - Model Context Protocol.

Four-layer architecture:
- L1 MCPClient: JSON-RPC 2.0 protocol layer (stdio / HTTP / WebSocket)
- L2 MCPGateway: Governance layer (whitelist, budget, rate limit)
- L3 MCPBroker: Proxy layer (multi-server aggregation, routing, circuit breaker)
- L4 MCPToolAdapter: Adapter layer (MCP Tool → FlowForge BaseTool)
"""

from flowforge.mcp.client import MCPClient
from flowforge.mcp.gateway import MCPGateway
from flowforge.mcp.broker import MCPBroker, CircuitBreaker, CircuitState
from flowforge.mcp.tool_adapter import MCPToolAdapter, register_mcp_tools

__all__ = [
    "MCPClient",
    "MCPGateway",
    "MCPBroker",
    "CircuitBreaker",
    "CircuitState",
    "MCPToolAdapter",
    "register_mcp_tools",
]
