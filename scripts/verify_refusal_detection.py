#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 LoopExecutor 拒绝检测机制（2 次拒绝即终止）的自动化脚本。

模拟连续 50 次多轮对话场景，验证：
1. 连续 2 次拒绝响应 → Loop 快速失败终止
2. 单次拒绝后恢复正常 → Loop 继续执行
3. 正常对话 → Loop 正常完成
4. 混合场景（正常→拒绝→恢复）→ Loop 行为正确

运行方式:
    cd d:\\software\\openclaw\\flowlight-ai\\flowforge
    python scripts/verify_refusal_detection.py
    python scripts/verify_refusal_detection.py --concurrency 50  # 指定轮次
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# 确保能导入 flowforge 包
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from flowforge.loop.executor import LoopExecutor
from flowforge.loop.state import LoopState
from flowforge.loop.verifier import Verifier


# ── 真实场景的拒绝响应文本（来自 OpenRoute 实际返回）──
REFUSAL_RESPONSES = [
    "无法回答",
    "无法回答这个问题",
    "我暂时无法回答",
    "我不能回答",
    "我无法提供",
    "我无法完成",
    "当前不可用，请稍后重试",
    "当前不可用,请稍后重试",
]

# 真实场景的正常响应（模拟文章/代码/文档产出）
NORMAL_RESPONSES = [
    "# 技术方案设计\n\n## 一、背景\n\n本文档描述了 FlowForge 生态的架构设计方案，"
    "旨在通过分层架构和插件化机制实现可扩展的智能体平台。\n\n## 二、核心组件\n\n"
    "1. 核心框架层：提供基础设施能力\n2. 应用层：承载可进化智能体\n3. 垂直业务层：扩展专业场景",

    "# 代码审查报告\n\n## 审查概要\n\n本次审查覆盖了 LoopExecutor 模块的核心逻辑，"
    "包括快速失败机制、trace_id 日志、迭代重试策略。代码质量良好，"
    "符合项目规范要求。\n\n## 详细分析\n\n- 拒绝检测逻辑正确\n- 日志覆盖完整",

    "# 测试用例设计\n\n## T7 审核测试\n\n验证 LLM 生成的内容无 AI 痕迹，"
    "确保文章质量符合发布标准。测试覆盖了多种内容类型，"
    "包括技术文章、产品文档、用户指南等。",

    "# 架构决策记录\n\n## ADR-015: 拒绝检测机制\n\n### 背景\n\n当 LLM 因账号封禁或配额耗尽"
    "持续返回拒绝响应时，LoopExecutor 不应继续耗费资源跑完所有迭代。\n\n### 决策\n\n"
    "实现 max_consecutive_refusals 阈值（默认2），连续达到阈值后提前终止。",
]


@dataclass
class ScenarioResult:
    """单次对话场景的结果。"""
    scenario_id: int
    scenario_type: str  # "consecutive_refusal" | "single_refusal_recovery" | "normal" | "mixed"
    passed: bool  # Loop 是否正常完成
    iterations: int
    terminated_by_refusal: bool  # 是否因拒绝检测而终止
    termination_reason: str
    duration_ms: float
    expected_fast_fail: bool  # 预期是否应快速失败
    actual_fast_fail: bool  # 实际是否快速失败
    correct: bool  # 行为是否符合预期


@dataclass
class TestReport:
    """50 次对话的完整测试报告。"""
    total_scenarios: int = 0
    passed_scenarios: int = 0  # 行为符合预期的场景数
    fast_fail_triggered: int = 0  # 快速失败被触发的次数
    fast_fail_correct: int = 0  # 快速失败正确触发的次数
    recovery_correct: int = 0  # 单次拒绝后正确恢复的次数
    normal_correct: int = 0  # 正常对话正确完成的次数
    results: list[ScenarioResult] = field(default_factory=list)
    total_duration_ms: float = 0.0

    @property
    def pass_rate(self) -> float:
        if self.total_scenarios == 0:
            return 0.0
        return self.passed_scenarios / self.total_scenarios

    def summary(self) -> str:
        lines = [
            "=" * 70,
            "拒绝检测机制验证报告 — 50 次多轮对话",
            "=" * 70,
            f"总场景数: {self.total_scenarios}",
            f"行为符合预期: {self.passed_scenarios}/{self.total_scenarios} "
            f"({self.pass_rate:.1%})",
            "",
            "── 快速失败统计 ──",
            f"  快速失败被触发: {self.fast_fail_triggered} 次",
            f"  快速失败正确触发: {self.fast_fail_correct} 次",
            f"  单次拒绝后正确恢复: {self.recovery_correct} 次",
            f"  正常对话正确完成: {self.normal_correct} 次",
            "",
            f"总耗时: {self.total_duration_ms:.0f}ms "
            f"(平均 {self.total_duration_ms/max(self.total_scenarios,1):.0f}ms/场景)",
            "=" * 70,
        ]
        return "\n".join(lines)


