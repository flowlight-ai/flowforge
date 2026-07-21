"""Tests for the Eval self-metabolism layer (task.md P1-5).

Covers:
- Eval Contract five-question (promised vs delivered, missing evidence => fail)
- ThreeSignalAggregator weighted average across the three sources
- ThreeSignalAggregator agreement_score (consistent signals => high agreement)
- AttributionMatrix classification (timeout=>EXECUTION, wrong fact=>KNOWLEDGE,
  missing input=>CONTEXT)
- AttributionMatrix.get_distribution (multi-failure distribution)
- EvalControlPlane coordination (register evaluator + run_evaluations)
- EvalConfigLoader YAML loading
"""

from __future__ import annotations

from pathlib import Path

import pytest

from flowforge.core.errors import EvalError
from flowforge.core.eval.attribution import (
    AttributionMatrix,
    AttributionType,
    FailureDescription,
)
from flowforge.core.eval.contract import EvalContract, EvalContractRunner
from flowforge.core.eval.control_plane import EvalControlPlane, EvalTarget
from flowforge.core.eval.loader import EvalConfig, EvalConfigLoader
from flowforge.core.eval.three_signals import (
    DEFAULT_SIGNAL_WEIGHTS,
    EvalSignal,
    SignalSource,
    ThreeSignalAggregator,
)


# ---------------------------------------------------------------------------
# EvalContract five-question
# ---------------------------------------------------------------------------


def test_contract_passes_when_promised_matches_delivered_with_evidence() -> None:
    contract = EvalContract(
        what_was_promised="ship the feature with tests",
        what_was_delivered="ship the feature with tests",
        what_evidence_exists=["e2e suite passed", "unit tests green"],
        what_quality_bar=0.85,
    )
    verdict = EvalContractRunner().evaluate(contract)
    assert verdict.passed is True
    assert verdict.score >= 0.85
    assert verdict.missing_evidence == []


def test_contract_fails_when_evidence_missing() -> None:
    # Even though promised == delivered, missing evidence forces a fail.
    contract = EvalContract(
        what_was_promised="ship the feature with tests",
        what_was_delivered="ship the feature with tests",
        what_evidence_exists=[],
        what_quality_bar=0.85,
    )
    verdict = EvalContractRunner().evaluate(contract)
    assert verdict.passed is False
    assert verdict.score == 0.0  # evidence_score=0 => geometric mean=0
    assert len(verdict.missing_evidence) == 1


def test_contract_fails_when_delivery_diverges() -> None:
    contract = EvalContract(
        what_was_promised="ship the feature with full test coverage",
        what_was_delivered="completely unrelated artifact text",
        what_evidence_exists=["e2e passed", "unit tests green"],
        what_quality_bar=0.85,
    )
    verdict = EvalContractRunner().evaluate(contract)
    assert verdict.passed is False
    assert verdict.score < 0.85


def test_contract_rejects_invalid_quality_bar() -> None:
    contract = EvalContract(
        what_was_promised="x",
        what_was_delivered="x",
        what_evidence_exists=["e"],
        what_quality_bar=1.5,
    )
    with pytest.raises(EvalError):
        EvalContractRunner().evaluate(contract)


# ---------------------------------------------------------------------------
# ThreeSignalAggregator
# ---------------------------------------------------------------------------


def test_three_signal_weighted_average_uses_source_weights() -> None:
    aggregator = ThreeSignalAggregator()
    aggregator.add_signal(EvalSignal(source=SignalSource.SELF_REPORT, value=0.5))
    aggregator.add_signal(EvalSignal(source=SignalSource.OBSERVER, value=0.8))
    aggregator.add_signal(EvalSignal(source=SignalSource.TELEMETRY, value=0.9))

    result = aggregator.aggregate()
    expected = (
        0.5 * 0.2 + 0.8 * 0.4 + 0.9 * 0.4
    ) / (0.2 + 0.4 + 0.4)

    assert result.signal_count == 3
    assert abs(result.final_score - round(expected, 4)) < 1e-6


def test_three_signal_agreement_high_when_consistent() -> None:
    aggregator = ThreeSignalAggregator()
    aggregator.add_signal(EvalSignal(source=SignalSource.SELF_REPORT, value=0.8))
    aggregator.add_signal(EvalSignal(source=SignalSource.OBSERVER, value=0.8))
    aggregator.add_signal(EvalSignal(source=SignalSource.TELEMETRY, value=0.8))

    result = aggregator.aggregate()
    # All values identical => std=0 => agreement=1.0
    assert result.agreement_score == 1.0
    assert result.disagreement_score == 0.0


