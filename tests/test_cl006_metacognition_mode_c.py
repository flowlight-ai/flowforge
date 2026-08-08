"""CL-006 元认知 Mode C — 反思模式单元测试.

测试覆盖：
1. MetacognitionReflection 数据模型完整性
2. MetacognitionReflector.reflect_on_decision 四种 outcome
3. domain_reliability 调整量计算
4. 校准分数（calibration_score）计算
5. EchoStore 导出
6. 与 Mode A/B 路由的集成（route_confidence + reflect 闭环）
"""
from __future__ import annotations

import pytest

from flowforge.evolution.metacognition import (
    HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD,
    MetacognitionReflection,
    MetacognitionReflector,
    MetacognitionRouter,
    ReflectionOutcome,
)


# ── MetacognitionReflection 数据模型 ────────────────────────────────


def test_reflection_model_creation():
    """MetacognitionReflection 数据模型可创建."""
    reflection = MetacognitionReflection(
        reflection_id="reflect-001",
        decision_id="decision-001",
        domain="development",
        outcome="confirmed",
        predicted_confidence=0.85,
        actual_success=True,
        actual_quality_score=0.92,
        reflection_notes="预测准确",
        signal_updates={"domain_reliability_delta": 0.02},
    )
    assert reflection.reflection_id == "reflect-001"
    assert reflection.decision_id == "decision-001"
    assert reflection.domain == "development"
    assert reflection.outcome == "confirmed"
    assert reflection.predicted_confidence == 0.85
    assert reflection.actual_success is True
    assert reflection.actual_quality_score == 0.92
    assert reflection.signal_updates["domain_reliability_delta"] == 0.02
    assert reflection.created_at is not None


def test_reflection_outcome_literal():
    """ReflectionOutcome 必须是 4 种之一."""
    valid_outcomes = {"confirmed", "corrected", "rejected", "escalated"}
    from typing import get_args
    outcomes = set(get_args(ReflectionOutcome))
    assert outcomes == valid_outcomes


# ── MetacognitionReflector.reflect_on_decision ─────────────────────


def test_reflect_confirmed():
    """confirmed → delta=+0.02."""
    reflector = MetacognitionReflector()
    reflection = reflector.reflect_on_decision(
        decision_id="d1",
        domain="dev",
        outcome="confirmed",
        predicted_confidence=0.9,
        actual_success=True,
        actual_quality_score=0.95,
    )
    assert reflection.outcome == "confirmed"
    assert reflection.signal_updates["domain_reliability_delta"] == 0.02
    assert reflector.total_reflections == 1


def test_reflect_corrected():
    """corrected → delta=0.0."""
    reflector = MetacognitionReflector()
    reflection = reflector.reflect_on_decision(
        decision_id="d1",
        domain="dev",
        outcome="corrected",
    )
    assert reflection.signal_updates["domain_reliability_delta"] == 0.0


def test_reflect_rejected():
    """rejected → delta=-0.10."""
    reflector = MetacognitionReflector()
    reflection = reflector.reflect_on_decision(
        decision_id="d1",
        domain="dev",
        outcome="rejected",
    )
    assert reflection.signal_updates["domain_reliability_delta"] == -0.10


def test_reflect_escalated():
    """escalated → delta=-0.05."""
    reflector = MetacognitionReflector()
    reflection = reflector.reflect_on_decision(
        decision_id="d1",
        domain="dev",
        outcome="escalated",
    )
    assert reflection.signal_updates["domain_reliability_delta"] == -0.05


def test_reflect_accumulation():
    """多次反思累积."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="rejected")
    reflector.reflect_on_decision(decision_id="d3", domain="dev", outcome="confirmed")
    assert reflector.total_reflections == 3


# ── domain_reliability 调整量计算 ─────────────────────────────────


def test_compute_reliability_adjustment_empty():
    """无反思记录 → 调整量 0."""
    reflector = MetacognitionReflector()
    assert reflector.compute_reliability_adjustment("dev") == 0.0


def test_compute_reliability_adjustment_confirmed_only():
    """只有 confirmed 记录 → 累积 +0.02*N."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="confirmed")
    adjustment = reflector.compute_reliability_adjustment("dev")
    assert adjustment == 0.04  # 2 * 0.02


def test_compute_reliability_adjustment_mixed():
    """混合反思 → 累积正确."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="rejected")
    reflector.reflect_on_decision(decision_id="d3", domain="dev", outcome="escalated")
    # 0.02 - 0.10 - 0.05 = -0.13
    adjustment = reflector.compute_reliability_adjustment("dev")
    assert round(adjustment, 4) == -0.13


def test_compute_reliability_adjustment_isolated_by_domain():
    """不同领域的反思互不影响."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="rejected")
    reflector.reflect_on_decision(decision_id="d2", domain="medical", outcome="confirmed")
    assert reflector.compute_reliability_adjustment("dev") == -0.10
    assert reflector.compute_reliability_adjustment("medical") == 0.02


