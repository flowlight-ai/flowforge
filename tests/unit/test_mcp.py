"""Tests for FlowForge v6.0 MCP Module."""

import json
import time
import asyncio
import subprocess
from unittest.mock import patch, MagicMock, AsyncMock

import pytest
import httpx

from flowforge.mcp.client import MCPClient, CACHE_TTL
from flowforge.mcp.gateway import MCPGateway
from flowforge.mcp.broker import MCPBroker
from flowforge.mcp.tool_adapter import MCPToolAdapter
from flowforge.core.base_tool import ToolInput


class TestMCPClient:

    @pytest.mark.asyncio
    async def test_list_tools_empty(self):
        client = MCPClient()
        tools = await client.list_tools()
        assert tools == []

    @pytest.mark.asyncio
    async def test_list_tools_cached(self):
        client = MCPClient()
        tools = await client.list_tools()
        assert tools == []
        client._tool_cache = {
            "tool_a": {"name": "tool_a", "description": "Tool A"},
            "tool_b": {"name": "tool_b", "description": "Tool B"},
        }
        client._cache_timestamp = time.time()
        cached = await client.list_tools()
        assert len(cached) == 2
        names = {t["name"] for t in cached}
        assert names == {"tool_a", "tool_b"}
        refreshed = await client.list_tools(force_refresh=True)
        assert refreshed == []

    @pytest.mark.asyncio
    async def test_call_tool_not_connected(self):
        client = MCPClient()
        result = await client.call_tool("test", {})
        assert "error" in result
        assert result["error"] == "Not connected to MCP server"

    @pytest.mark.asyncio
    async def test_disconnect(self):
        client = MCPClient()
        await client.disconnect()
        assert not client._connected

    def test_get_status(self):
        client = MCPClient()
        status = client.get_status()
        assert status["connected"] is False
        assert status["cached_tools"] == 0
        assert "cache_age_seconds" in status

    @pytest.mark.asyncio
    async def test_connect_stdio(self):
        with patch("flowforge.mcp.client.subprocess.Popen") as mock_popen:
            mock_process = MagicMock()
            mock_popen.return_value = mock_process
            client = MCPClient()
            result = await client.connect(command="mcp-server", args=["--port", "3000"])
            assert result is True
            assert client._connected is True
            assert client._process is mock_process
            mock_popen.assert_called_once_with(
                ["mcp-server", "--port", "3000"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

    @pytest.mark.asyncio
    async def test_connect_stdio_failure(self):
        with patch("flowforge.mcp.client.subprocess.Popen") as mock_popen:
            mock_popen.side_effect = OSError("spawn failed")
            client = MCPClient()
            result = await client.connect(command="bad-server")
            assert result is False
            assert client._connected is False

    @pytest.mark.asyncio
    async def test_connect_http(self):
        client = MCPClient()
        result = await client.connect(url="http://localhost:3000")
        assert result is True
        assert client._connected is True

    @pytest.mark.asyncio
    async def test_connect_missing_config(self):
        client = MCPClient()
        result = await client.connect()
        assert result is False
        assert client._connected is False

    @pytest.mark.asyncio
    async def test_disconnect_with_process(self):
        client = MCPClient()
        mock_process = MagicMock()
        client._process = mock_process
        client._connected = True
        client._tool_cache = {"t": {"name": "t"}}
        await client.disconnect()
        mock_process.terminate.assert_called_once()
        assert client._process is None
        assert client._connected is False
        assert client._tool_cache == {}

    def test_is_connected_attribute(self):
        client = MCPClient()
        assert client._connected is False
        client._connected = True
        assert client._connected is True

    @pytest.mark.asyncio
    async def test_send_jsonrpc_stdio(self):
        client = MCPClient()
        mock_process = MagicMock()
        mock_process.stdin = MagicMock()
        mock_process.stdout = MagicMock()
        response = {"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}
        mock_process.stdout.readline.return_value = (json.dumps(response) + "\n").encode("utf-8")
        client._process = mock_process
        client._connected = True
        result = await client._send_jsonrpc("tools/list", {})
        assert result == response
        mock_process.stdin.write.assert_called_once()
        mock_process.stdin.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_jsonrpc_http(self):
        client = MCPClient(config={"url": "http://localhost:3000", "timeout": 5})
        client._connected = True
        mock_response = MagicMock()
        mock_response.json.return_value = {"jsonrpc": "2.0", "id": 1, "result": {}}
        mock_response.raise_for_status = MagicMock()
        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=False)
        with patch("flowforge.mcp.client.httpx.AsyncClient", return_value=mock_http_client):
            result = await client._send_jsonrpc("tools/list", {})
            assert result == {"jsonrpc": "2.0", "id": 1, "result": {}}
            mock_http_client.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_jsonrpc_timeout(self):
        client = MCPClient(config={"timeout": 0.05})
        mock_process = MagicMock()
        mock_process.stdin = MagicMock()
        mock_process.stdout = MagicMock()
        def slow_readline():
            time.sleep(10)
            return b'{}\n'
        mock_process.stdout.readline = slow_readline
        client._process = mock_process
        client._connected = True
        with pytest.raises(asyncio.TimeoutError):
            await client._send_jsonrpc("tools/list", {})

    @pytest.mark.asyncio
    async def test_send_jsonrpc_error_response(self):
        client = MCPClient()
        mock_process = MagicMock()
        mock_process.stdin = MagicMock()
        mock_process.stdout = MagicMock()
        error_resp = {"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "message": "Invalid Request"}}
        mock_process.stdout.readline.return_value = (json.dumps(error_resp) + "\n").encode("utf-8")
        client._process = mock_process
        client._connected = True
        result = await client._send_jsonrpc("tools/list", {})
        assert "error" in result

    @pytest.mark.asyncio
    async def test_request_id_increment(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        mock_response = MagicMock()
        mock_response.json.return_value = {"jsonrpc": "2.0", "id": 1, "result": {}}
        mock_response.raise_for_status = MagicMock()
        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
        mock_http_client.__aexit__ = AsyncMock(return_value=False)
        with patch("flowforge.mcp.client.httpx.AsyncClient", return_value=mock_http_client):
            await client._send_jsonrpc("method1", {})
            assert client._request_id == 1
            await client._send_jsonrpc("method2", {})
            assert client._request_id == 2
            await client._send_jsonrpc("method3", {})
            assert client._request_id == 3

    @pytest.mark.asyncio
    async def test_send_jsonrpc_no_transport(self):
        client = MCPClient()
        client._connected = True
        with pytest.raises(RuntimeError, match="No transport available"):
            await client._send_jsonrpc("method", {})

    @pytest.mark.asyncio
    async def test_send_jsonrpc_stdio_no_streams(self):
        client = MCPClient()
        mock_process = MagicMock()
        mock_process.stdin = None
        mock_process.stdout = None
        client._process = mock_process
        client._connected = True
        with pytest.raises(RuntimeError, match="No transport available"):
            await client._send_jsonrpc("method", {})

    @pytest.mark.asyncio
    async def test_send_jsonrpc_stdio_empty_response(self):
        client = MCPClient()
        mock_process = MagicMock()
        mock_process.stdin = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stdout.readline.return_value = b""
        client._process = mock_process
        client._connected = True
        with pytest.raises(RuntimeError, match="Empty response"):
            await client._send_jsonrpc("tools/list", {})

    @pytest.mark.asyncio
    async def test_send_jsonrpc_stdio_process_not_available(self):
        client = MCPClient()
        mock_process = MagicMock()
        mock_process.stdin = None
        client._process = mock_process
        client._connected = True
        with pytest.raises(RuntimeError, match="stdio process not available"):
            await client._send_jsonrpc_stdio({"jsonrpc": "2.0", "id": 1, "method": "test", "params": {}})

    @pytest.mark.asyncio
    async def test_list_tools_with_connection(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        tools_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": [
                    {"name": "search", "description": "Search tool"},
                    {"name": "analyze", "description": "Analyze tool"},
                ]
            }
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=tools_response) as mock_send:
            tools = await client.list_tools()
            assert len(tools) == 2
            assert tools[0]["name"] == "search"
            assert tools[1]["name"] == "analyze"
            mock_send.assert_called_once_with("tools/list", {})

    @pytest.mark.asyncio
    async def test_list_tools_caching(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        tools_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"tools": [{"name": "search", "description": "Search"}]}
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=tools_response) as mock_send:
            tools1 = await client.list_tools()
            assert len(tools1) == 1
            assert mock_send.call_count == 1
            tools2 = await client.list_tools()
            assert len(tools2) == 1
            assert mock_send.call_count == 1

    @pytest.mark.asyncio
    async def test_list_tools_force_refresh(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        client._tool_cache = {"old_tool": {"name": "old_tool"}}
        client._cache_timestamp = time.time()
        tools_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"tools": [{"name": "new_tool", "description": "New"}]}
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=tools_response) as mock_send:
            tools = await client.list_tools(force_refresh=True)
            assert len(tools) == 1
            assert tools[0]["name"] == "new_tool"
            assert mock_send.call_count == 1

    @pytest.mark.asyncio
    async def test_list_tools_cache_expired(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        client._tool_cache = {"old_tool": {"name": "old_tool"}}
        client._cache_timestamp = time.time() - CACHE_TTL - 1
        tools_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"tools": [{"name": "new_tool", "description": "New"}]}
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=tools_response) as mock_send:
            tools = await client.list_tools()
            assert len(tools) == 1
            assert tools[0]["name"] == "new_tool"
            assert mock_send.call_count == 1

    @pytest.mark.asyncio
    async def test_list_tools_exception(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, side_effect=RuntimeError("Connection lost")):
            tools = await client.list_tools()
            assert tools == []

    @pytest.mark.asyncio
    async def test_call_tool_with_connection(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        call_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"content": "result data"}
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=call_response) as mock_send:
            result = await client.call_tool("search", {"query": "test"})
            assert result["result"] == {"content": "result data"}
            assert result["error"] is None
            mock_send.assert_called_once_with("tools/call", {"name": "search", "arguments": {"query": "test"}})

    @pytest.mark.asyncio
    async def test_call_tool_with_arguments(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        call_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"output": "done"}
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=call_response) as mock_send:
            args = {"query": "climate change", "limit": 10, "offset": 0}
            result = await client.call_tool("search", args)
            mock_send.assert_called_once_with("tools/call", {"name": "search", "arguments": args})
            assert result["error"] is None

    @pytest.mark.asyncio
    async def test_call_tool_error_response(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        error_response = {
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32600, "message": "Invalid params"}
        }
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, return_value=error_response):
            result = await client.call_tool("bad_tool", {})
            assert result["result"] is None
            assert result["error"] == "Invalid params"

    @pytest.mark.asyncio
    async def test_call_tool_exception(self):
        client = MCPClient(config={"url": "http://localhost:3000"})
        client._connected = True
        with patch.object(client, "_send_jsonrpc", new_callable=AsyncMock, side_effect=RuntimeError("Connection lost")):
            result = await client.call_tool("search", {})
            assert result["result"] is None
            assert "Connection lost" in result["error"]

    def test_get_status_connected(self):
        client = MCPClient()
        client._connected = True
        client._tool_cache = {"t1": {"name": "t1"}, "t2": {"name": "t2"}}
        client._cache_timestamp = time.time()
        status = client.get_status()
        assert status["connected"] is True
        assert status["cached_tools"] == 2
        assert status["cache_age_seconds"] >= 0

    def test_config_timeout(self):
        client = MCPClient(config={"timeout": 10})
        assert client._timeout == 10
        client_default = MCPClient()
        assert client_default._timeout == 30
        client_no_timeout = MCPClient(config={"url": "http://localhost:3000"})
        assert client_no_timeout._timeout == 30