def test_three_signal_agreement_low_when_divergent() -> None:
    aggregator = ThreeSignalAggregator()
    aggregator.add_signal(EvalSignal(source=SignalSource.SELF_REPORT, value=0.2))
    aggregator.add_signal(EvalSignal(source=SignalSource.OBSERVER, value=0.8))
    aggregator.add_signal(EvalSignal(source=SignalSource.TELEMETRY, value=0.9))

    result = aggregator.aggregate()
    assert result.agreement_score < 0.8
    assert result.disagreement_score > 0.2


def test_three_signal_explicit_weight_overrides_default() -> None:
    aggregator = ThreeSignalAggregator()
    aggregator.add_signal(
        EvalSignal(source=SignalSource.SELF_REPORT, value=1.0, weight=0.5)
    )
    aggregator.add_signal(
        EvalSignal(source=SignalSource.TELEMETRY, value=0.0, weight=0.5)
    )
    result = aggregator.aggregate()
    # Equal weights on 1.0 and 0.0 => 0.5
    assert abs(result.final_score - 0.5) < 1e-6


def test_three_signal_empty_aggregate() -> None:
    result = ThreeSignalAggregator().aggregate()
    assert result.signal_count == 0
    assert result.final_score == 0.0
    assert result.disagreement_score == 1.0


def test_eval_signal_rejects_out_of_range_value() -> None:
    with pytest.raises(ValueError):
        EvalSignal(source=SignalSource.TELEMETRY, value=1.5)


# ---------------------------------------------------------------------------
# AttributionMatrix
# ---------------------------------------------------------------------------


def test_attribution_classifies_timeout_as_execution() -> None:
    matrix = AttributionMatrix()
    failure = FailureDescription(
        what_failed="the request hit a timeout",
        expected="response within 1s",
        actual="response after 5s",
        context="",
        error_trace="",
    )
    assert matrix.classify(failure) == AttributionType.EXECUTION


def test_attribution_classifies_wrong_fact_as_knowledge() -> None:
    matrix = AttributionMatrix()
    failure = FailureDescription(
        what_failed="the answer contained a wrong fact",
        expected="correct factual answer",
        actual="hallucinated detail",
        context="",
        error_trace="",
    )
    assert matrix.classify(failure) == AttributionType.KNOWLEDGE


def test_attribution_classifies_missing_input_as_context() -> None:
    matrix = AttributionMatrix()
    failure = FailureDescription(
        what_failed="could not proceed due to missing input",
        expected="complete input",
        actual="empty input",
        context="",
        error_trace="",
    )
    assert matrix.classify(failure) == AttributionType.CONTEXT


def test_attribution_falls_back_to_luck() -> None:
    matrix = AttributionMatrix()
    failure = FailureDescription(
        what_failed="unforeseen cosmic ray flipped a bit",
        expected="correct computation",
        actual="random result",
        context="",
        error_trace="",
    )
    assert matrix.classify(failure) == AttributionType.LUCK


def test_attribution_distribution_counts_each_layer() -> None:
    matrix = AttributionMatrix()
    failures = [
        FailureDescription(what_failed="timeout", expected="", actual="", context=""),
        FailureDescription(what_failed="timeout", expected="", actual="", context=""),
        FailureDescription(what_failed="wrong fact", expected="", actual="", context=""),
        FailureDescription(what_failed="missing input", expected="", actual="", context=""),
    ]
    dist = matrix.get_distribution(failures)
    assert dist[AttributionType.EXECUTION] == 2
    assert dist[AttributionType.KNOWLEDGE] == 1
    assert dist[AttributionType.CONTEXT] == 1
    assert sum(dist.values()) == 4


def test_attribution_custom_rules_override_defaults() -> None:
    from flowforge.core.eval.attribution import AttributionRule

    matrix = AttributionMatrix(
        rules=[
            AttributionRule(keywords=["flaky"], type=AttributionType.LUCK),
        ]
    )
    failure = FailureDescription(
        what_failed="timeout but we only care about flaky",
        expected="",
        actual="",
        context="",
        error_trace="",
    )
    # Custom rule wins over default EXECUTION because defaults are replaced.
    assert matrix.classify(failure) == AttributionType.LUCK


# ---------------------------------------------------------------------------
# EvalControlPlane coordination
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_control_plane_coordinates_evaluators_on_pass() -> None:
    plane = EvalControlPlane()

    def telemetry_eval(target: EvalTarget) -> EvalSignal:
        return EvalSignal(
            source=SignalSource.TELEMETRY, value=0.95, notes="metrics healthy"
        )

    plane.register_evaluator("telemetry", telemetry_eval)

    target = EvalTarget(
        target_id="t-pass-001",
        target_type="artifact",
        artifact="ship the feature with tests",
        context={
            "promised": "ship the feature with tests",
            "evidence": ["e2e passed", "unit tests green"],
            "quality_bar": 0.85,
        },
    )
    report = await plane.run_evaluations(target)

    assert report.target_id == "t-pass-001"
    assert report.contract_verdict.passed is True
    assert report.signals.signal_count == 1
    assert report.attribution is None  # pass => no attribution
    assert 0.0 <= report.overall_score <= 1.0
    assert any("no action needed" in r for r in report.recommendations)


