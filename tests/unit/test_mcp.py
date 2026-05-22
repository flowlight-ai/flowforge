"""Tests for FlowForge v6.0 MCP Module."""

import pytest
from flowforge.mcp.client import MCPClient
from flowforge.mcp.gateway import MCPGateway
from flowforge.mcp.broker import MCPBroker
from flowforge.mcp.tool_adapter import MCPToolAdapter
from flowforge.core.base_tool import ToolInput


class TestMCPClient:
    """Tests for MCPClient."""

    @pytest.mark.asyncio
    async def test_list_tools_empty(self):
        client = MCPClient()
        tools = await client.list_tools()
        assert tools == []

    @pytest.mark.asyncio
    async def test_list_tools_cached(self):
        """Second call uses cache."""
        client = MCPClient()
        tools1 = await client.list_tools()
        tools2 = await client.list_tools()
        assert tools1 == tools2

    @pytest.mark.asyncio
    async def test_call_tool_not_connected(self):
        client = MCPClient()
        result = await client.call_tool("test", {})
        assert "error" in result

    @pytest.mark.asyncio
    async def test_disconnect(self):
        client = MCPClient()
        await client.disconnect()
        assert not client._connected

    def test_get_status(self):
        client = MCPClient()
        status = client.get_status()
        assert "connected" in status


class TestMCPGateway:
    """Tests for MCPGateway."""

    @pytest.mark.asyncio
    async def test_whitelist_block(self):
        """Tool not in whitelist is blocked."""
        gw = MCPGateway(config={"whitelist": ["allowed_tool"]})
        result = await gw.execute_tool("blocked_tool", {})
        assert "error" in result
        assert "whitelist" in result["error"]

    @pytest.mark.asyncio
    async def test_rate_limit(self):
        """Rate limit is enforced."""
        gw = MCPGateway(config={"rate_limit": 2})
        # First two should pass rate check (but fail on no client)
        await gw.execute_tool("t1", {})
        await gw.execute_tool("t2", {})
        # Third should be rate limited
        result = await gw.execute_tool("t3", {})
        assert "error" in result
        assert "Rate limit" in result["error"]

    @pytest.mark.asyncio
    async def test_token_budget(self):
        """Token budget is tracked."""
        gw = MCPGateway(config={"token_budget": 100, "whitelist": []})
        status = gw.get_status()
        assert status["token_budget"] == 100

    def test_get_status(self):
        gw = MCPGateway()
        status = gw.get_status()
        assert "token_budget" in status
        assert "call_count" in status


class TestMCPBroker:
    """Tests for MCPBroker."""

    def test_register_server(self):
        broker = MCPBroker()
        client = MCPClient()
        broker.register_server("test_server", client)
        status = broker.get_status()
        assert status["server_count"] == 1

    @pytest.mark.asyncio
    async def test_call_tool_no_server(self):
        broker = MCPBroker()
        result = await broker.call_tool("nonexistent", {})
        assert "error" in result

    @pytest.mark.asyncio
    async def test_circuit_breaker(self):
        """Circuit breaker opens after threshold."""
        broker = MCPBroker()
        client = MCPClient()
        broker.register_server("test", client)
        # Simulate failures by manually setting circuit breaker state
        broker._circuit_breaker["test"] = 5
        broker._circuit_open["test"] = True
        result = await broker.call_tool("any_tool", {})
        # Should be blocked by circuit breaker
        assert "error" in result

    def test_get_status(self):
        broker = MCPBroker()
        status = broker.get_status()
        assert "server_count" in status
        assert "indexed_tools" in status


class TestMCPToolAdapter:
    """Tests for MCPToolAdapter."""

    def test_adapter_creation(self):
        """Create adapter from MCP tool info."""
        tool_info = {
            "name": "test_tool",
            "description": "A test tool",
            "inputSchema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        }
        adapter = MCPToolAdapter(tool_info)
        assert adapter.name == "test_tool"
        assert adapter.description == "A test tool"

    @pytest.mark.asyncio
    async def test_execute_no_gateway(self):
        """Execute without gateway returns error."""
        tool_info = {"name": "test", "description": "test"}
        adapter = MCPToolAdapter(tool_info)
        result = await adapter.execute(ToolInput(params={"query": "test"}))
        assert result.error is not None

    def test_schema_conversion(self):
        """MCP schema is converted to FlowForge format."""
        tool_info = {
            "name": "test",
            "description": "test",
            "inputSchema": {
                "type": "object",
                "properties": {"q": {"type": "string"}},
                "required": ["q"],
            },
        }
        adapter = MCPToolAdapter(tool_info)
        schema = adapter.parameters_schema
        assert schema["type"] == "object"
        assert "q" in schema["properties"]
