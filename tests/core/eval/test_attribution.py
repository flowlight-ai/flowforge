"""Tests for the Eval self-metabolism layer (task.md P1-5).

Covers:
- Eval Contract five-questions model + ContractRegistry
- ThreeSignalCrossValidator: signal collection + cross-validation
  (three-way consensus, majority, disagreement escalation)
- Attributor: seven-category failure attribution (roleagent.md §5.4)
- AttributionReport structure + confidence

No LLM is involved — these are pure rule/data-structure tests.
"""

from __future__ import annotations

import pytest

from flowforge.core.eval.attribution import (
    AttributionCategory,
    AttributionReport,
    Attributor,
)
from flowforge.core.eval.contract import (
    ContractRegistry,
    EvalContract,
    EvalMaturity,
    EvaluationTarget,
    EvaluationTiming,
    EvaluatorType,
    FiveQuestions,
    PostEvaluationAction,
)
from flowforge.core.eval.three_signals import (
    Signal,
    SignalType,
    ThreeSignalCrossValidator,
)

# ---------------------------------------------------------------------------
# Eval Contract five-questions
# ---------------------------------------------------------------------------


def test_five_questions_accepts_recommended_values() -> None:
    fq = FiveQuestions(
        who_evaluates=EvaluatorType.CROSS_AGENT.value,
        what_to_evaluate=EvaluationTarget.FUNCTIONAL_CORRECTNESS.value,
        when_to_evaluate=EvaluationTiming.PER_TASK.value,
        evaluation_signals=["trace", "three_signal_cross"],
        post_evaluation_action=PostEvaluationAction.PASS.value,
    )
    assert fq.who_evaluates == EvaluatorType.CROSS_AGENT.value
    assert fq.evaluation_signals == ["trace", "three_signal_cross"]


def test_five_questions_accepts_free_text() -> None:
    fq = FiveQuestions(
        who_evaluates="custom-evaluator",
        what_to_evaluate="domain-specific-check",
        when_to_evaluate="per_merge",
        evaluation_signals=[],
        post_evaluation_action="rework",
    )
    assert fq.what_to_evaluate == "domain-specific-check"


def test_five_questions_requires_core_fields() -> None:
    with pytest.raises(ValueError):
        FiveQuestions()  # all four required fields missing


def test_eval_contract_defaults_to_experimental_maturity() -> None:
    contract = EvalContract(
        contract_id="contract-1",
        component_ref="teamact.loop",
        five_questions=FiveQuestions(
            who_evaluates=EvaluatorType.SELF.value,
            what_to_evaluate=EvaluationTarget.COLLABORATION_CONTRIBUTION.value,
            when_to_evaluate=EvaluationTiming.PER_TASK.value,
            post_evaluation_action=PostEvaluationAction.PASS.value,
        ),
    )
    assert contract.maturity is EvalMaturity.EXPERIMENTAL
    assert contract.created_at
    assert contract.updated_at


def test_eval_contract_to_summary() -> None:
    contract = EvalContract(
        contract_id="contract-1",
        component_ref="teamact.loop",
        five_questions=FiveQuestions(
            who_evaluates=EvaluatorType.CROSS_AGENT.value,
            what_to_evaluate=EvaluationTarget.VISION_ALIGNMENT.value,
            when_to_evaluate=EvaluationTiming.WEEKLY.value,
            evaluation_signals=["human"],
            post_evaluation_action=PostEvaluationAction.ESCALATE_OPERATOR.value,
        ),
    )
    summary = contract.to_summary()
    assert "contract-1" in summary
    assert "teamact.loop" in summary
    assert "weekly" in summary


# ---------------------------------------------------------------------------
# ContractRegistry
# ---------------------------------------------------------------------------


def _make_contract(component_ref: str = "teamact.loop") -> EvalContract:
    return EvalContract(
        contract_id=f"contract-{component_ref}",
        component_ref=component_ref,
        five_questions=FiveQuestions(
            who_evaluates=EvaluatorType.SELF.value,
            what_to_evaluate=EvaluationTarget.FUNCTIONAL_CORRECTNESS.value,
            when_to_evaluate=EvaluationTiming.PER_CALL.value,
            post_evaluation_action=PostEvaluationAction.PASS.value,
        ),
    )


@pytest.mark.asyncio
async def test_registry_register_and_get() -> None:
    registry = ContractRegistry()
    contract = _make_contract()
    await registry.register(contract)
    fetched = await registry.get("teamact.loop")
    assert fetched is contract


