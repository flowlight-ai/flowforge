"""FlowForge 全功能 / 业务验证报告（黑盒，真实运行）

本文件是「测试专家」的核心交付物 ①（功能验证报告）+ ②（由功能场景暴露的缺陷）。
方法：构造真实配置/真实输入，调用框架**真实运行时 API**，断言其**真实行为**。
缺陷从「跑起来的失败」中提炼，不读源码猜。

覆盖业务能力：
  F1 特性开关（FeatureFlagManager）  — 运维远程开关 + 灰度
  F2 声明式回退链（FallbackChain）  — 主工具失败按配置回退
  F3 上下文注入（ContextEngine）    — 按配置注入 / 禁用 AGENTS.md
  F4 熔断器（CircuitBreaker）       — 连续失败熔断保护下游

LLM / 浏览器依赖的 E2E（T1/T7/T8）与插件加载端到端，本环境若不具备则标 🚫 Blocked，
不得用 Mock 冒充通过（见 BUG_PROTOCOL §零）。
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from flowforge.core.feature_flags import FeatureFlagManager
from flowforge.core.fallback_chain import FallbackChain, FallbackStep
from flowforge.harness.context_engine import ContextEngine


# ---------------------------------------------------------------------------
# 协作方替身（提供真实输入，非 mock 被测对象）
# ---------------------------------------------------------------------------
class FakeToolRegistry:
    """真实可执行的工具注册表替身：按工具名返回结果或抛错。"""

    def __init__(self, fail_tools=(), results=None):
        self._fail = set(fail_tools)
        self._results = results or {}

    async def execute(self, tool_name: str, tool_input):
        if tool_name in self._fail:
            raise RuntimeError(f"tool '{tool_name}' failed")
        return SimpleNamespace(error=None, result=self._results.get(tool_name, f"ok:{tool_name}"))


class Ctx:
    """最小 TaskContext 替身，具备 metadata / state 字典。"""

    def __init__(self, persona="", workspace_root=None):
        self.persona = persona
        self.metadata: dict = {}
        self.state: dict = {}
        self.task_id = "t1"
        self.mode = "test"
        self.interaction_mode = "helm"
        self.created_at = ""
        if workspace_root is not None:
            self.workspace_root = workspace_root


# ===========================================================================
# F1 特性开关
# ===========================================================================
def test_F1_set_flag_enabled_should_activate():
    """F1.1 业务：set_flag(name, True) 后该特性必须真正启用（灰度默认全量）。"""
    mgr = FeatureFlagManager()
    mgr.set_flag("new_ui", True)
    assert mgr.is_enabled("new_ui") is True, "set_flag(True) 后 is_enabled 仍 False：开关启用失效"


def test_F1_expired_flag_must_be_disabled():
    """F1.2 业务：已过期开关必须判定为禁用（expires_at 语义）。
    需 rollout=100 让 rollout 闸门放过，方能真正命中过期分支。"""
    from flowforge.core.feature_flags import FeatureFlag
    mgr = FeatureFlagManager()
    past = time.time() - 100
    mgr._flags["beta_search"] = FeatureFlag(
        name="beta_search", enabled=True, rollout_percentage=100, expires_at=past)
    assert mgr.is_enabled("beta_search") is False, "过期开关仍被判定为启用（过期分支返回 True，逻辑写反）"


def test_F1_unconfigured_flag_disabled():
    """F1.3 控制用例：未配置开关应返回 False。"""
    mgr = FeatureFlagManager()
    assert mgr.is_enabled("ghost") is False


def test_F1_enabled_with_full_rollout_activates():
    """F1.4 控制用例：enabled + rollout=100 应启用。"""
    from flowforge.core.feature_flags import FeatureFlag
    mgr = FeatureFlagManager()
    mgr._flags["roll"] = FeatureFlag(name="roll", enabled=True, rollout_percentage=100)
    assert mgr.is_enabled("roll") is True


# ===========================================================================
# F2 声明式回退链
# ===========================================================================
def _search_chain(fail_primary):
    fail = ("helixrag_search",) if fail_primary else ()
    reg = FakeToolRegistry(fail_tools=fail, results={"web_search": "web-result"})
    chain = FallbackChain(chain=[
        FallbackStep(name="helixrag_search", type="tool", tool="helixrag_search",
                     input={"query": "{{input.query}}"}, timeout=5),
        FallbackStep(name="web_search", type="tool", tool="web_search",
                     input={"query": "{{input.query}}"}, timeout=5),
    ])
    return chain, reg


def test_F2_primary_fails_fallback_succeeds():
    """F2.1 业务：主工具失败应回退到备用工具并返回其结果。"""
    chain, reg = _search_chain(fail_primary=True)
    result = asyncio.run(chain.execute({"query": "AI"}, tool_registry=reg))
    assert result.success is True
    assert result.successful_step == "web_search"
    assert result.result == "web-result"


def test_F2_invalid_condition_should_skip_not_execute():
    """F2.2 业务：条件表达式非法时应跳过该步（fail-closed），而非 fail-open 放行。"""
    reg = FakeToolRegistry(results={"s1": "ran"})
    bad = FallbackStep(name="s1", type="tool", tool="s1",
                       input={}, timeout=5, condition="input.priority >")  # 非法：缺右操作数
    chain = FallbackChain(chain=[bad])
    result = asyncio.run(chain.execute({"query": "x"}, tool_registry=reg))
    # 期望：步骤被跳过，无成功执行（fail-closed）
    assert result.success is False, "非法条件被 fail-open 放行，步骤被执行（应为跳过）"
    assert result.successful_step is None


def test_F2_valid_unmet_condition_skips():
    """F2.3 控制用例：合法且不满足的条件应跳过。"""
    reg = FakeToolRegistry(results={"s1": "ran"})
    skip = FallbackStep(name="s1", type="tool", tool="s1",
                        input={}, timeout=5, condition="input.mode == 'skip'")
    chain = FallbackChain(chain=[skip])
    result = asyncio.run(chain.execute({"mode": "run"}, tool_registry=reg))
    assert result.success is False and result.successful_step is None


# ===========================================================================
# F3 上下文注入
# ===========================================================================
def test_F3_disable_injection_respected_when_no_repo_agents_md():
    """F3.1 业务：配置禁用（agents_md_paths=[]）且 workspace 无 AGENTS.md 时，不得注入。"""
    with tempfile.TemporaryDirectory() as d:
        eng = ContextEngine(config={"agents_md_paths": [], "workspace_root": d})
        ctx = Ctx(persona="p1", workspace_root=d)
        asyncio.run(eng.inject(ctx))
        assert "agents_md" not in ctx.metadata, "禁用配置下仍注入了 agents_md"


def test_F3_disable_intent_overridden_by_v6_workspace_fallback():
    """F3.2 业务（缺陷）：agents_md_paths=[] 意图禁用，但 workspace_root 含 AGENTS.md 时
    v6 向上搜索仍注入，静默覆盖禁用意图。"""
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "AGENTS.md"), "w", encoding="utf-8") as f:
            f.write("# repo AGENTS.md")
        eng = ContextEngine(config={"agents_md_paths": [], "workspace_root": d})
        ctx = Ctx(persona="p1", workspace_root=d)
        asyncio.run(eng.inject(ctx))
        # 期望：禁用意图生效，agents_md 不应被注入；实际：被 v6 兜底注入
        assert "agents_md" not in ctx.metadata, (
            "禁用意图被 v6 workspace 兜底静默覆盖：agents_md 仍被注入"
        )


# ===========================================================================
# F4 熔断器
# ===========================================================================
def test_F4_tripping_protects_downstream():
    """F4.1 业务：连续失败达阈值后熔断，can_execute 必须为 False。"""
    from flowforge.core.circuit_breaker import CircuitBreaker
    b = CircuitBreaker(name="agent_x", failure_threshold=3, recovery_timeout=60)
    for _ in range(3):
        b.record_failure()
    assert b.state.value == "open"
    assert b.can_execute() is False


def test_F4_half_open_probe_budget_not_honored():
    """F4.2 业务（缺陷）：进入 HALF_OPEN 后，单次失败探针立即重新 OPEN，
    half_open_max_calls 预算（默认3）形同虚设——只允许 1 次探针即重开。"""
    from flowforge.core.circuit_breaker import CircuitBreaker

    b = CircuitBreaker(name="agent_y", failure_threshold=3, recovery_timeout=0.01,
                       half_open_max_calls=3)
    for _ in range(3):
        b.record_failure()
    assert b.state.value == "open"
    time.sleep(0.02)  # 触发恢复窗口
    assert b.state.value == "half_open", "应进入 HALF_OPEN"
    # 一次失败探针后，应仍允许剩余预算探针（设计为 3 次），但实际立即重开
    b.record_half_open_call()  # 模拟一次探针登记
    b.record_failure()         # 该探针失败
    assert b.state.value == "half_open", (
        f"HALF_OPEN 单次失败即重开，half_open_max_calls={b.half_open_max_calls} 预算未生效"
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "-p", "no:cacheprovider"]))