# ── 校准分数（calibration_score）─────────────────────────────────


def test_calibration_score_empty():
    """无反思 → 校准 0.0."""
    reflector = MetacognitionReflector()
    assert reflector.compute_calibration_score() == 0.0


def test_calibration_score_all_confirmed():
    """全部 confirmed → 校准 1.0."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="confirmed")
    assert reflector.compute_calibration_score() == 1.0


def test_calibration_score_all_rejected():
    """全部 rejected → 校准 0.0."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="rejected")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="rejected")
    assert reflector.compute_calibration_score() == 0.0


def test_calibration_score_mixed():
    """混合 → 校准分数正确."""
    reflector = MetacognitionReflector()
    # 3 confirmed + 1 corrected + 1 rejected = 4/5 accurate
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d3", domain="dev", outcome="corrected")
    reflector.reflect_on_decision(decision_id="d4", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d5", domain="dev", outcome="rejected")
    assert reflector.compute_calibration_score() == 0.8  # 4/5


def test_calibration_score_by_domain():
    """按领域计算校准分数."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(decision_id="d1", domain="dev", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d2", domain="dev", outcome="rejected")
    reflector.reflect_on_decision(decision_id="d3", domain="medical", outcome="confirmed")
    reflector.reflect_on_decision(decision_id="d4", domain="medical", outcome="confirmed")
    # dev: 1/2 = 0.5, medical: 2/2 = 1.0
    assert reflector.compute_calibration_score("dev") == 0.5
    assert reflector.compute_calibration_score("medical") == 1.0


# ── EchoStore 导出 ──────────────────────────────────────────────


def test_export_to_echo_store():
    """反思记录可导出为 dict 列表."""
    reflector = MetacognitionReflector()
    reflector.reflect_on_decision(
        decision_id="d1", domain="dev", outcome="confirmed", reflection_notes="OK"
    )
    reflector.reflect_on_decision(
        decision_id="d2", domain="dev", outcome="rejected", reflection_notes="Bad"
    )
    exported = reflector.export_to_echo_store()
    assert len(exported) == 2
    assert exported[0]["outcome"] == "confirmed"
    assert exported[0]["reflection_notes"] == "OK"
    assert exported[1]["outcome"] == "rejected"
    assert "reflection_id" in exported[0]
    assert "created_at" in exported[0]


def test_export_to_echo_store_empty():
    """无反思 → 导出空列表."""
    reflector = MetacognitionReflector()
    assert reflector.export_to_echo_store() == []


# ── Mode A/B + Mode C 集成测试（route + reflect 闭环）─────────────


def test_route_then_reflect_closed_loop():
    """Mode A/B + Mode C 集成：route 后 reflect 形成闭环."""
    router = MetacognitionRouter()
    reflector = MetacognitionReflector()

    # 1. Mode A/B 决策（route_confidence）
    result = router.route_confidence(
        domain_reliability=0.9,
        evidence_completeness=0.85,
        self_reported=0.8,
        is_high_risk=False,
    )
    assert result["route"] == "proceed"

    # 2. Mode C 反思（reflect_on_decision）
    reflection = reflector.reflect_on_decision(
        decision_id="decision-001",
        domain="dev",
        outcome="confirmed",
        predicted_confidence=result["action_confidence"],
        actual_success=True,
        actual_quality_score=0.92,
    )
    assert reflection.outcome == "confirmed"
    assert reflection.signal_updates["domain_reliability_delta"] == 0.02

    # 3. 下次决策时使用更新后的 domain_reliability
    adjustment = reflector.compute_reliability_adjustment("dev")
    new_dr = min(1.0, 0.9 + adjustment)
    result2 = router.route_confidence(
        domain_reliability=new_dr,
        evidence_completeness=0.85,
        self_reported=0.8,
        is_high_risk=False,
    )
    # 校准后 confidence 应略增（+0.02 * 0.5 = +0.01）
    assert result2["action_confidence"] >= result["action_confidence"]


def test_route_high_risk_then_reflect_escalate():
    """高风险域 escalate 后反思."""
    router = MetacognitionRouter()
    reflector = MetacognitionReflector()

    # 高风险 + 低 confidence → escalate
    result = router.route_confidence(
        domain_reliability=0.5,
        evidence_completeness=0.5,
        self_reported=0.5,
        is_high_risk=True,
    )
    assert result["route"] == "escalate"
    assert result["action_confidence"] < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD

    # 反思：升级正确
    reflection = reflector.reflect_on_decision(
        decision_id="decision-002",
        domain="medical",
        outcome="escalated",
        predicted_confidence=result["action_confidence"],
        actual_success=False,
    )
    assert reflection.signal_updates["domain_reliability_delta"] == -0.05
