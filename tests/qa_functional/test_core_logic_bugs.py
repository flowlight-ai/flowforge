"""QA 功能验证测试 — 针对核心模块真实业务逻辑缺陷的端到端验证。

运行（仓库根）：
    python -m pytest tests/qa_functional/test_core_logic_bugs.py -v -p no:cacheprovider > /tmp/qa.txt 2>&1; echo $?

这些用例按「模块应有的正确行为」断言；失败时即暴露真实业务/功能缺陷，
并作为 BUG_PROTOCOL 工单的可复现证据。
"""
from __future__ import annotations

import asyncio
import time

import pytest

from flowforge.core.circuit_breaker import CircuitBreaker, CircuitState
from flowforge.core.feature_flags import FeatureFlag, FeatureFlagManager
from flowforge.core.fallback_chain import FallbackChain, FallbackStep


# ---------------------------------------------------------------------------
# P-08: FeatureFlag 过期判断写反 —— 已过期 flag 仍被判定为启用
# ---------------------------------------------------------------------------

def test_expired_feature_flag_must_be_disabled():
    """flag.expires_at 已过期的特性开关，is_enabled 必须返回 False。

    为隔离过期分支，先把 rollout_percentage 设为 100（否则默认的 0 会先于过期分支禁用）。
    实测：core/feature_flags.py:77-78 在 time.time() > expires_at 时返回 True，
    与 expires_at（过期即停用）的语义相反。
    """
    mgr = FeatureFlagManager()
    mgr.set_flag("beta_search", True)
    flag = mgr.get_flag("beta_search")
    assert flag is not None
    flag.rollout_percentage = 100          # 排除 rollout 闸门干扰
    flag.expires_at = time.time() - 100.0   # 100 秒前已过期

    assert mgr.is_enabled("beta_search") is False, (
        "过期开关仍被判定为启用（feature_flags.py:77-78 过期分支返回 True，逻辑写反）"
    )


# ---------------------------------------------------------------------------
# P-11: set_flag 默认 rollout_percentage=0 使 enabled=True 的开关永远不生效
# ---------------------------------------------------------------------------

def test_set_flag_enabled_actually_activates():
    """set_flag(name, True) 应使该开关对 is_enabled 返回 True。

    实测：FeatureFlag 默认 rollout_percentage=0，is_enabled 的 rollout 闸门
    `(hash_val % 100) >= 0` 恒成立 → 无论 enabled 是否为 True 都返回 False。
    导致「开启一个特性」的标准 API 调用完全失效。
    """
    mgr = FeatureFlagManager()
    mgr.set_flag("new_ui", True)
    assert mgr.is_enabled("new_ui") is True, (
        "set_flag(name, True) 后 is_enabled 仍返回 False："
        "默认 rollout_percentage=0 的闸门 (hash%100 >= 0) 永远成立，enabled 形同虚设"
        "（feature_flags.py:73-76）"
    )


# ---------------------------------------------------------------------------
# P-09: FallbackChain 条件表达式非法时 fail-open，与 docstring 承诺相反
# ---------------------------------------------------------------------------

class _RecordingRegistry:
    """记录工具是否被调用的假注册表。"""

    def __init__(self) -> None:
        self.called: list[str] = []

    async def execute(self, name, tool_input):
        self.called.append(name)

        class _Out:
            error = None
            result = f"ran:{name}"

        return _Out()


def test_invalid_condition_should_skip_step_not_execute():
    """条件表达式非法（无法解析）时，回退链应跳过该步（docstring 承诺返回 False）。

    实测：core/fallback_chain.py:_evaluate_condition 在表达式非法/异常时返回 True，
    导致本应跳过的 step 被实际执行（fail-open）。
    """
    reg = _RecordingRegistry()
    chain = FallbackChain(
        chain=[
            FallbackStep(
                name="s1",
                type="tool",
                tool="do_thing",
                input={"q": "{{input.q}}"},
                condition="input.priority >",  # 非法表达式（缺少右操作数）
            ),
        ]
    )
    result = asyncio.run(chain.execute({"q": "x", "priority": 1}, tool_registry=reg))

    # 非法条件应视为「不通过」→ 跳过，工具绝不应被调用
    assert "do_thing" not in reg.called, (
        "非法条件表达式被 fail-open 放行，步骤被执行（fallback_chain.py:_evaluate_condition 非法分支返回 True）"
    )
    assert result.successful_step is None


def test_valid_skip_condition_does_skip():
    """对照：合法且不满足的条件应跳过（证明机制对合法条件有效，隔离出非法条件的 bug）。"""
    reg = _RecordingRegistry()
    chain = FallbackChain(
        chain=[
            FallbackStep(
                name="s1",
                type="tool",
                tool="do_thing",
                input={"q": "{{input.q}}"},
                condition="input.mode == 'skip'",
            ),
        ]
    )
    result = asyncio.run(chain.execute({"q": "x", "mode": "go"}, tool_registry=reg))
    assert "do_thing" not in reg.called
    assert result.successful_step is None


# ---------------------------------------------------------------------------
# P-10: CircuitBreaker HALF_OPEN 探测预算（half_open_max_calls）形同虚设
# ---------------------------------------------------------------------------

def test_half_open_probe_budget_should_allow_n_probes():
    """进入 HALF_OPEN 后，应允许至多 half_open_max_calls 个探测请求（默认 3）。

    正确语义：HALF_OPEN 期间 is_available 持续为真直到用满预算；
    此处任一失败的探测立即复用 failure_threshold 重新 OPEN，
    使 half_open_max_calls 成为死参数（实际连续允许的探测数恒为 1）。
    """
    b = CircuitBreaker(
        name="svc",
        failure_threshold=5,
        recovery_timeout=0.01,
        half_open_max_calls=3,
    )
    for _ in range(5):
        b.record_failure()
    assert b.state == CircuitState.OPEN

    time.sleep(0.02)
    assert b.state == CircuitState.HALF_OPEN

    # 统计 HALF_OPEN 期间实际连续允许的探测数（每次成功后不开，这里用成功探测模拟放行）
    allowed = 0
    for _ in range(b.half_open_max_calls):
        if b.is_available:
            allowed += 1
            b.record_half_open_call()
        else:
            break
    assert allowed == b.half_open_max_calls, (
        f"HALF_OPEN 应允许 {b.half_open_max_calls} 个探测，实际仅 {allowed} 个；"
        "half_open_max_calls 形同虚设（circuit_breaker.py:is_available / record_failure）"
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "-p", "no:cacheprovider"]))
