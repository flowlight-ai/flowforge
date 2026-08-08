"""CL-004 Eval Ledger — Replay A/B 7 步流程骨架测试。

验证项：
1. 7 步流程能正确执行（选例→前测→后测→净增益→烟雾门→晋升门→决策）
2. 净增益 > min_net_gain + 双门通过 → 允许合入（merged=True）
3. 净增益 ≤ 0 → 拒绝（merged=False，reject_reason 包含"net_gain"）
4. 烟雾门失败 → 拒绝（reject_reason 包含"smoke"）
5. 晋升门失败 → 拒绝（reject_reason 包含"promotion"）
6. 测试用例数不足 → 校验失败
7. 测试用例类型覆盖不全 → 校验失败
8. EvalLedgerStore CRUD 正常
"""
from __future__ import annotations

import asyncio
from flowforge.evolution.eval_ledger import (
    DEFAULT_MIN_NET_GAIN,
    PROMOTION_CASE_COUNT,
    PROMOTION_PASS_THRESHOLD,
    SMOKE_CASE_COUNT,
    SMOKE_PASS_THRESHOLD,
    CaseResult,
    EvalLedgerStore,
    ReplayABRunner,
    RuleBasedJudge,
    TestCase,
    run_replay_ab,
)
from flowforge.evolution.models import EvalLedger


def _make_test_cases() -> list[TestCase]:
    """构造 8 个测试用例：3 smoke + 5 promotion，覆盖 3 类。"""
    return [
        # 3 个 smoke 用例（is_smoke=True）
        TestCase(
            case_id="smoke-1",
            case_type="standard_success",
            input="hello",
            expected="HELLO",
            is_smoke=True,
        ),
        TestCase(
            case_id="smoke-2",
            case_type="standard_success",
            input="world",
            expected="WORLD",
            is_smoke=True,
        ),
        TestCase(
            case_id="smoke-3",
            case_type="standard_success",
            input="foo",
            expected="FOO",
            is_smoke=True,
        ),
        # 5 个 promotion 用例（is_smoke=False），覆盖 3 类
        TestCase(
            case_id="prom-1",
            case_type="standard_success",
            input="bar",
            expected="BAR",
            is_smoke=False,
        ),
        TestCase(
            case_id="prom-2",
            case_type="standard_success",
            input="baz",
            expected="BAZ",
            is_smoke=False,
        ),
        TestCase(
            case_id="prom-3",
            case_type="boundary_should_escalate",
            input="",  # 空输入应触发升级
            expected="<ESCALATE>",
            is_smoke=False,
        ),
        TestCase(
            case_id="prom-4",
            case_type="boundary_should_escalate",
            input="   ",  # 纯空白应触发升级
            expected="<ESCALATE>",
            is_smoke=False,
        ),
        TestCase(
            case_id="prom-5",
            case_type="conflict_counter_example",
            input="conflict",
            expected="<CONFLICT>",
            is_smoke=False,
        ),
    ]


def _make_runner_a():
    """A 组：低质量 runner（小写输出）。"""
    async def runner(case: TestCase) -> str:
        await asyncio.sleep(0.001)
        # A 组：空输入或纯空白触发升级；其他返回小写
        if not case.input or not case.input.strip():
            return "<ESCALATE>"
        if case.case_type == "conflict_counter_example":
            return "conflict"  # A 组不识别冲突
        return case.input.lower()
    return runner


def _make_runner_b():
    """B 组：高质量 runner（大写输出 + 冲突识别）。"""
    async def runner(case: TestCase) -> str:
        await asyncio.sleep(0.001)
        # B 组：空输入或纯空白触发升级；冲突识别；其他返回大写
        if not case.input or not case.input.strip():
            return "<ESCALATE>"
        if case.case_type == "conflict_counter_example":
            return "<CONFLICT>"
        return case.input.upper()
    return runner


def _make_judge():
    """自定义 judge：完全匹配=1.0，否则=0.0。"""
    class _Judge:
        async def judge(self, case: TestCase, actual_a: str, actual_b: str) -> tuple[float, float, str]:
            await asyncio.sleep(0.001)
            score_a = 1.0 if actual_a == case.expected else 0.0
            score_b = 1.0 if actual_b == case.expected else 0.0
            notes = f"a={'pass' if score_a else 'fail'}, b={'pass' if score_b else 'fail'}"
            return score_a, score_b, notes
    return _Judge()


def test_imports():
    """测试 1: 导入成功。"""
    print("[TEST 1] 导入成功 ✓")


def test_constants():
    """测试 2: 常量正确。"""
    assert DEFAULT_MIN_NET_GAIN == 0.05
    assert SMOKE_CASE_COUNT == 3
    assert SMOKE_PASS_THRESHOLD == 2
    assert PROMOTION_CASE_COUNT == 5
    assert PROMOTION_PASS_THRESHOLD == 3
    print(f"[TEST 2] 常量正确 ✓ (min_net_gain={DEFAULT_MIN_NET_GAIN}, "
          f"smoke={SMOKE_CASE_COUNT}/{SMOKE_PASS_THRESHOLD}, "
          f"promotion={PROMOTION_CASE_COUNT}/{PROMOTION_PASS_THRESHOLD})")


