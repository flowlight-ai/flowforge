"""P2-024 / CL-037 MCP 1→3 server 拆分单元测试.

验证 split_server / _classify_tool / _slim_description 三个核心功能：
1. _classify_tool 按关键词正确分类（collab / memory / signals）
2. _slim_description 移除示例块并截断到 256 字符
3. split_server 将原 server 工具重新注册到 3 个新命名空间
4. get_split_status 返回正确的拆分状态
"""

from __future__ import annotations

import pytest

from flowforge.core.mcp_integration import MCPIntegration, MCPToolWrapper


# ════════════════════════════════════════════════════════════════════
# §1 _classify_tool 分类测试
# ════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "tool_name,description,expected",
    [
        # collab 类
        ("create_agent", "Create a new agent", "collab"),
        ("handoff_task", "Hand off task to another agent", "collab"),
        ("council_vote", "Cast a council vote", "collab"),
        ("forgekin_register", "Register a forgekin", "collab"),
        ("swarm_coordinate", "Coordinate swarm", "collab"),
        # memory 类
        ("save_episode", "Save an episode to EchoStore", "memory"),
        ("query_method", "Query method card", "memory"),
        ("codex_lookup", "Look up codex entry", "memory"),
        ("distill_knowledge", "Distill knowledge", "memory"),
        ("soul_imprint", "Read soul imprint", "memory"),
        # signals 类
        ("emit_metric", "Emit a metric", "signals"),
        ("publish_event", "Publish an event", "signals"),
        ("get_telemetry", "Get telemetry data", "signals"),
        ("health_check", "Run health check", "signals"),
        ("tail_log", "Tail the log stream", "signals"),
        # 默认 signals
        ("unknown_tool", "An unknown tool", "signals"),
        ("misc_helper", "Does something", "signals"),
    ],
)
def test_classify_tool(tool_name: str, description: str, expected: str) -> None:
    """_classify_tool 应按关键词正确分类."""
    result = MCPIntegration._classify_tool(tool_name, description)
    assert result == expected, (
        f"tool={tool_name} desc={description!r} expected={expected} got={result}"
    )


def test_classify_tool_priority_collab_over_memory() -> None:
    """collab 关键词优先于 memory（如 'agent_memory' 应归 collab）."""
    # 'agent' 关键词在 collab 中先匹配
    result = MCPIntegration._classify_tool("agent_memory", "Agent memory tool")
    assert result == "collab"


# ════════════════════════════════════════════════════════════════════
# §2 _slim_description 瘦身测试
# ════════════════════════════════════════════════════════════════════


def test_slim_description_empty() -> None:
    """空描述返回空字符串."""
    assert MCPIntegration._slim_description("") == ""


def test_slim_description_short_passthrough() -> None:
    """短描述原样返回."""
    desc = "A simple tool."
    assert MCPIntegration._slim_description(desc) == desc


def test_slim_description_removes_code_block() -> None:
    """移除 ```...``` 代码块."""
    desc = "Tool description.\n```python\nexample_code()\n```\nEnd."
    slimmed = MCPIntegration._slim_description(desc)
    assert "example_code" not in slimmed
    assert "```" not in slimmed
    assert "Tool description." in slimmed
    assert "End." in slimmed


def test_slim_description_removes_example_section() -> None:
    """移除 Example: 之后的内容."""
    desc = "Tool description. Example: use it like this."
    slimmed = MCPIntegration._slim_description(desc)
    assert "use it like this" not in slimmed
    assert "Tool description." in slimmed


def test_slim_description_removes_chinese_example_section() -> None:
    """移除 示例: 之后的内容."""
    desc = "工具描述。 示例: 这样使用。"
    slimmed = MCPIntegration._slim_description(desc)
    assert "这样使用" not in slimmed
    assert "工具描述。" in slimmed


def test_slim_description_truncates_long_text() -> None:
    """长描述截断到 256 字符."""
    desc = "x" * 500
    slimmed = MCPIntegration._slim_description(desc)
    assert len(slimmed) == MCPIntegration.SLIMMED_DESCRIPTION_MAX_LENGTH
    assert slimmed.endswith("...")


def test_slim_description_compression_whitespace() -> None:
    """压缩多余空白."""
    desc = "Tool   description.\n\n   Multiple   spaces."
    slimmed = MCPIntegration._slim_description(desc)
    assert "  " not in slimmed  # 无双空格
    assert "\n" not in slimmed  # 无换行


# ════════════════════════════════════════════════════════════════════
# §3 split_server 拆分测试
# ════════════════════════════════════════════════════════════════════


class _FakeToolRegistry:
    """轻量级 ToolRegistry mock，仅支持 register/unregister."""

    def __init__(self) -> None:
        self.tools: dict[str, object] = {}

    def register(self, tool: object) -> None:
        name = getattr(tool, "name", None)
        if name is None:
            raise ValueError("tool has no 'name' attribute")
        self.tools[name] = tool

    def unregister(self, name: str) -> None:
        if name not in self.tools:
            raise KeyError(name)
        del self.tools[name]


def _make_wrapper(
    integration: MCPIntegration,
    server_name: str,
    tool_name: str,
    description: str = "",
) -> MCPToolWrapper:
    """构造一个 MCPToolWrapper 用于测试."""
    return MCPToolWrapper(
        server_name=server_name,
        tool_info={"name": tool_name, "description": description, "inputSchema": {}},
        integration=integration,
    )