@pytest.mark.asyncio
async def test_registry_get_unknown_returns_none() -> None:
    registry = ContractRegistry()
    assert await registry.get("nope") is None


@pytest.mark.asyncio
async def test_registry_overwrite_on_same_component() -> None:
    registry = ContractRegistry()
    await registry.register(_make_contract())
    contract2 = _make_contract(component_ref="teamact.loop")
    await registry.register(contract2)
    fetched = await registry.get("teamact.loop")
    assert fetched is contract2


@pytest.mark.asyncio
async def test_registry_list_and_all() -> None:
    registry = ContractRegistry()
    await registry.register(_make_contract())
    await registry.register(_make_contract(component_ref="tool.mediation"))
    assert set(await registry.list_components()) == {
        "teamact.loop",
        "tool.mediation",
    }
    assert len(await registry.all_contracts()) == 2


# ---------------------------------------------------------------------------
# ThreeSignalCrossValidator — collection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_collect_trace_signal() -> None:
    validator = ThreeSignalCrossValidator()
    signal = await validator.collect_trace_signal(
        {"source": "trace_collector", "verdict": "pass", "confidence": 0.9}
    )
    assert signal.signal_type is SignalType.TRACE
    assert signal.confidence == pytest.approx(0.9)


@pytest.mark.asyncio
async def test_collect_human_signal() -> None:
    validator = ThreeSignalCrossValidator()
    signal = await validator.collect_human_signal(
        {"source": "user_feedback", "rating": 2, "verdict": "fail"}
    )
    assert signal.signal_type is SignalType.HUMAN
    assert signal.confidence == 0.5  # default


@pytest.mark.asyncio
async def test_collect_auto_signal() -> None:
    validator = ThreeSignalCrossValidator()
    signal = await validator.collect_auto_signal(
        {"source": "benchmark_probe", "metric": "accuracy", "value": 0.92}
    )
    assert signal.signal_type is SignalType.AUTO
    assert signal.content["metric"] == "accuracy"


# ---------------------------------------------------------------------------
# ThreeSignalCrossValidator — cross-validation
# ---------------------------------------------------------------------------


def _signal(signal_type: SignalType, verdict: str, confidence: float = 0.8) -> Signal:
    return Signal(
        signal_type=signal_type,
        source=f"{signal_type.value}_source",
        content={"verdict": verdict},
        confidence=confidence,
    )


@pytest.mark.asyncio
async def test_cross_validate_three_way_consensus() -> None:
    validator = ThreeSignalCrossValidator()
    result = await validator.cross_validate(
        [
            _signal(SignalType.TRACE, "pass"),
            _signal(SignalType.HUMAN, "pass"),
            _signal(SignalType.AUTO, "pass"),
        ]
    )
    assert result.consensus is True
    assert result.consensus_value == "pass"
    assert result.recommendation == "proceed"
    assert result.signal_count == 3


@pytest.mark.asyncio
async def test_cross_validate_majority_with_disagreement() -> None:
    validator = ThreeSignalCrossValidator()
    result = await validator.cross_validate(
        [
            _signal(SignalType.TRACE, "pass"),
            _signal(SignalType.HUMAN, "pass"),
            _signal(SignalType.AUTO, "fail"),
        ]
    )
    assert result.consensus is True
    assert result.consensus_value == "pass"
    assert result.recommendation == "proceed_with_caution"
    assert len(result.disagreements) == 1


@pytest.mark.asyncio
async def test_cross_validate_fail_majority_escalates() -> None:
    validator = ThreeSignalCrossValidator()
    result = await validator.cross_validate(
        [
            _signal(SignalType.TRACE, "fail"),
            _signal(SignalType.HUMAN, "fail"),
            _signal(SignalType.AUTO, "pass"),
        ]
    )
    assert result.consensus is True
    assert result.consensus_value == "fail"
    assert result.recommendation == "escalate_operator"


@pytest.mark.asyncio
async def test_cross_validate_two_way_tie_escalates() -> None:
    validator = ThreeSignalCrossValidator()
    result = await validator.cross_validate(
        [
            _signal(SignalType.TRACE, "pass", confidence=0.9),
            _signal(SignalType.HUMAN, "fail", confidence=0.9),
        ]
    )
    assert result.consensus is False
    assert result.consensus_value is None
    assert result.recommendation == "escalate_operator"