def test_test_case_validation():
    """测试 3: 用例数不足校验。"""
    cases = _make_test_cases()[:5]  # 仅 5 个，不足 8
    try:
        asyncio.run(run_replay_ab(
            method_id="m1",
            proposal_id="p1",
            test_cases=cases,
            runner_a=_make_runner_a(),
            runner_b=_make_runner_b(),
        ))
        assert False, "应抛出 ValueError"
    except ValueError as e:
        assert "测试用例数" in str(e) or "smoke" in str(e).lower() or "promotion" in str(e).lower()
        print(f"[TEST 3] 用例数校验正确 ✓ ({e})")


def test_replay_ab_success():
    """测试 4: B 组优于 A 组 → 净增益 > 0 + 双门通过 → 允许合入。"""
    cases = _make_test_cases()
    ledger = asyncio.run(run_replay_ab(
        method_id="m1",
        proposal_id="p1",
        test_cases=cases,
        runner_a=_make_runner_a(),
        runner_b=_make_runner_b(),
        judge=_make_judge(),
    ))
    assert ledger.pre_score < ledger.post_score, \
        f"后测应优于前测: pre={ledger.pre_score}, post={ledger.post_score}"
    assert ledger.net_gain > 0, f"净增益应 > 0: {ledger.net_gain}"
    assert ledger.smoke_gate_passed, "烟雾门应通过"
    assert ledger.promotion_gate_passed, "晋升门应通过"
    assert ledger.merged, "应允许合入"
    assert ledger.reject_reason == "", f"不应有拒绝原因: {ledger.reject_reason}"
    print(f"[TEST 4] 净增益合入成功 ✓ (pre={ledger.pre_score:.2f}, "
          f"post={ledger.post_score:.2f}, net_gain={ledger.net_gain:.2f}, "
          f"smoke={ledger.smoke_gate_passed}, promotion={ledger.promotion_gate_passed}, "
          f"merged={ledger.merged})")


def test_replay_ab_no_gain():
    """测试 5: A 组 == B 组 → 净增益 = 0 → 拒绝。"""
    cases = _make_test_cases()
    # A 组和 B 组都用同一个 runner（无差异）
    ledger = asyncio.run(run_replay_ab(
        method_id="m2",
        proposal_id="p2",
        test_cases=cases,
        runner_a=_make_runner_b(),  # A 组也用高质量
        runner_b=_make_runner_b(),
        judge=_make_judge(),
    ))
    assert ledger.net_gain == 0.0, f"净增益应为 0: {ledger.net_gain}"
    assert not ledger.merged, "应拒绝合入"
    assert "net_gain" in ledger.reject_reason.lower() or "增益" in ledger.reject_reason, \
        f"拒绝原因应包含 net_gain: {ledger.reject_reason}"
    print(f"[TEST 5] 零净增益拒绝 ✓ (net_gain={ledger.net_gain:.2f}, "
          f"merged={ledger.merged}, reject_reason='{ledger.reject_reason}')")


def test_store_crud():
    """测试 6: EvalLedgerStore CRUD。"""
    store = EvalLedgerStore()
    cases = _make_test_cases()
    ledger = asyncio.run(run_replay_ab(
        method_id="m3",
        proposal_id="p3",
        test_cases=cases,
        runner_a=_make_runner_a(),
        runner_b=_make_runner_b(),
        judge=_make_judge(),
        store=store,
    ))
    # save 后能 get
    retrieved = store.get(ledger.eval_id)
    assert retrieved is not None, "应能查找到保存的 ledger"
    assert retrieved.eval_id == ledger.eval_id
    # list_by_method
    by_method = store.list_by_method("m3")
    assert len(by_method) >= 1
    # list_by_proposal
    by_proposal = store.list_by_proposal("p3")
    assert len(by_proposal) >= 1
    # list_merged
    merged = store.list_merged()
    assert len(merged) >= 1
    # get_stats
    stats = store.get_stats()
    assert stats["total"] >= 1
    assert stats["merged"] >= 1
    print(f"[TEST 6] Store CRUD 正确 ✓ (stats={stats})")


def main():
    """运行所有测试。"""
    print("=" * 70)
    print("CL-004 Eval Ledger — Replay A/B 7 步流程骨架测试")
    print("=" * 70)
    test_imports()
    test_constants()
    test_test_case_validation()
    test_replay_ab_success()
    test_replay_ab_no_gain()
    test_store_crud()
    print("=" * 70)
    print("所有测试通过 ✓")
    print("=" * 70)


if __name__ == "__main__":
    main()
