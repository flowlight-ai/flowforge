"""Tests for the Metacognition Router."""

from __future__ import annotations

import pytest

from flowforge.evolution.metacognition import (
    HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD,
    MetacognitionRouter,
)


@pytest.fixture
def router() -> MetacognitionRouter:
    return MetacognitionRouter()


def test_laplace_smoothing_basic(router: MetacognitionRouter) -> None:
    # (0+1)/(0+2) = 0.5
    assert router.compute_domain_reliability(0, 0) == pytest.approx(0.5)
    # (5+1)/(5+2) = 6/7
    assert router.compute_domain_reliability(5, 5) == pytest.approx(6 / 7)


def test_laplace_rejects_invalid_inputs(router: MetacognitionRouter) -> None:
    with pytest.raises(ValueError):
        router.compute_domain_reliability(-1, 5)
    with pytest.raises(ValueError):
        router.compute_domain_reliability(6, 5)  # successes > trials
    with pytest.raises(ValueError):
        router.compute_domain_reliability(0, -1)


def test_wilson_lower_bound_zero_trials(router: MetacognitionRouter) -> None:
    assert router.compute_wilson_lower_bound(0, 0) == 0.0


def test_wilson_lower_bound_low_success_is_low(router: MetacognitionRouter) -> None:
    # 1 success out of 5 → lower bound should be much lower than 0.2
    lb = router.compute_wilson_lower_bound(1, 5)
    assert 0.0 <= lb < 0.2


def test_wilson_lower_bound_all_success_is_high(router: MetacognitionRouter) -> None:
    lb = router.compute_wilson_lower_bound(10, 10)
    assert lb > 0.5


def test_wilson_lower_bound_rejects_invalid(router: MetacognitionRouter) -> None:
    with pytest.raises(ValueError):
        router.compute_wilson_lower_bound(-1, 5)
    with pytest.raises(ValueError):
        router.compute_wilson_lower_bound(6, 5)
    with pytest.raises(ValueError):
        router.compute_wilson_lower_bound(0, 5, z=0)


def test_route_proceed_when_all_signals_high(router: MetacognitionRouter) -> None:
    result = router.route_confidence(
        domain_reliability=0.95,
        evidence_completeness=0.95,
        self_reported=0.95,
    )
    assert result["route"] == "proceed"
    assert result["action_confidence"] >= HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD


def test_route_structured_when_low_confidence(router: MetacognitionRouter) -> None:
    result = router.route_confidence(
        domain_reliability=0.3,
        evidence_completeness=0.3,
        self_reported=0.3,
    )
    assert result["route"] == "structured_analysis_only"
    assert result["action_confidence"] < HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD


def test_route_escalate_in_high_risk_with_low_confidence(router: MetacognitionRouter) -> None:
    result = router.route_confidence(
        domain_reliability=0.3,
        evidence_completeness=0.3,
        self_reported=0.95,  # high self-report ignored in high-risk
        is_high_risk=True,
    )
    assert result["route"] == "escalate"
    assert result["signals"]["is_high_risk"] is True


def test_route_proceed_in_high_risk_with_high_confidence(router: MetacognitionRouter) -> None:
    result = router.route_confidence(
        domain_reliability=0.95,
        evidence_completeness=0.95,
        self_reported=0.5,
        is_high_risk=True,
    )
    assert result["route"] == "proceed"


def test_self_reported_weight_zero_in_high_risk(router: MetacognitionRouter) -> None:
    """In high-risk mode, self-reported weight should be 0."""
    high = router.route_confidence(
        domain_reliability=0.7,
        evidence_completeness=0.7,
        self_reported=0.0,
        is_high_risk=True,
    )
    high_sr = router.route_confidence(
        domain_reliability=0.7,
        evidence_completeness=0.7,
        self_reported=1.0,
        is_high_risk=True,
    )
    # In high-risk mode self_reported weight is 0, so action_confidence should match
    assert high["action_confidence"] == high_sr["action_confidence"]


def test_signals_clamped_to_unit_interval(router: MetacognitionRouter) -> None:
    result = router.route_confidence(
        domain_reliability=1.5,
        evidence_completeness=-0.5,
        self_reported=2.0,
    )
    assert result["signals"]["domain_reliability"] == 1.0
    assert result["signals"]["evidence_completeness"] == 0.0
    assert result["signals"]["self_reported_confidence"] == 1.0