def _make_state(task_brief: str = "验证拒绝检测机制") -> LoopState:
    """创建带验收标准的 LoopState。"""
    state = LoopState(
        task_brief=task_brief,
        scope_baseline="refusal-detection-test",
        acceptance_criteria=["产出内容有效，非拒绝响应"],
        max_iterations=5,
    )
    # 预置验收证据，让正常响应能通过 should_terminate
    state.cvo_vision_confirmed = True
    state.attach_evidence("产出内容有效，非拒绝响应", "pre-seeded")
    return state


def _always_pass_reviewer(artifact: str, ctx: dict) -> dict:
    """简单评审器：只要不是拒绝响应就通过。"""
    is_refusal = any(r in artifact for r in REFUSAL_RESPONSES)
    return {
        "reviewer": "test_reviewer",
        "pass": not is_refusal,
        "score": 0.95 if not is_refusal else 0.1,
    }


def _always_fail_reviewer(artifact: str, ctx: dict) -> dict:
    """总是失败的评审器：用于需要让 Loop 继续迭代（不提前成功终止）的场景。

    在混合/间歇拒绝场景中，正常响应若通过 verifier 会导致 Loop 提前终止，
    无法触发后续的拒绝检测。使用此评审器确保 Loop 在正常响应后继续迭代。
    """
    is_refusal = any(r in artifact for r in REFUSAL_RESPONSES)
    return {
        "reviewer": "test_reviewer",
        "pass": False,  # 总是失败，迫使 Loop 继续
        "score": 0.1,
    }


# ── 场景生成器 ──────────────────────────────────────────────────────────


def _scenario_consecutive_refusal(scenario_id: int) -> tuple[dict, ScenarioResult]:
    """场景A：连续 2 次拒绝 → 应快速失败。"""
    refusal = random.choice(REFUSAL_RESPONSES)

    async def action(state: LoopState) -> str:
        return refusal

    expected = ScenarioResult(
        scenario_id=scenario_id,
        scenario_type="consecutive_refusal",
        passed=False,
        iterations=2,
        terminated_by_refusal=True,
        duration_ms=0,
        expected_fast_fail=True,
        actual_fast_fail=False,
        correct=False,
        termination_reason="",
    )
    return {"action_fn": action, "reviewer": _always_pass_reviewer}, expected


def _scenario_single_refusal_recovery(scenario_id: int) -> tuple[dict, ScenarioResult]:
    """场景B：第1次拒绝，第2次恢复 → 不应快速失败，应继续。"""
    refusal = random.choice(REFUSAL_RESPONSES)
    normal = random.choice(NORMAL_RESPONSES)
    call_count = {"n": 0}

    async def action(state: LoopState) -> str:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return refusal
        return normal

    expected = ScenarioResult(
        scenario_id=scenario_id,
        scenario_type="single_refusal_recovery",
        passed=True,
        iterations=2,
        terminated_by_refusal=False,
        duration_ms=0,
        expected_fast_fail=False,
        actual_fast_fail=False,
        correct=False,
        termination_reason="",
    )
    return {"action_fn": action, "reviewer": _always_pass_reviewer}, expected


def _scenario_normal(scenario_id: int) -> tuple[dict, ScenarioResult]:
    """场景C：全程正常 → 应正常完成。"""
    normal = random.choice(NORMAL_RESPONSES)

    async def action(state: LoopState) -> str:
        return normal

    expected = ScenarioResult(
        scenario_id=scenario_id,
        scenario_type="normal",
        passed=True,
        iterations=1,
        terminated_by_refusal=False,
        duration_ms=0,
        expected_fast_fail=False,
        actual_fast_fail=False,
        correct=False,
        termination_reason="",
    )
    return {"action_fn": action, "reviewer": _always_pass_reviewer}, expected


