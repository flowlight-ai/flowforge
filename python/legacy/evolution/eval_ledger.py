"""CL-004 Eval Ledger — 进化级 Eval（Replay A/B 净增益验证）。

[doc:design.md#v7.1-§D7.6] Eval Ledger 字段契约
[doc:review/review.md#13.1] CL-004 Eval Ledger 进化账本未设计
[doc:decisions/009-eval-self-metabolism.md] ADR-009 Eval 自代谢

与任务级 Eval（flowforge/core/eval/）区分：
- 任务级 Eval：评估单次任务执行质量（quality_score ≥ 0.85 阈值）
- 进化级 Eval：评估进化提案的净增益（net_gain > 0 + 双门通过）

Replay A/B 7 步流程（design.md v7.1-§D7.6.3）：
  Step 1: 选取测试用例集（3 smoke + 5 promotion）
  Step 2: 前测（A 组）— 使用当前方法库（锻典）条目跑测试用例
  Step 3: 后测（B 组）— 使用提案修改后的方法库条目跑测试用例
  Step 4: 计算净增益 = post_score - pre_score
  Step 5: 烟雾门校验（3 cases, ≥2/3 pass）
  Step 6: 晋升门校验（5 cases, ≥3/5 pass, 覆盖 3 类）
  Step 7: 决策（净增益 > min_net_gain AND 双门通过 → 允许合入）

License: MIT
"""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any, Awaitable, Callable, Literal, Protocol

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import EvalLedger

logger = get_logger("flowforge.evolution.eval_ledger")


# ========== 常量 ==========

DEFAULT_MIN_NET_GAIN = 0.05  # 默认净增益阈值（design.md v7.1-§D7.3 安全门设计）
SMOKE_CASE_COUNT = 3
SMOKE_PASS_THRESHOLD = 2  # ≥2/3 pass
PROMOTION_CASE_COUNT = 5
PROMOTION_PASS_THRESHOLD = 3  # ≥3/5 pass

CaseType = Literal[
    "standard_success",
    "boundary_should_escalate",
    "conflict_counter_example",
]

REQUIRED_CASE_TYPES = {
    "standard_success",
    "boundary_should_escalate",
    "conflict_counter_example",
}


# ========== 数据模型 ==========


class TestCase(BaseModel):
    """测试用例（A/B 配对）。

    用于 Replay A/B 流程的输入。每个 case 在 A 组（前测）和 B 组（后测）中
    跑相同输入，比较输出分数。
    """

    case_id: str
    case_type: CaseType
    input: str
    expected: str
    is_smoke: bool = False  # True = smoke case, False = promotion case


class CaseResult(BaseModel):
    """单个 case 的 A/B 测试结果。"""

    case_id: str
    actual_a: str = ""  # A 组实际输出（前测）
    actual_b: str = ""  # B 组实际输出（后测）
    score_a: float = 0.0  # 0.0~1.0
    score_b: float = 0.0  # 0.0~1.0
    passed: bool = False  # B 组是否优于 A 组
    judge_notes: str = ""


# ========== Judge 协议 ==========


class CaseJudgeProtocol(Protocol):
    """单 case 评审协议（可注入 LLM 评审器或规则评审器）。

    实际生产应注入 LLM 评审器（复用 flowforge/core/eval/ 任务级 Eval 能力）。
    """

    async def judge(
        self,
        case: TestCase,
        actual_a: str,
        actual_b: str,
    ) -> tuple[float, float, str]:
        """评审 A/B 输出，返回 (score_a, score_b, notes)。

        参数：
        - case: 测试用例（含 input / expected）
        - actual_a: A 组实际输出（前测）
        - actual_b: B 组实际输出（后测）

        返回：
        - score_a: A 组分数 0.0~1.0
        - score_b: B 组分数 0.0~1.0
        - notes: 评审说明
        """
        ...


