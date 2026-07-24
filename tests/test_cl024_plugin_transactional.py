"""P2-019 / CL-024 Plugin 启停 transactional 钩子单元测试.

验证 on_activate / on_disable / rollback_activate / rollback_disable
四个事务性钩子的契约：
1. 默认实现为 no-op（不抛异常）
2. 子类抛出异常时阻止状态切换
3. 调用方调用 rollback 回滚副作用
4. 钩子按预期顺序触发
"""

from __future__ import annotations

import pytest

from flowforge.core.plugin_protocol import (
    FlowForgePlugin,
    PluginManifest,
    PluginState,
)


# ════════════════════════════════════════════════════════════════════
# §1 测试用 Plugin 子类
# ════════════════════════════════════════════════════════════════════


class NoOpPlugin(FlowForgePlugin):
    """默认 no-op 实现 — 不覆盖事务性钩子."""

    manifest = PluginManifest(name="noop-plugin", version="0.1.0")


class TransactionalPlugin(FlowForgePlugin):
    """覆盖事务性钩子，记录调用顺序."""

    manifest = PluginManifest(name="txn-plugin", version="0.1.0")

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[str] = []
        self.activate_should_fail = False
        self.disable_should_fail = False
        # 模拟副作用资源
        self.resource_opened = False
        self.resource_closed = False

    def on_activate(self, context: dict) -> None:
        self.calls.append("on_activate")
        if self.activate_should_fail:
            raise RuntimeError("activate failed")
        self.resource_opened = True

    def on_disable(self, context: dict) -> None:
        self.calls.append("on_disable")
        if self.disable_should_fail:
            raise RuntimeError("disable failed")
        self.resource_closed = True

    def rollback_activate(self, context: dict) -> None:
        self.calls.append("rollback_activate")
        self.resource_opened = False

    def rollback_disable(self, context: dict) -> None:
        self.calls.append("rollback_disable")
        self.resource_closed = False


# ════════════════════════════════════════════════════════════════════
# §2 默认实现测试
# ════════════════════════════════════════════════════════════════════


def test_default_on_activate_is_noop() -> None:
    """默认 on_activate 不抛异常."""
    plugin = NoOpPlugin()
    plugin.on_activate({})  # should not raise


def test_default_on_disable_is_noop() -> None:
    """默认 on_disable 不抛异常."""
    plugin = NoOpPlugin()
    plugin.on_disable({})  # should not raise


def test_default_rollback_activate_is_noop() -> None:
    """默认 rollback_activate 不抛异常."""
    plugin = NoOpPlugin()
    plugin.rollback_activate({})  # should not raise


def test_default_rollback_disable_is_noop() -> None:
    """默认 rollback_disable 不抛异常."""
    plugin = NoOpPlugin()
    plugin.rollback_disable({})  # should not raise


# ════════════════════════════════════════════════════════════════════
# §3 子类覆盖测试
# ════════════════════════════════════════════════════════════════════


def test_on_activate_success_records_call() -> None:
    """on_activate 成功时记录调用."""
    plugin = TransactionalPlugin()
    plugin.on_activate({})
    assert plugin.calls == ["on_activate"]
    assert plugin.resource_opened is True


def test_on_disable_success_records_call() -> None:
    """on_disable 成功时记录调用."""
    plugin = TransactionalPlugin()
    plugin.on_disable({})
    assert plugin.calls == ["on_disable"]
    assert plugin.resource_closed is True


def test_on_activate_failure_raises() -> None:
    """on_activate 抛出异常时向上传播."""
    plugin = TransactionalPlugin()
    plugin.activate_should_fail = True
    with pytest.raises(RuntimeError, match="activate failed"):
        plugin.on_activate({})
    assert plugin.calls == ["on_activate"]
    assert plugin.resource_opened is False


def test_on_disable_failure_raises() -> None:
    """on_disable 抛出异常时向上传播."""
    plugin = TransactionalPlugin()
    plugin.disable_should_fail = True
    with pytest.raises(RuntimeError, match="disable failed"):
        plugin.on_disable({})
    assert plugin.calls == ["on_disable"]
    assert plugin.resource_closed is False