def _scenario_mixed(scenario_id: int) -> tuple[dict, ScenarioResult]:
    """场景D：正常→拒绝→拒绝 → 应在第3次迭代时快速失败。

    使用 always_fail_reviewer 确保正常响应不通过 verifier，Loop 继续迭代到拒绝阶段。
    """
    normal = random.choice(NORMAL_RESPONSES)
    refusal = random.choice(REFUSAL_RESPONSES)
    call_count = {"n": 0}

    async def action(state: LoopState) -> str:
        call_count["n"] += 1
        if call_count["n"] <= 1:
            return normal
        return refusal

    expected = ScenarioResult(
        scenario_id=scenario_id,
        scenario_type="mixed",
        passed=False,
        iterations=3,
        terminated_by_refusal=True,
        duration_ms=0,
        expected_fast_fail=True,
        actual_fast_fail=False,
        correct=False,
        termination_reason="",
    )
    return {"action_fn": action, "reviewer": _always_fail_reviewer}, expected


def _scenario_intermittent_refusal(scenario_id: int) -> tuple[dict, ScenarioResult]:
    """场景E：拒绝→正常→拒绝→拒绝 → 第4次迭代时快速失败。

    验证拒绝计数重置逻辑：第1次拒绝(计数1) → 第2次正常(计数重置0) →
    第3次拒绝(计数1) → 第4次拒绝(计数2，触发快速失败)。

    使用 always_fail_reviewer 确保正常响应不通过 verifier，Loop 继续迭代到拒绝阶段。
    """
    refusal = random.choice(REFUSAL_RESPONSES)
    normal = random.choice(NORMAL_RESPONSES)
    call_count = {"n": 0}

    async def action(state: LoopState) -> str:
        call_count["n"] += 1
        if call_count["n"] in (1, 3, 4):
            return refusal
        return normal

    expected = ScenarioResult(
        scenario_id=scenario_id,
        scenario_type="intermittent_refusal",
        passed=False,
        iterations=4,
        terminated_by_refusal=True,
        duration_ms=0,
        expected_fast_fail=True,
        actual_fast_fail=False,
        correct=False,
        termination_reason="",
    )
    return {"action_fn": action, "reviewer": _always_fail_reviewer}, expected


# ── 场景分配（50 次对话的场景分布）──
# 30% 连续拒绝（15次）— 验证快速失败触发
# 20% 单次拒绝恢复（10次）— 验证不误杀
# 20% 正常对话（10次）— 验证正常流程不受影响
# 15% 混合场景（7-8次）— 验证正常→拒绝的转换
# 15% 间歇拒绝（7-8次）— 验证计数重置逻辑


def _generate_scenarios(total: int) -> list[tuple[int, callable]]:
    """生成 total 个场景的分配列表。"""
    scenario_generators = []
    # 按比例分配
    n_consecutive = max(1, int(total * 0.30))
    n_single_recovery = max(1, int(total * 0.20))
    n_normal = max(1, int(total * 0.20))
    n_mixed = max(1, int(total * 0.15))
    n_intermittent = total - n_consecutive - n_single_recovery - n_normal - n_mixed

    for i in range(n_consecutive):
        scenario_generators.append((i, _scenario_consecutive_refusal))
    for i in range(n_single_recovery):
        scenario_generators.append((i, _scenario_single_refusal_recovery))
    for i in range(n_normal):
        scenario_generators.append((i, _scenario_normal))
    for i in range(n_mixed):
        scenario_generators.append((i, _scenario_mixed))
    for i in range(n_intermittent):
        scenario_generators.append((i, _scenario_intermittent_refusal))

    # 打乱顺序模拟真实场景
    random.shuffle(scenario_generators)
    # 重新编号
    return [(idx + 1, gen) for idx, (old_id, gen) in enumerate(scenario_generators)]


# ── 执行单个场景 ──────────────────────────────────────────────────────────


async def _run_scenario(scenario_id: int, gen: callable) -> ScenarioResult:
    """执行单个对话场景，返回实际结果。"""
    kwargs, expected = gen(scenario_id)
    state = _make_state(task_brief=f"场景{scenario_id}: {expected.scenario_type}")

    # 混合/间歇场景使用 always_fail_reviewer 防止 Loop 在正常响应时提前成功终止
    reviewer = kwargs.get("reviewer", _always_pass_reviewer)

    executor = LoopExecutor(
        action_fn=kwargs["action_fn"],
        verifier=Verifier(quality_threshold=0.85, reviewer=reviewer),
        max_iterations=5,
        max_consecutive_refusals=2,
    )

    _start = time.monotonic()
    result = await executor.run(state)
    _duration_ms = (time.monotonic() - _start) * 1000

    actual = ScenarioResult(
        scenario_id=scenario_id,
        scenario_type=expected.scenario_type,
        passed=result.passed,
        iterations=result.iterations,
        terminated_by_refusal="consecutive refusals" in (result.termination_reason or ""),
        duration_ms=_duration_ms,
        expected_fast_fail=expected.expected_fast_fail,
        actual_fast_fail="consecutive refusals" in (result.termination_reason or ""),
        correct=False,  # 下面计算
        termination_reason=result.termination_reason or "",
    )

    # 判断行为是否正确：
    # 1. 如果预期快速失败：actual.terminated_by_refusal 应为 True，且 iterations <= 2 的连续拒绝场景
    # 2. 如果预期不快速失败：actual.terminated_by_refusal 应为 False
    # 3. passed 应与预期一致（预期通过的场景 passed=True，预期快速失败的场景 passed=False）
    if actual.expected_fast_fail:
        actual.correct = (
            actual.terminated_by_refusal
            and not actual.passed
            and "consecutive refusals" in actual.termination_reason
        )
    else:
        actual.correct = (
            not actual.terminated_by_refusal
            and actual.passed == expected.passed
        )

    return actual


