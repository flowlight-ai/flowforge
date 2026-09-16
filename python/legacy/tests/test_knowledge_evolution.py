"""Tests for Mode C — Knowledge Evolution."""

from __future__ import annotations

import pytest

from flowforge.evolution.knowledge_evolution import KnowledgeEvolution


@pytest.fixture
def ke() -> KnowledgeEvolution:
    return KnowledgeEvolution()


def test_should_distill_needs_two_of_three(ke: KnowledgeEvolution) -> None:
    assert ke.should_distill(True, True, True) is True
    assert ke.should_distill(True, True, False) is True
    assert ke.should_distill(True, False, True) is True
    assert ke.should_distill(False, True, True) is True
    assert ke.should_distill(True, False, False) is False
    assert ke.should_distill(False, False, False) is False


def test_create_episode_card_validates_direction(ke: KnowledgeEvolution) -> None:
    with pytest.raises(ValueError, match="Invalid distillation_direction"):
        ke.create_episode_card(
            task_snapshot="snap",
            evidence_map={},
            decision_timeline=[],
            collaboration_pivots=[],
            transferable_method="m",
            non_transferable_facts="nf",
            safety_boundary="sb",
            distillation_direction="bogus",
        )


def test_distill_episode_produces_method_card(ke: KnowledgeEvolution) -> None:
    episode = ke.create_episode_card(
        task_snapshot="snap",
        evidence_map={},
        decision_timeline=[],
        collaboration_pivots=[],
        transferable_method="some reusable method",
        non_transferable_facts="nf",
        safety_boundary="sb",
        distillation_direction="method_card",
    )
    result = ke.distill_episode(episode.episode_id)
    assert hasattr(result, "method_id")
    assert result.content == "some reusable method"
    assert result.maturity_level == "L2"


def test_distill_episode_returns_direction_for_non_method(ke: KnowledgeEvolution) -> None:
    episode = ke.create_episode_card(
        task_snapshot="snap",
        evidence_map={},
        decision_timeline=[],
        collaboration_pivots=[],
        transferable_method="m",
        non_transferable_facts="nf",
        safety_boundary="sb",
        distillation_direction="skill_draft",
    )
    result = ke.distill_episode(episode.episode_id)
    assert result == "skill_draft"


def test_distill_unknown_episode_raises(ke: KnowledgeEvolution) -> None:
    with pytest.raises(ValueError, match="not found"):
        ke.distill_episode("bogus-id")


def test_create_eval_ledger_validates_required_fields(ke: KnowledgeEvolution) -> None:
    with pytest.raises(ValueError, match="cases must not be empty"):
        ke.create_eval_ledger("mc-x", [])

    with pytest.raises(ValueError, match="missing required fields"):
        ke.create_eval_ledger("mc-x", [{"case_id": "c1"}])  # missing category + passed


def _make_cases(n: int, passed_count: int, categories: list[str] | None = None) -> list[dict]:
    cats = categories or ["standard_success"]
    cases = []
    for i in range(n):
        cases.append(
            {
                "case_id": f"c{i}",
                "category": cats[i % len(cats)],
                "passed": i < passed_count,
            }
        )
    return cases


def test_smoke_gate_passes_with_2_of_3(ke: KnowledgeEvolution) -> None:
    ledger = ke.create_eval_ledger("mc-x", _make_cases(3, 2))
    assert ke.check_smoke_gate(ledger.eval_id) is True
    assert ledger.smoke_gate_passed is True


def test_smoke_gate_fails_with_insufficient_cases(ke: KnowledgeEvolution) -> None:
    ledger = ke.create_eval_ledger("mc-x", _make_cases(2, 2))
    assert ke.check_smoke_gate(ledger.eval_id) is False


def test_promotion_gate_passes_with_3_of_5_and_3_categories(ke: KnowledgeEvolution) -> None:
    cases = _make_cases(5, 3, categories=["standard_success", "edge_should_escalate", "conflict_counterexample"])
    ledger = ke.create_eval_ledger("mc-x", cases)
    assert ke.check_promotion_gate(ledger.eval_id) is True


def test_promotion_gate_fails_with_insufficient_categories(ke: KnowledgeEvolution) -> None:
    cases = _make_cases(5, 5, categories=["only_one_category"])
    ledger = ke.create_eval_ledger("mc-x", cases)
    assert ke.check_promotion_gate(ledger.eval_id) is False


def test_promotion_gate_fails_with_low_pass_count(ke: KnowledgeEvolution) -> None:
    cases = _make_cases(5, 2, categories=["a", "b", "c"])
    ledger = ke.create_eval_ledger("mc-x", cases)
    assert ke.check_promotion_gate(ledger.eval_id) is False


def test_get_methods_returns_distilled(ke: KnowledgeEvolution) -> None:
    assert ke.get_methods() == []
    episode = ke.create_episode_card(
        task_snapshot="snap",
        evidence_map={},
        decision_timeline=[],
        collaboration_pivots=[],
        transferable_method="m",
        non_transferable_facts="nf",
        safety_boundary="sb",
    )
    ke.distill_episode(episode.episode_id)
    assert len(ke.get_methods()) == 1