@pytest.mark.asyncio
async def test_cross_validate_empty_signals() -> None:
    validator = ThreeSignalCrossValidator()
    result = await validator.cross_validate([])
    assert result.consensus is False
    assert result.signal_count == 0
    assert result.recommendation == "escalate_operator"


@pytest.mark.asyncio
async def test_cross_validate_single_signal_no_consensus() -> None:
    validator = ThreeSignalCrossValidator()
    result = await validator.cross_validate([_signal(SignalType.TRACE, "pass")])
    assert result.consensus is False
    assert result.recommendation == "escalate_operator"


@pytest.mark.asyncio
async def test_cross_validate_score_based_verdict() -> None:
    validator = ThreeSignalCrossValidator()
    high = Signal(
        signal_type=SignalType.AUTO,
        source="probe",
        content={"score": 0.95},
    )
    low = Signal(
        signal_type=SignalType.AUTO,
        source="probe",
        content={"score": 0.3},
    )
    result = await validator.cross_validate([high, low])
    # 1 pass 1 fail → tie → no consensus
    assert result.consensus is False


# ---------------------------------------------------------------------------
# Attributor — seven-category attribution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_attribute_timeout_as_resource_exhaustion() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {
            "failure_id": "fail-001",
            "error_message": "the request hit a timeout",
            "trace": "response after 5s",
        }
    )
    assert isinstance(report, AttributionReport)
    assert report.category is AttributionCategory.RESOURCE_EXHAUSTION
    assert report.failure_id == "fail-001"


@pytest.mark.asyncio
async def test_attribute_hallucination_as_model_blind_spot() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {
            "error_message": "the answer contained a hallucinated detail",
            "context": "model reasoning failure observed",
        }
    )
    assert report.category is AttributionCategory.MODEL_BLIND_SPOT
    assert report.recommendation
    assert report.root_cause


@pytest.mark.asyncio
async def test_attribute_missing_data_as_data_missing() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {
            "error_message": "no data available, retrieval fail",
            "context": "memory empty",
        }
    )
    assert report.category is AttributionCategory.DATA_MISSING


@pytest.mark.asyncio
async def test_attribute_handoff_as_collaboration_failure() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {
            "error_message": "handoff capsule missing, teamact loop broken",
        }
    )
    assert report.category is AttributionCategory.COLLABORATION_FAILURE


@pytest.mark.asyncio
async def test_attribute_unknown_falls_back_to_harness() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {"error_message": "something completely unexpected happened"}
    )
    # No keyword matched → default to HARNESS_MISALIGNMENT
    assert report.category is AttributionCategory.HARNESS_MISALIGNMENT


@pytest.mark.asyncio
async def test_attribute_category_hint_weights_selection() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {
            "error_message": "an ambiguous failure with mixed signals",
            "category_hint": "tool_gap",
        }
    )
    assert report.category is AttributionCategory.TOOL_GAP
    assert "(category_hint)" in report.evidence


@pytest.mark.asyncio
async def test_attribute_confidence_based_on_evidence_count() -> None:
    attributor = Attributor()
    report = await attributor.attribute(
        {"error_message": "timeout quota exceeded token limit"}
    )
    assert report.confidence > 0.3
    assert 0.0 <= report.confidence <= 1.0


@pytest.mark.asyncio
async def test_attribute_report_serializable() -> None:
    attributor = Attributor()
    report = await attributor.attribute({"error_message": "timeout"})
    data = report.model_dump(mode="json")
    assert "category" in data
    assert "recommendation" in data
    assert data["category"] == AttributionCategory.RESOURCE_EXHAUSTION.value


@pytest.mark.asyncio
async def test_custom_rules_override_defaults() -> None:
    rules = {
        AttributionCategory.TOOL_GAP: ["flaky"],
    }
    attributor = Attributor(rules=rules)
    report = await attributor.attribute({"error_message": "timeout but flaky test"})
    # With custom rules, "flaky" is the only keyword → TOOL_GAP
    assert report.category is AttributionCategory.TOOL_GAP


def test_attribution_categories_are_seven() -> None:
    assert len(list(AttributionCategory)) == 7
    assert set(AttributionCategory.__members__) == {
        "HARNESS_MISALIGNMENT",
        "TOOL_GAP",
        "MODEL_BLIND_SPOT",
        "DATA_MISSING",
        "VISION_GAP",
        "COLLABORATION_FAILURE",
        "RESOURCE_EXHAUSTION",
    }