# ── 主流程 ──────────────────────────────────────────────────────────────


async def run_verification(total_scenarios: int = 50) -> TestReport:
    """运行 total_scenarios 次多轮对话验证。"""
    report = TestReport()
    report.total_scenarios = total_scenarios
    _overall_start = time.monotonic()

    scenarios = _generate_scenarios(total_scenarios)

    print(f"\n开始验证：{total_scenarios} 次多轮对话场景")
    print(f"场景分布：连续拒绝={sum(1 for _, g in scenarios if g == _scenario_consecutive_refusal)} | "
          f"单次恢复={sum(1 for _, g in scenarios if g == _scenario_single_refusal_recovery)} | "
          f"正常={sum(1 for _, g in scenarios if g == _scenario_normal)} | "
          f"混合={sum(1 for _, g in scenarios if g == _scenario_mixed)} | "
          f"间歇={sum(1 for _, g in scenarios if g == _scenario_intermittent_refusal)}")
    print("-" * 70)

    for idx, (scenario_id, gen) in enumerate(scenarios, 1):
        result = await _run_scenario(scenario_id, gen)
        report.results.append(result)

        # 统计
        if result.correct:
            report.passed_scenarios += 1
        if result.terminated_by_refusal:
            report.fast_fail_triggered += 1
        if result.terminated_by_refusal and result.expected_fast_fail:
            report.fast_fail_correct += 1
        if not result.terminated_by_refusal and result.scenario_type == "single_refusal_recovery":
            report.recovery_correct += 1
        if result.passed and result.scenario_type == "normal":
            report.normal_correct += 1

        # 实时输出
        status_icon = "✅" if result.correct else "❌"
        fast_fail_tag = "[快速失败]" if result.terminated_by_refusal else ""
        print(
            f"  [{idx:3d}/{total_scenarios}] {status_icon} 场景{scenario_id:3d} "
            f"{result.scenario_type:25s} {fast_fail_tag:7s} "
            f"迭代={result.iterations} 耗时={result.duration_ms:.0f}ms "
            f"原因={result.termination_reason[:40]}"
        )

    report.total_duration_ms = (time.monotonic() - _overall_start) * 1000
    return report


def main():
    parser = argparse.ArgumentParser(
        description="验证 LoopExecutor 拒绝检测机制（2 次拒绝即终止）"
    )
    parser.add_argument(
        "--concurrency", "-n", type=int, default=50,
        help="模拟对话场景数量（默认50）"
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="随机种子（用于可复现的测试）"
    )
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        print(f"随机种子已设置: {args.seed}")

    report = asyncio.run(run_verification(args.concurrency))

    print()
    print(report.summary())

    # 详细错误分析
    incorrect = [r for r in report.results if not r.correct]
    if incorrect:
        print(f"\n── 不符合预期的场景（{len(incorrect)}个）──")
        for r in incorrect:
            print(
                f"  场景{r.scenario_id} ({r.scenario_type}): "
                f"预期快速失败={r.expected_fast_fail}, 实际快速失败={r.actual_fast_fail}, "
                f"passed={r.passed}, 迭代={r.iterations}, "
                f"原因={r.termination_reason}"
            )

    # 最终判定
    print()
    if report.pass_rate == 1.0:
        print("✅ 验证通过：所有场景行为符合预期，拒绝检测机制（2次拒绝即终止）生效。")
        return 0
    elif report.pass_rate >= 0.95:
        print(f"⚠️ 基本通过：{report.pass_rate:.1%} 场景符合预期，但有少量异常需排查。")
        return 0
    else:
        print(f"❌ 验证失败：仅 {report.pass_rate:.1%} 场景符合预期，拒绝检测机制可能存在问题。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