def _setup_integration_with_tools(
    server_name: str,
    tools: list[tuple[str, str]],
) -> tuple[MCPIntegration, _FakeToolRegistry]:
    """构造一个 MCPIntegration 实例，并手动注入测试工具到 _servers."""
    registry = _FakeToolRegistry()
    integration = MCPIntegration(registry)
    wrappers = [
        _make_wrapper(integration, server_name, name, desc)
        for name, desc in tools
    ]
    for w in wrappers:
        registry.register(w)
    integration._servers[server_name] = {
        "name": server_name,
        "transport": "stdio",
        "command": "fake",
        "args": [],
        "url": None,
        "env": {},
        "connected": True,
        "client": object(),  # 共享 client 占位
        "tools": wrappers,
    }
    return integration, registry


@pytest.mark.asyncio
async def test_split_server_three_categories() -> None:
    """split_server 将工具按 3 类拆分到 3 个新 server 命名空间."""
    integration, registry = _setup_integration_with_tools(
        "origin",
        [
            ("create_agent", "Create agent"),       # collab
            ("handoff_task", "Handoff task"),        # collab
            ("save_episode", "Save episode"),        # memory
            ("query_codex", "Query codex"),          # memory
            ("emit_metric", "Emit metric"),          # signals
        ],
    )

    counts = await integration.split_server("origin")

    assert counts == {"collab": 2, "memory": 2, "signals": 1}
    # 原 server 已被删除
    assert "origin" not in integration._servers
    # 3 个新 server 已注册
    assert "origin-collab" in integration._servers
    assert "origin-memory" in integration._servers
    assert "origin-signals" in integration._servers
    # 工具总数不变（5 个）
    assert len(registry.tools) == 5
    # 新命名空间工具名
    assert "mcp.origin-collab.create_agent" in registry.tools
    assert "mcp.origin-collab.handoff_task" in registry.tools
    assert "mcp.origin-memory.save_episode" in registry.tools
    assert "mcp.origin-memory.query_codex" in registry.tools
    assert "mcp.origin-signals.emit_metric" in registry.tools


@pytest.mark.asyncio
async def test_split_server_custom_prefix() -> None:
    """split_server 支持 target_prefix 自定义前缀."""
    integration, registry = _setup_integration_with_tools(
        "origin",
        [("create_agent", "agent"), ("save_memory", "memory")],
    )

    counts = await integration.split_server("origin", target_prefix="myapp")

    assert counts == {"collab": 1, "memory": 1, "signals": 0}
    assert "myapp-collab" in integration._servers
    assert "myapp-memory" in integration._servers
    assert "myapp-signals" in integration._servers  # 即使空也建条目


@pytest.mark.asyncio
async def test_split_server_unknown_server_raises() -> None:
    """split_server 对未连接的 server 抛出 KeyError."""
    integration, _ = _setup_integration_with_tools("origin", [])
    with pytest.raises(KeyError, match="not connected"):
        await integration.split_server("nonexistent")


@pytest.mark.asyncio
async def test_split_server_applies_slim_description() -> None:
    """split_server 对新 wrapper 应用 prompt 瘦身."""
    long_desc = "Tool description. " + "x" * 300 + " Example: use this."
    integration, _ = _setup_integration_with_tools(
        "origin",
        [("create_agent", long_desc)],
    )

    await integration.split_server("origin")

    new_wrapper: MCPToolWrapper = integration._servers["origin-collab"]["tools"][0]
    # 瘦身后描述长度 ≤ 256
    assert len(new_wrapper.description) <= MCPIntegration.SLIMMED_DESCRIPTION_MAX_LENGTH
    # 不含 "Example" 之后的内容
    assert "use this" not in new_wrapper.description


@pytest.mark.asyncio
async def test_split_server_preserves_client_reference() -> None:
    """split_server 后 3 个新 server 共享原 client 引用."""
    integration, _ = _setup_integration_with_tools(
        "origin",
        [("create_agent", "agent"), ("save_memory", "memory"), ("emit_metric", "metric")],
    )
    original_client = integration._servers["origin"]["client"]

    await integration.split_server("origin")

    for category in ("collab", "memory", "signals"):
        new_server = integration._servers[f"origin-{category}"]
        assert new_server["client"] is original_client
        assert new_server["split_from"] == "origin"
        assert new_server["category"] == category


# ════════════════════════════════════════════════════════════════════
# §4 get_split_status 查询测试
# ════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_get_split_status_before_split() -> None:
    """拆分前 get_split_status 返回原 server 列表."""
    integration, _ = _setup_integration_with_tools(
        "origin",
        [("create_agent", "agent")],
    )
    status = integration.get_split_status()
    assert status == {"original": ["origin"], "split": []}


@pytest.mark.asyncio
async def test_get_split_status_after_split() -> None:
    """拆分后 get_split_status 返回 3 个拆分 server."""
    integration, _ = _setup_integration_with_tools(
        "origin",
        [("create_agent", "agent"), ("save_memory", "memory"), ("emit_metric", "metric")],
    )
    await integration.split_server("origin")
    status = integration.get_split_status()
    assert status["original"] == []
    assert set(status["split"]) == {"origin-collab", "origin-memory", "origin-signals"}


@pytest.mark.asyncio
async def test_get_split_status_mixed() -> None:
    """混合场景：原 server + 拆分 server 共存."""
    integration, _ = _setup_integration_with_tools(
        "origin",
        [("create_agent", "agent"), ("save_memory", "memory"), ("emit_metric", "metric")],
    )
    # 添加另一个未拆分的 server
    integration._servers["raw"] = {
        "name": "raw",
        "transport": "stdio",
        "tools": [],
        "split_from": None,
    }
    await integration.split_server("origin")

    status = integration.get_split_status()
    assert "raw" in status["original"]
    assert set(status["split"]) == {"origin-collab", "origin-memory", "origin-signals"}