class RuleBasedJudge:
    """基于规则的默认评审器（无 LLM 依赖，用于骨架实现）。

    评审规则：
    - 与 expected 完全匹配 = 1.0
    - 关键词重叠 ≥ 80% = 0.8
    - 关键词重叠 ≥ 50% = 0.5
    - 完全不匹配 = 0.0

    注：实际生产应注入 LLM 评审器（实现 CaseJudgeProtocol），
    复用 flowforge/core/eval/three_signals.py 三方信号交叉。
    """

    async def judge(
        self,
        case: TestCase,
        actual_a: str,
        actual_b: str,
    ) -> tuple[float, float, str]:
        score_a = self._score(case.expected, actual_a)
        score_b = self._score(case.expected, actual_b)
        notes = f"rule-based: score_a={score_a:.2f}, score_b={score_b:.2f}"
        return score_a, score_b, notes

    @staticmethod
    def _score(expected: str, actual: str) -> float:
        if not actual:
            return 0.0
        if actual.strip() == expected.strip():
            return 1.0
        expected_words = set(expected.lower().split())
        actual_words = set(actual.lower().split())
        if not expected_words:
            return 0.0
        overlap = len(expected_words & actual_words) / len(expected_words)
        if overlap >= 0.8:
            return 0.8
        if overlap >= 0.5:
            return 0.5
        return 0.0


# ========== EvalLedgerStore ==========


class EvalLedgerStore:
    """Eval Ledger 存储 + 查询（CL-004）。

    职责：
    - 存储 EvalLedger 记录（内存骨架，生产环境应换为持久化存储）
    - 查询历史 Eval 记录（按 method_id / proposal_id / merged 状态）
    - 统计指标（total / merged / rejected / smoke_passed / promotion_passed）

    详见 design.md v7.1-§D7.6.6。
    """

    def __init__(
        self,
        judge: CaseJudgeProtocol | None = None,
        min_net_gain: float = DEFAULT_MIN_NET_GAIN,
    ) -> None:
        self._ledgers: dict[str, EvalLedger] = {}
        self._judge = judge or RuleBasedJudge()
        self.min_net_gain = min_net_gain
        logger.debug(
            f"eval_ledger_store init: min_net_gain={min_net_gain}, "
            f"judge={type(self._judge).__name__}"
        )

    def save(self, ledger: EvalLedger) -> str:
        """保存 EvalLedger 记录，返回 eval_id。"""
        self._ledgers[ledger.eval_id] = ledger
        logger.info(
            f"eval_ledger save: id={ledger.eval_id}, "
            f"method={ledger.method_id}, net_gain={ledger.net_gain:.4f}, "
            f"merged={ledger.merged}"
        )
        return ledger.eval_id

    def get(self, eval_id: str) -> EvalLedger | None:
        """获取单条 EvalLedger 记录。"""
        return self._ledgers.get(eval_id)

    def list_by_method(self, method_id: str) -> list[EvalLedger]:
        """按方法库（锻典）条目 ID 查询所有 Eval 记录。"""
        return [l for l in self._ledgers.values() if l.method_id == method_id]

    def list_by_proposal(self, proposal_id: str) -> list[EvalLedger]:
        """按进化提案 ID 查询所有 Eval 记录。"""
        return [l for l in self._ledgers.values() if l.proposal_id == proposal_id]

    def list_merged(self) -> list[EvalLedger]:
        """查询所有已合入的 Eval 记录。"""
        return [l for l in self._ledgers.values() if l.merged]

    def list_rejected(self) -> list[EvalLedger]:
        """查询所有被拒绝的 Eval 记录。"""
        return [l for l in self._ledgers.values() if not l.merged]

    def get_stats(self) -> dict[str, int]:
        """统计 {total, merged, rejected, smoke_passed, promotion_passed}。"""
        total = len(self._ledgers)
        merged = sum(1 for l in self._ledgers.values() if l.merged)
        rejected = total - merged
        smoke = sum(1 for l in self._ledgers.values() if l.smoke_gate_passed)
        promotion = sum(1 for l in self._ledgers.values() if l.promotion_gate_passed)
        return {
            "total": total,
            "merged": merged,
            "rejected": rejected,
            "smoke_passed": smoke,
            "promotion_passed": promotion,
        }


# ========== ReplayABRunner ==========