@pytest.mark.asyncio
async def test_control_plane_attributes_on_failure() -> None:
    plane = EvalControlPlane()
    target = EvalTarget(
        target_id="t-fail-001",
        target_type="deployment",
        artifact="partial deploy with timeout",
        context={
            "promised": "full deployment completed",
            "evidence": [],  # missing evidence => fail
            "note": "timeout during rollout",
        },
    )
    report = await plane.run_evaluations(target)

    assert report.contract_verdict.passed is False
    assert report.attribution is not None
    assert report.attribution == AttributionType.EXECUTION
    assert any("evidence" in r for r in report.recommendations)


@pytest.mark.asyncio
async def test_control_plane_supports_async_evaluator_and_signal_lists() -> None:
    plane = EvalControlPlane()

    async def observer_eval(target: EvalTarget) -> list[EvalSignal]:
        return [
            EvalSignal(source=SignalSource.OBSERVER, value=0.9),
            EvalSignal(source=SignalSource.SELF_REPORT, value=0.7),
        ]

    plane.register_evaluator("observer", observer_eval)

    target = EvalTarget(
        target_id="t-async-001",
        target_type="artifact",
        artifact="deliver the report",
        context={
            "promised": "deliver the report",
            "evidence": ["reviewer signed off", "lint clean"],
        },
    )
    report = await plane.run_evaluations(target)
    assert report.signals.signal_count == 2


@pytest.mark.asyncio
async def test_control_plane_rejects_duplicate_evaluator_name() -> None:
    plane = EvalControlPlane()
    plane.register_evaluator("one", lambda t: None)
    with pytest.raises(EvalError):
        plane.register_evaluator("one", lambda t: None)


# ---------------------------------------------------------------------------
# EvalConfigLoader
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_config_loader_loads_yaml(tmp_path: Path) -> None:
    yaml_content = """
default_quality_bar: 0.9
signal_weights:
  self_report: 0.2
  observer: 0.4
  telemetry: 0.4
attribution_rules:
  - keywords: ["timeout", "deadline"]
    type: execution
  - keywords: ["wrong", "incorrect", "hallucination"]
    type: knowledge
"""
    config_file = tmp_path / "eval.yaml"
    config_file.write_text(yaml_content, encoding="utf-8")

    config = await EvalConfigLoader().load_from_yaml(config_file)

    assert isinstance(config, EvalConfig)
    assert config.default_quality_bar == 0.9
    assert config.signal_weights[SignalSource.OBSERVER] == 0.4
    assert config.signal_weights[SignalSource.TELEMETRY] == 0.4
    assert len(config.attribution_rules) == 2
    assert config.attribution_rules[0].type == AttributionType.EXECUTION
    assert config.attribution_rules[1].type == AttributionType.KNOWLEDGE
    assert config.attribution_rules[0].keywords == ["timeout", "deadline"]


@pytest.mark.asyncio
async def test_config_loader_missing_file_raises(tmp_path: Path) -> None:
    missing = tmp_path / "does_not_exist.yaml"
    with pytest.raises(EvalError):
        await EvalConfigLoader().load_from_yaml(missing)


@pytest.mark.asyncio
async def test_config_loader_invalid_root_raises(tmp_path: Path) -> None:
    config_file = tmp_path / "bad.yaml"
    config_file.write_text("- just\n- a\n- list\n", encoding="utf-8")
    with pytest.raises(EvalError):
        await EvalConfigLoader().load_from_yaml(config_file)


@pytest.mark.asyncio
async def test_config_loader_unknown_attribution_type_raises(tmp_path: Path) -> None:
    yaml_content = """
attribution_rules:
  - keywords: ["x"]
    type: not_a_real_type
"""
    config_file = tmp_path / "bad_type.yaml"
    config_file.write_text(yaml_content, encoding="utf-8")
    with pytest.raises(EvalError):
        await EvalConfigLoader().load_from_yaml(config_file)


def test_default_signal_weights_match_spec() -> None:
    assert DEFAULT_SIGNAL_WEIGHTS[SignalSource.SELF_REPORT] == 0.2
    assert DEFAULT_SIGNAL_WEIGHTS[SignalSource.OBSERVER] == 0.4
    assert DEFAULT_SIGNAL_WEIGHTS[SignalSource.TELEMETRY] == 0.4
