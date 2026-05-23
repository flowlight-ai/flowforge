"""Tests for X-Scene header passing and openroute/auto routing logic.

Verifies that:
1. X-Scene: openroute_combine is set when tools are provided to openroute
2. X-Scene: caller_combine is set when no tools are provided to openroute
3. X-Scene: auto is set when model=auto and no tools
4. openroute/auto model correctly routes with and without tools
5. Non-openroute providers do not receive X-Scene header
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch, ANY
from flowforge.tools.llm_client import LLMClient
from flowforge.core.base_tool import ToolInput, ToolOutput


# ── Helper: create a mock httpx response ──

def _mock_response(content="Hello", tool_calls=None, status_code=200):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.raise_for_status = MagicMock()
    data = {
        "choices": [{
            "message": {
                "content": content,
                "role": "assistant",
            }
        }],
        "usage": {"total_tokens": 100},
    }
    if tool_calls:
        data["choices"][0]["message"]["tool_calls"] = tool_calls
    mock_resp.json.return_value = data
    return mock_resp


def _mock_httpx_client(response_mock):
    """Create a mock httpx.AsyncClient that returns the given response."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response_mock)
    return mock_client


# ── Test 1: X-Scene: openroute_combine when tools are provided ──

@pytest.mark.asyncio
async def test_xscene_openroute_combine_with_tools():
    """When tools are provided and provider is openroute, X-Scene should be openroute_combine."""
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {"default": {"primary": "openroute/doubao-web/seed-2.0", "fallbacks": []}},
    })

    tools_schema = [{
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
        }
    }]

    mock_resp = _mock_response(
        content="I'll search for that.",
        tool_calls=[{
            "id": "call_1", "type": "function",
            "function": {"name": "web_search", "arguments": '{"query": "test"}'}
        }]
    )
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "Search for AI news"}],
            "model": "openroute/doubao-web/seed-2.0",
            "tools": tools_schema,
            "stream": False,
        }))

    # Verify the request was made with X-Scene: openroute_combine
    mock_client.post.assert_called_once()
    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    assert headers.get("X-Scene") == "openroute_combine", \
        f"Expected X-Scene: openroute_combine, got {headers.get('X-Scene')}"

    # Verify tools were included in payload
    payload = call_kwargs.kwargs.get("json", call_kwargs[1].get("json", {}))
    assert "tools" in payload, "tools should be in payload for openroute_combine"
    assert payload["tools"] == tools_schema


# ── Test 2: X-Scene: caller_combine when no tools ──

@pytest.mark.asyncio
async def test_xscene_caller_combine_without_tools():
    """When no tools are provided and provider is openroute, X-Scene should be caller_combine."""
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {"default": {"primary": "openroute/doubao-web/seed-2.0", "fallbacks": []}},
    })

    mock_resp = _mock_response(content="Hello! How can I help you?")
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "Hello"}],
            "model": "openroute/doubao-web/seed-2.0",
            "stream": False,
        }))

    mock_client.post.assert_called_once()
    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    assert headers.get("X-Scene") == "caller_combine", \
        f"Expected X-Scene: caller_combine, got {headers.get('X-Scene')}"


# ── Test 3: X-Scene: auto for auto model without tools ──

@pytest.mark.asyncio
async def test_xscene_auto_for_auto_model():
    """When model=auto and no tools, X-Scene should be auto."""
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {"default": {"primary": "openroute/auto", "fallbacks": []}},
    })

    mock_resp = _mock_response(content="Auto-routed response")
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "Hello"}],
            "model": "openroute/auto",
            "stream": False,
        }))

    mock_client.post.assert_called_once()
    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    assert headers.get("X-Scene") == "auto", \
        f"Expected X-Scene: auto, got {headers.get('X-Scene')}"


# ── Test 4: X-Scene: openroute_combine for auto model WITH tools ──

@pytest.mark.asyncio
async def test_xscene_openroute_combine_for_auto_with_tools():
    """When model=auto AND tools are provided, X-Scene should be openroute_combine (tools take priority)."""
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {"default": {"primary": "openroute/auto", "fallbacks": []}},
    })

    tools_schema = [{
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Calculate math",
            "parameters": {"type": "object", "properties": {"expr": {"type": "string"}}},
        }
    }]

    mock_resp = _mock_response(
        content="Let me calculate that.",
        tool_calls=[{
            "id": "call_2", "type": "function",
            "function": {"name": "calculator", "arguments": '{"expr": "2+2"}'}
        }]
    )
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "What is 2+2?"}],
            "model": "openroute/auto",
            "tools": tools_schema,
            "stream": False,
        }))

    mock_client.post.assert_called_once()
    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    assert headers.get("X-Scene") == "openroute_combine", \
        f"Expected X-Scene: openroute_combine (tools override auto), got {headers.get('X-Scene')}"

    # Verify tools are in payload even for auto model
    payload = call_kwargs.kwargs.get("json", call_kwargs[1].get("json", {}))
    assert "tools" in payload, "tools should be in payload for auto+openroute_combine"


# ── Test 5: No X-Scene for non-openroute providers ──

@pytest.mark.asyncio
async def test_xscene_not_set_for_non_openroute():
    """Non-openroute providers should NOT receive X-Scene header."""
    client = LLMClient(models_config={
        "providers": {
            "openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key_default": "test-key"},
        },
        "assignments": {"default": {"primary": "openrouter/baidu/cobuddy:free", "fallbacks": []}},
    })

    mock_resp = _mock_response(content="Response from openrouter")
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "Hello"}],
            "model": "openrouter/baidu/cobuddy:free",
            "stream": False,
        }))

    mock_client.post.assert_called_once()
    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    assert "X-Scene" not in headers, \
        f"X-Scene should NOT be set for non-openroute providers, got {headers.get('X-Scene')}"