def test_rollback_activate_resets_state() -> None:
    """rollback_activate 回滚 on_activate 副作用."""
    plugin = TransactionalPlugin()
    plugin.on_activate({})  # 成功
    assert plugin.resource_opened is True
    plugin.rollback_activate({})
    assert plugin.resource_opened is False
    assert plugin.calls == ["on_activate", "rollback_activate"]


def test_rollback_disable_resets_state() -> None:
    """rollback_disable 回滚 on_disable 副作用."""
    plugin = TransactionalPlugin()
    plugin.on_disable({})  # 成功
    assert plugin.resource_closed is True
    plugin.rollback_disable({})
    assert plugin.resource_closed is False
    assert plugin.calls == ["on_disable", "rollback_disable"]


# ════════════════════════════════════════════════════════════════════
# §4 事务性闭环测试（模拟 plugin_lifecycle 调用流程）
# ════════════════════════════════════════════════════════════════════


def test_activate_rollback_on_failure_closed_loop() -> None:
    """激活失败 → 状态不切换 → 回滚副作用 → 资源未泄露."""
    plugin = TransactionalPlugin()
    plugin.activate_should_fail = True
    plugin.state = PluginState.PAUSED

    # 模拟 plugin_lifecycle 调用流程
    prev_state = plugin.state
    try:
        plugin.on_activate({"prev_state": prev_state})
        plugin.state = PluginState.READY
    except Exception:
        # 激活失败：回滚 + 状态保持
        plugin.rollback_activate({"prev_state": prev_state})

    assert plugin.state == PluginState.PAUSED  # 状态未切换
    assert plugin.resource_opened is False  # 资源未泄露


def test_disable_rollback_on_failure_closed_loop() -> None:
    """禁用失败 → 状态不切换 → 回滚副作用."""
    plugin = TransactionalPlugin()
    plugin.disable_should_fail = True
    plugin.state = PluginState.READY

    prev_state = plugin.state
    try:
        plugin.on_disable({"reason": "manual", "target_state": PluginState.PAUSED})
        plugin.state = PluginState.PAUSED
    except Exception:
        plugin.rollback_disable({"prev_state": prev_state})

    assert plugin.state == PluginState.READY  # 状态未切换
    assert plugin.resource_closed is False  # 资源未释放


def test_full_activate_disable_cycle_success() -> None:
    """完整的成功启用→禁用循环."""
    plugin = TransactionalPlugin()
    plugin.state = PluginState.STOPPED

    # 启用流程
    plugin.on_activate({"prev_state": PluginState.STOPPED})
    plugin.state = PluginState.READY
    assert plugin.resource_opened is True
    assert plugin.state == PluginState.READY

    # 禁用流程
    plugin.on_disable({"reason": "shutdown", "target_state": PluginState.STOPPED})
    plugin.state = PluginState.STOPPED
    assert plugin.resource_closed is True
    assert plugin.state == PluginState.STOPPED

    # 调用顺序
    assert plugin.calls == ["on_activate", "on_disable"]


# ════════════════════════════════════════════════════════════════════
# §5 context 传递测试
# ════════════════════════════════════════════════════════════════════


class ContextAwarePlugin(FlowForgePlugin):
    """记录 context 内容以验证参数传递."""

    manifest = PluginManifest(name="ctx-plugin", version="0.1.0")

    def __init__(self) -> None:
        super().__init__()
        self.last_activate_context: dict | None = None
        self.last_disable_context: dict | None = None

    def on_activate(self, context: dict) -> None:
        self.last_activate_context = context

    def on_disable(self, context: dict) -> None:
        self.last_disable_context = context


def test_activate_context_passed_through() -> None:
    """on_activate 接收完整 context 字典."""
    plugin = ContextAwarePlugin()
    ctx = {
        "plugin_config": {"key": "value"},
        "services": {"db": object()},
        "prev_state": PluginState.PAUSED,
    }
    plugin.on_activate(ctx)
    assert plugin.last_activate_context is ctx
    assert plugin.last_activate_context["plugin_config"] == {"key": "value"}


def test_disable_context_passed_through() -> None:
    """on_disable 接收完整 context 字典."""
    plugin = ContextAwarePlugin()
    ctx = {
        "reason": "config_reload",
        "target_state": PluginState.PAUSED,
        "services": {"db": object()},
    }
    plugin.on_disable(ctx)
    assert plugin.last_disable_context is ctx
    assert plugin.last_disable_context["reason"] == "config_reload"
