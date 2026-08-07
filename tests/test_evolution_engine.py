"""Tests for the ForgeMindEngine — closed-loop evaluate + execute."""

from __future__ import annotations

import pytest

from flowforge.evolution.engine import EvolutionContext, ForgeMindEngine


@pytest.fixture
def engine() -> ForgeMindEngine:
    return ForgeMindEngine(scope_baseline="test scope")


@pytest.mark.asyncio
async def test_no_trigger_returns_none_mode(engine: ForgeMindEngine) -> None:
    ctx = EvolutionContext(
        instruction="proceed",
        action_description="normal action",
        scope_baseline="test scope",
    )
    decision = await engine.evaluate(ctx)
    assert decision.mode == "none"
    assert decision.metacognition_route in {"proceed", "structured_analysis_only"}


@pytest.mark.asyncio
async def test_magic_word_triggers_mode_a(engine: ForgeMindEngine) -> None:
    ctx = EvolutionContext(
        instruction="请你按第一性原理重新考虑",
        action_description="planning",
        scope_baseline="test scope",
    )
    decision = await engine.evaluate(ctx)
    assert decision.mode == "A_scope_guard"
    assert decision.scope_signal is not None
    assert decision.scope_signal.severity == "block"


@pytest.mark.asyncio
async def test_repeated_error_triggers_mode_b(engine: ForgeMindEngine) -> None:
    ctx = EvolutionContext(
        instruction="proceed",
        action_description="normal",
        scope_baseline="test scope",
        error_history=[{"err": "x"}, {"err": "x"}],
    )
    decision = await engine.evaluate(ctx)
    assert decision.mode == "B_process_evolution"


@pytest.mark.asyncio
async def test_knowledge_signal_triggers_mode_c(engine: ForgeMindEngine) -> None:
    ctx = EvolutionContext(
        instruction="proceed",
        action_description="deep research",
        scope_baseline="test scope",
        knowledge_signal={
            "reusability": True,
            "non_obviousness": True,
            "decay_risk": True,
        },
    )
    decision = await engine.evaluate(ctx)
    assert decision.mode == "C_knowledge_evolution"
    assert decision.distill_decision is True


@pytest.mark.asyncio
async def test_execute_records_history(engine: ForgeMindEngine) -> None:
    ctx = EvolutionContext(
        instruction="proceed",
        action_description="normal",
        scope_baseline="test scope",
        knowledge_signal={
            "reusability": True,
            "non_obviousness": True,
            "decay_risk": True,
        },
    )
    decision = await engine.evaluate(ctx)
    record = await engine.execute(decision)
    assert record["decision_id"] == decision.decision_id
    assert len(record["actions"]) >= 1
    history = engine.get_execution_history()
    assert any(h["decision_id"] == decision.decision_id for h in history)


@pytest.mark.asyncio
async def test_high_risk_uses_wilson_lower_bound(engine: ForgeMindEngine) -> None:
    ctx = EvolutionContext(
        instruction="proceed",
        action_description="risky surgery",
        scope_baseline="test scope",
        is_high_risk=True,
        domain_stats={"successes": 1, "trials": 5},  # 20% success rate
        evidence_completeness=0.5,
        self_reported_confidence=0.95,
    )
    decision = await engine.evaluate(ctx)
    # With Wilson lower bound on 1/5 successes, action_confidence should be low
    assert decision.action_confidence < 0.85
    assert decision.metacognition_route == "escalate"