class ReplayABRunner:
    """Replay A/B 流程执行器（CL-004）。

    执行 7 步流程（design.md v7.1-§D7.6.3）：
    Step 1: 选取测试用例集（3 smoke + 5 promotion）
    Step 2: 前测（A 组）— 使用当前方法库（锻典）条目
    Step 3: 后测（B 组）— 使用提案修改后的方法库条目
    Step 4: 计算净增益 = post_score - pre_score
    Step 5: 烟雾门校验（3 cases, ≥2/3 pass）
    Step 6: 晋升门校验（5 cases, ≥3/5 pass, 覆盖 3 类）
    Step 7: 决策（净增益 > min_net_gain AND 双门通过 → 允许合入）
    """

    def __init__(
        self,
        store: EvalLedgerStore,
        judge: CaseJudgeProtocol | None = None,
        min_net_gain: float | None = None,
    ) -> None:
        self.store = store
        self.judge = judge or store._judge  # type: ignore[attr-defined]
        self.min_net_gain = (
            min_net_gain if min_net_gain is not None else store.min_net_gain
        )

    async def run_replay_ab(
        self,
        method_id: str,
        proposal_id: str,
        test_cases: list[TestCase],
        runner_a: Callable[[TestCase], Awaitable[str]] | None = None,
        runner_b: Callable[[TestCase], Awaitable[str]] | None = None,
    ) -> EvalLedger:
        """执行 Replay A/B 7 步流程，返回 EvalLedger。

        参数：
        - method_id: 被评估的方法库（锻典）条目 ID
        - proposal_id: 关联的进化提案 ID
        - test_cases: 测试用例集（≥8：3 smoke + 5 promotion）
        - runner_a: A 组执行器（前测，使用当前方法库条目）
        - runner_b: B 组执行器（后测，使用提案修改后的方法库条目）

        runner_a/runner_b 签名：async def runner(case: TestCase) -> str
        若不提供，使用空字符串作为输出（骨架模式）。

        返回：EvalLedger（含 net_gain / merged / reject_reason 等字段）
        """
        # Step 1: 校验测试用例集
        self._validate_test_cases(test_cases)

        # 生成 eval_id
        eval_id = self._gen_eval_id(method_id, proposal_id)
        logger.info(
            f"replay_ab start: eval_id={eval_id}, method={method_id}, "
            f"proposal={proposal_id}, cases={len(test_cases)}"
        )

        # Step 2 + Step 3: 前测 + 后测（顺序执行每个 case）
        case_results: list[CaseResult] = []
        for case in test_cases:
            actual_a = await runner_a(case) if runner_a else ""
            actual_b = await runner_b(case) if runner_b else ""
            score_a, score_b, notes = await self.judge.judge(
                case, actual_a, actual_b
            )
            passed = score_b > score_a
            case_results.append(
                CaseResult(
                    case_id=case.case_id,
                    actual_a=actual_a,
                    actual_b=actual_b,
                    score_a=score_a,
                    score_b=score_b,
                    passed=passed,
                    judge_notes=notes,
                )
            )

        # Step 4: 计算净增益
        pre_score = self._avg_score(case_results, score_field="score_a")
        post_score = self._avg_score(case_results, score_field="score_b")
        net_gain = post_score - pre_score

        # 计算 judge_rubric 四维净增益（骨架：用整体分数填充）
        judge_rubric = self._compute_judge_rubric(case_results)

        # Step 5: 烟雾门校验
        smoke_results = [
            (cr, tc)
            for cr, tc in zip(case_results, test_cases)
            if tc.is_smoke
        ]
        smoke_passed_count = sum(1 for cr, _ in smoke_results if cr.passed)
        smoke_gate_passed = smoke_passed_count >= SMOKE_PASS_THRESHOLD

        # Step 6: 晋升门校验
        promotion_results = [
            (cr, tc)
            for cr, tc in zip(case_results, test_cases)
            if not tc.is_smoke
        ]
        promotion_passed_count = sum(1 for cr, _ in promotion_results if cr.passed)
        type_coverage_ok = self._check_case_type_coverage(
            [tc for _, tc in promotion_results]
        )
        promotion_gate_passed = (
            promotion_passed_count >= PROMOTION_PASS_THRESHOLD and type_coverage_ok
        )

        # Step 7: 决策
        merged = (
            net_gain > self.min_net_gain
            and smoke_gate_passed
            and promotion_gate_passed
        )
        reject_reason = self._compute_reject_reason(
            net_gain, smoke_gate_passed, promotion_gate_passed, merged
        )

        # 构造 cases 字段
        cases_dict = [
            self._case_result_to_dict(cr, tc)
            for cr, tc in zip(case_results, test_cases)
        ]

        # 构造 EvalLedger
        ledger = EvalLedger(
            eval_id=eval_id,
            method_id=method_id,
            proposal_id=proposal_id,
            pre_score=pre_score,
            post_score=post_score,
            net_gain=net_gain,
            cases=cases_dict,
            judge_rubric=judge_rubric,
            smoke_gate_passed=smoke_gate_passed,
            promotion_gate_passed=promotion_gate_passed,
            merged=merged,
            reject_reason=reject_reason,
        )

        # 保存
        self.store.save(ledger)

        logger.info(
            f"replay_ab done: eval_id={eval_id}, "
            f"pre={pre_score:.4f}, post={post_score:.4f}, "
            f"net_gain={net_gain:.4f}, "
            f"smoke={smoke_gate_passed}({smoke_passed_count}/{SMOKE_CASE_COUNT}), "
            f"promotion={promotion_gate_passed}"
            f"({promotion_passed_count}/{PROMOTION_CASE_COUNT}), "
            f"merged={merged}"
        )

        return ledger

    def _validate_test_cases(self, test_cases: list[TestCase]) -> None:
        """校验测试用例集（Step 1）。"""
        total_required = SMOKE_CASE_COUNT + PROMOTION_CASE_COUNT
        if len(test_cases) < total_required:
            raise ValueError(
                f"测试用例数不足：需要 ≥{total_required} 个"
                f"（{SMOKE_CASE_COUNT} smoke + {PROMOTION_CASE_COUNT} promotion），"
                f"实际 {len(test_cases)} 个"
            )
        smoke_count = sum(1 for tc in test_cases if tc.is_smoke)
        promotion_count = sum(1 for tc in test_cases if not tc.is_smoke)
        if smoke_count < SMOKE_CASE_COUNT:
            raise ValueError(
                f"smoke case 数不足：需要 ≥{SMOKE_CASE_COUNT}，实际 {smoke_count}"
            )
        if promotion_count < PROMOTION_CASE_COUNT:
            raise ValueError(
                f"promotion case 数不足：需要 ≥{PROMOTION_CASE_COUNT}，"
                f"实际 {promotion_count}"
            )

    @staticmethod
    def _check_case_type_coverage(promotion_cases: list[TestCase]) -> bool:
        """校验 promotion cases 是否覆盖 3 类（Step 6 子检查）。"""
        covered_types = {tc.case_type for tc in promotion_cases}
        return REQUIRED_CASE_TYPES.issubset(covered_types)

    @staticmethod
    def _avg_score(results: list[CaseResult], score_field: str) -> float:
        """计算平均分。"""
        if not results:
            return 0.0
        total = sum(getattr(cr, score_field) for cr in results)
        return total / len(results)

    @staticmethod
    def _compute_judge_rubric(case_results: list[CaseResult]) -> dict[str, float]:
        """计算 judge_rubric 四维（骨架：用整体分数填充）。

        实际生产应由 LLM 评审器分别打分（boundary_compliance /
        evidence_handling / knowledge_application / human_edit_volume）。
        """
        if not case_results:
            return {
                "boundary_compliance": 0.0,
                "evidence_handling": 0.0,
                "knowledge_application": 0.0,
                "human_edit_volume": 0.0,
            }
        avg_b = sum(cr.score_b for cr in case_results) / len(case_results)
        return {
            "boundary_compliance": avg_b,
            "evidence_handling": avg_b,
            "knowledge_application": avg_b,
            "human_edit_volume": max(0.0, 1.0 - avg_b),  # 反向评分
        }

    def _compute_reject_reason(
        self,
        net_gain: float,
        smoke_passed: bool,
        promotion_passed: bool,
        merged: bool,
    ) -> str:
        """计算拒绝原因（Step 7）。"""
        if merged:
            return ""
        reasons: list[str] = []
        if net_gain <= self.min_net_gain:
            reasons.append(
                f"net_gain={net_gain:.4f} ≤ min_net_gain={self.min_net_gain:.4f}"
            )
        if not smoke_passed:
            reasons.append("smoke_gate 未通过")
        if not promotion_passed:
            reasons.append("promotion_gate 未通过")
        return "; ".join(reasons) if reasons else "unknown"

    @staticmethod
    def _case_result_to_dict(cr: CaseResult, tc: TestCase) -> dict[str, Any]:
        """CaseResult + TestCase 转 dict（存入 EvalLedger.cases）。"""
        return {
            "case_id": cr.case_id,
            "case_type": tc.case_type,
            "is_smoke": tc.is_smoke,
            "input": tc.input,
            "expected": tc.expected,
            "actual_a": cr.actual_a,
            "actual_b": cr.actual_b,
            "score_a": cr.score_a,
            "score_b": cr.score_b,
            "passed": cr.passed,
            "judge_notes": cr.judge_notes,
        }

    @staticmethod
    def _gen_eval_id(method_id: str, proposal_id: str) -> str:
        """生成 eval_id：eval-{method_id}-{proposal_id}-{timestamp}-{random6}。"""
        ts = int(datetime.utcnow().timestamp())
        rand = secrets.token_hex(3)
        # 截断 method_id / proposal_id 防止过长
        m = method_id[:24] if method_id else "unknown"
        p = proposal_id[:24] if proposal_id else "unknown"
        return f"eval-{m}-{p}-{ts}-{rand}"


