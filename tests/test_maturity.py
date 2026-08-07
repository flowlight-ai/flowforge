"""Tests for the five-level Knowledge Maturity Ladder."""

from __future__ import annotations

from flowforge.evolution.maturity import KnowledgeMaturityLadder
from flowforge.evolution.models import KnowledgeMaturityLevel


def test_l0_to_l1_promotion_with_enough_episodes() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L0_EPISODE,
        usage_data={
            "episodes_count": 3,
            "episode_window_days": 30,
            "five_q_score": 8,
        },
    )
    assert new_level == KnowledgeMaturityLevel.L1_PATTERN


def test_l0_to_l1_blocked_by_one_off() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L0_EPISODE,
        usage_data={
            "episodes_count": 3,
            "episode_window_days": 30,
            "five_q_score": 8,
            "is_one_off": True,
        },
    )
    assert new_level is None


def test_l0_to_l1_via_human_request() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L0_EPISODE,
        usage_data={"human_requested": True},
    )
    assert new_level == KnowledgeMaturityLevel.L1_PATTERN


def test_l1_to_l2_promotion_with_full_gates() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L1_PATTERN,
        usage_data={
            "smoke_cases": 3,
            "smoke_passed": 2,
            "promotion_cases": 5,
            "promotion_passed": 3,
            "promotion_categories": 3,
        },
    )
    assert new_level == KnowledgeMaturityLevel.L2_DRAFT


def test_l1_to_l2_blocked_by_missing_smoke() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L1_PATTERN,
        usage_data={
            "smoke_cases": 2,
            "smoke_passed": 2,
            "promotion_cases": 5,
            "promotion_passed": 3,
            "promotion_categories": 3,
        },
    )
    assert new_level is None


def test_l2_to_l3_promotion() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L2_DRAFT,
        usage_data={
            "uses_count": 7,
            "agents_count": 3,
            "success_rate": 0.85,
            "has_critical_breach": False,
        },
    )
    assert new_level == KnowledgeMaturityLevel.L3_VALIDATED


def test_l2_to_l3_blocked_by_critical_breach() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L2_DRAFT,
        usage_data={
            "uses_count": 7,
            "agents_count": 3,
            "success_rate": 0.85,
            "has_critical_breach": True,
        },
    )
    assert new_level is None


def test_l3_to_l4_promotion() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L3_VALIDATED,
        usage_data={
            "uses_count": 15,
            "recent_success_count": 9,
            "recent_total": 10,
            "user_approved": True,
            "long_tail": False,
        },
    )
    assert new_level == KnowledgeMaturityLevel.L4_STANDARD


def test_l3_to_l4_blocked_by_long_tail() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L3_VALIDATED,
        usage_data={
            "uses_count": 15,
            "recent_success_count": 9,
            "recent_total": 10,
            "user_approved": True,
            "long_tail": True,
        },
    )
    assert new_level is None


def test_l4_at_top_no_promotion() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_promotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L4_STANDARD,
        usage_data={},
    )
    assert new_level is None


def test_l2_demotion_on_low_recent_performance() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_demotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L2_DRAFT,
        recent_performance=[True, False, False],  # 33% < 50%
    )
    assert new_level == KnowledgeMaturityLevel.L1_PATTERN


def test_l2_no_demotion_when_window_too_small() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_demotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L2_DRAFT,
        recent_performance=[False, False],  # only 2 entries, need 3
    )
    assert new_level is None


def test_l3_demotion_on_low_recent_performance() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_demotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L3_VALIDATED,
        recent_performance=[True, False, False, False, False],  # 20% < 60%
    )
    assert new_level == KnowledgeMaturityLevel.L2_DRAFT


def test_l0_no_demotion() -> None:
    ladder = KnowledgeMaturityLadder()
    new_level = ladder.check_demotion(
        knowledge_id="k1",
        current_level=KnowledgeMaturityLevel.L0_EPISODE,
        recent_performance=[False, False, False],
    )
    assert new_level is None


def test_l4_freeze_on_high_risk_breach() -> None:
    ladder = KnowledgeMaturityLadder()
    assert ladder.check_freeze("k1", KnowledgeMaturityLevel.L4_STANDARD, True) is True


def test_l4_no_freeze_without_breach() -> None:
    ladder = KnowledgeMaturityLadder()
    assert ladder.check_freeze("k1", KnowledgeMaturityLevel.L4_STANDARD, False) is False


def test_freeze_only_applies_to_l4() -> None:
    ladder = KnowledgeMaturityLadder()
    for level in (
        KnowledgeMaturityLevel.L0_EPISODE,
        KnowledgeMaturityLevel.L1_PATTERN,
        KnowledgeMaturityLevel.L2_DRAFT,
        KnowledgeMaturityLevel.L3_VALIDATED,
    ):
        assert ladder.check_freeze("k1", level, True) is False