# ── Test 6: openroute/auto routing — default assignment uses auto ──

@pytest.mark.asyncio
async def test_openroute_auto_default_assignment():
    """Default assignment should use openroute/auto as primary model."""
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {
            "default": {
                "primary": "openroute/auto",
                "fallbacks": ["openroute/doubao-web/seed-2.0", "openrouter/baidu/cobuddy:free"],
            }
        },
    })

    chain = client._get_model_chain()
    assert chain[0] == "openroute/auto", \
        f"Default chain should start with openroute/auto, got {chain[0]}"


# ── Test 7: openroute/auto with tools — full integration mock ──

@pytest.mark.asyncio
async def test_openroute_auto_with_tools_integration():
    """Simulate a full request to openroute/auto with tools, verifying:
    1. X-Scene: openroute_combine is set
    2. model=auto is in payload
    3. tools are in payload
    4. Response with tool_calls is correctly parsed
    """
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {"default": {"primary": "openroute/auto", "fallbacks": []}},
    })

    tools_schema = [{
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for information",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search query"}},
                "required": ["query"],
            },
        }
    }]

    # Simulate hiclaw proxy returning a tool_call response
    mock_resp = _mock_response(
        content="",
        tool_calls=[{
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "web_search",
                "arguments": '{"query": "latest AI news 2026"}',
            }
        }]
    )
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [
                {"role": "system", "content": "You are a helpful assistant with web search."},
                {"role": "user", "content": "What's the latest AI news?"},
            ],
            "tools": tools_schema,
            "stream": False,
        }))

    # Verify result contains tool_calls
    assert result.result.get("tool_calls") is not None, "Should have tool_calls in result"
    assert len(result.result["tool_calls"]) == 1
    assert result.result["tool_calls"][0]["function"]["name"] == "web_search"

    # Verify request details
    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    payload = call_kwargs.kwargs.get("json", call_kwargs[1].get("json", {}))

    assert headers.get("X-Scene") == "openroute_combine"
    assert payload["model"] == "auto"
    assert "tools" in payload


# ── Test 8: openroute/auto without tools — caller_combine fallback ──

@pytest.mark.asyncio
async def test_openroute_auto_without_tools_caller_combine():
    """When auto model is used without tools, X-Scene should be auto (not caller_combine)."""
    client = LLMClient(models_config={
        "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
        "assignments": {"default": {"primary": "openroute/auto", "fallbacks": []}},
    })

    mock_resp = _mock_response(content="The weather is sunny today.")
    mock_client = _mock_httpx_client(mock_resp)

    with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
        result = await client.execute(ToolInput(params={
            "messages": [{"role": "user", "content": "How's the weather?"}],
            "stream": False,
        }))

    call_kwargs = mock_client.post.call_args
    headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
    payload = call_kwargs.kwargs.get("json", call_kwargs[1].get("json", {}))

    # auto model without tools → X-Scene: auto
    assert headers.get("X-Scene") == "auto"
    # No tools in payload
    assert "tools" not in payload
    # model=auto
    assert payload["model"] == "auto"


# ── Test 9: Fallback chain starts with openroute ──

def test_fallback_chain_openroute_first():
    """Cross-fallback chain should put openroute models first."""
    from flowforge.tools.llm_client import build_cross_fallback_chain

    available = {
        "openroute": ["auto", "doubao-web/seed-2.0"],
        "openrouter": ["baidu/cobuddy:free"],
        "zhipu": ["glm-4-flash"],
    }
    chain = build_cross_fallback_chain(available, {})
    assert len(chain) > 0
    # First model should be from openroute
    assert chain[0].startswith("openroute/"), \
        f"First in chain should be openroute, got {chain[0]}"


# ── Test 10: X-Scene for specific openroute models ──

@pytest.mark.asyncio
async def test_xscene_for_specific_openroute_models():
    """Each openroute model type should get the correct X-Scene."""
    test_cases = [
        # (model, has_tools, expected_scene)
        ("openroute/kimi-web/chat", False, "caller_combine"),
        ("openroute/deepseek-web/chat", False, "caller_combine"),
        ("openroute/yuanbao-web/chat", True, "openroute_combine"),
        ("openroute/qianwen-web/chat", True, "openroute_combine"),
        ("openroute/web/chat", False, "caller_combine"),
        ("openroute/web/chat", True, "openroute_combine"),
    ]

    tools_schema = [{"type": "function", "function": {"name": "test_tool", "parameters": {}}}]

    for model, has_tools, expected_scene in test_cases:
        client = LLMClient(models_config={
            "providers": {"openroute": {"base_url": "http://127.0.0.1:13000/v1"}},
            "assignments": {"default": {"primary": model, "fallbacks": []}},
        })

        mock_resp = _mock_response(content="Test response")
        mock_client = _mock_httpx_client(mock_resp)

        params = {
            "messages": [{"role": "user", "content": "test"}],
            "model": model,
            "stream": False,
        }
        if has_tools:
            params["tools"] = tools_schema

        with patch("flowforge.tools.llm_client.httpx.AsyncClient", return_value=mock_client):
            result = await client.execute(ToolInput(params=params))

        call_kwargs = mock_client.post.call_args
        headers = call_kwargs.kwargs.get("headers", call_kwargs[1].get("headers", {}))
        actual_scene = headers.get("X-Scene")
        assert actual_scene == expected_scene, \
            f"Model={model}, tools={has_tools}: expected X-Scene={expected_scene}, got {actual_scene}"