class TestMCPGateway:

    @pytest.mark.asyncio
    async def test_whitelist_block(self):
        gw = MCPGateway(config={"whitelist": ["allowed_tool"]})
        result = await gw.execute_tool("blocked_tool", {})
        assert "error" in result
        assert "whitelist" in result["error"]

    @pytest.mark.asyncio
    async def test_rate_limit(self):
        gw = MCPGateway(config={"rate_limit": 2})
        await gw.execute_tool("t1", {})
        await gw.execute_tool("t2", {})
        result = await gw.execute_tool("t3", {})
        assert "error" in result
        assert "Rate limit" in result["error"]

    @pytest.mark.asyncio
    async def test_token_budget(self):
        gw = MCPGateway(config={"token_budget": 100, "whitelist": []})
        status = gw.get_status()
        assert status["token_budget"] == 100

    def test_get_status(self):
        gw = MCPGateway()
        status = gw.get_status()
        assert "token_budget" in status
        assert "call_count" in status


class TestMCPBroker:

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
        broker = MCPBroker()
        client = MCPClient()
        broker.register_server("test", client)
        # Simulate circuit breaker in OPEN state by recording failures
        cb = broker._circuit_breakers["test"]
        for _ in range(cb.failure_threshold):
            cb.record_failure()
        assert not cb.allow_request()
        result = await broker.call_tool("any_tool", {})
        assert "error" in result

    def test_get_status(self):
        broker = MCPBroker()
        status = broker.get_status()
        assert "server_count" in status
        assert "indexed_tools" in status


class TestMCPToolAdapter:

    def test_adapter_creation(self):
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
        tool_info = {"name": "test", "description": "test"}
        adapter = MCPToolAdapter(tool_info)
        result = await adapter.execute(ToolInput(params={"query": "test"}))
        assert result.error is not None

    def test_schema_conversion(self):
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