# ========== 顶层 API ==========


async def run_replay_ab(
    method_id: str,
    proposal_id: str,
    test_cases: list[TestCase],
    store: EvalLedgerStore | None = None,
    judge: CaseJudgeProtocol | None = None,
    min_net_gain: float = DEFAULT_MIN_NET_GAIN,
    runner_a: Callable[[TestCase], Awaitable[str]] | None = None,
    runner_b: Callable[[TestCase], Awaitable[str]] | None = None,
) -> EvalLedger:
    """顶层 API：执行 Replay A/B 7 步流程（CL-004）。

    参数：
    - method_id: 被评估的方法库（锻典）条目 ID
    - proposal_id: 关联的进化提案 ID
    - test_cases: 测试用例集（≥8：3 smoke + 5 promotion，3 类覆盖）
    - store: EvalLedgerStore（不提供则创建临时 store）
    - judge: CaseJudgeProtocol（不提供则使用 RuleBasedJudge）
    - min_net_gain: 净增益阈值，默认 0.05（design.md v7.1-§D7.3）
    - runner_a: A 组执行器（前测，使用当前方法库条目）
    - runner_b: B 组执行器（后测，使用提案修改后的方法库条目）

    返回：EvalLedger（含 net_gain / merged / reject_reason 等字段）

    示例::

        from flowforge.evolution.eval_ledger import (
            TestCase, run_replay_ab
        )

        cases = [
            TestCase(case_id="s1", case_type="standard_success",
                     input="...", expected="...", is_smoke=True),
            # ... 共 8 个 case（3 smoke + 5 promotion）
        ]

        async def runner_a(case): return "A 组输出"
        async def runner_b(case): return "B 组输出（更好的）"

        ledger = await run_replay_ab(
            method_id="method-001",
            proposal_id="prop-001",
            test_cases=cases,
            runner_a=runner_a,
            runner_b=runner_b,
        )

        if ledger.merged:
            print(f"合入成功，净增益 {ledger.net_gain:.4f}")
        else:
            print(f"拒绝：{ledger.reject_reason}")
    """
    if store is None:
        store = EvalLedgerStore(judge=judge, min_net_gain=min_net_gain)
    runner = ReplayABRunner(
        store=store, judge=judge, min_net_gain=min_net_gain
    )
    return await runner.run_replay_ab(
        method_id=method_id,
        proposal_id=proposal_id,
        test_cases=test_cases,
        runner_a=runner_a,
        runner_b=runner_b,
    )


__all__ = [
    # 常量
    "DEFAULT_MIN_NET_GAIN",
    "SMOKE_CASE_COUNT",
    "SMOKE_PASS_THRESHOLD",
    "PROMOTION_CASE_COUNT",
    "PROMOTION_PASS_THRESHOLD",
    "REQUIRED_CASE_TYPES",
    # 数据模型
    "TestCase",
    "CaseResult",
    "CaseType",
    # Judge
    "CaseJudgeProtocol",
    "RuleBasedJudge",
    # Store
    "EvalLedgerStore",
    # Runner
    "ReplayABRunner",
    # 顶层 API
    "run_replay_ab",
]
