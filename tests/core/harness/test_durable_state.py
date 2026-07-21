"""Tests for the Harness seven-layer guardrail (roleagent.md Ch.7).

Covers all seven layers in one module per task.md P1-3:
- DurableStateSurface snapshot/restore round-trip
- ToolMediator allowlist enforcement (authorized caller passes, unauthorized raises)
- EvidenceCollector record/verify/cross-check
- GovernanceBoundary rule violation detection (forbidden action triggers violation)
- MagicWordsRegistry bilingual detection (中文"停止" + 英文"halt")
- EntropyController TTL expiry cleanup
- HarnessabilityScorer score + grade (1.0 -> A, 0.5 -> C or D)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from flowforge.core.errors import HarnessError, ToolAllowlistViolation
from flowforge.core.harness import (
    DEFAULT_MAGIC_WORDS,
    DurableStateSurface,
    EntropyController,
    EvidenceCollector,
    GovernanceBoundary,
    HarnessabilityFactors,
    HarnessabilityScorer,
    MagicWordAction,
    MagicWordsRegistry,
    ToolMediator,
)


# ---------------------------------------------------------------------------
# Layer 1 — DurableStateSurface
# ---------------------------------------------------------------------------


def test_durable_state_snapshot_restore_roundtrip() -> None:
    surface = DurableStateSurface()
    state = {"step": 3, "items": ["a", "b"], "nested": {"k": 1}}
    snapshot_id = surface.snapshot(state)

    assert isinstance(snapshot_id, str)
    assert snapshot_id in surface.list_snapshots()

    restored = surface.restore(snapshot_id)
    assert restored == state
    # Mutating the restored copy must not corrupt the stored snapshot.
    restored["step"] = 999
    restored["items"].append("c")
    again = surface.restore(snapshot_id)
    assert again == state


def test_durable_state_restore_unknown_raises() -> None:
    surface = DurableStateSurface()
    with pytest.raises(HarnessError):
        surface.restore("nonexistent")


# ---------------------------------------------------------------------------
# Layer 2 — ToolMediator
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tool_mediator_allowlist_allows_authorized_caller() -> None:
    mediator = ToolMediator()

    async def add(x: int, y: int) -> int:
        return x + y

    mediator.register_tool("add", add, allowlist=["worker-a", "worker-b"])
    result = await mediator.invoke("add", {"x": 2, "y": 3}, caller="worker-a")
    assert result.success is True
    assert result.output == 5
    assert result.error is None
    assert result.duration_ms >= 0.0


@pytest.mark.asyncio
async def test_tool_mediator_allowlist_rejects_unauthorized_caller() -> None:
    mediator = ToolMediator()

    async def secret(value: str) -> str:
        return value.upper()

    mediator.register_tool("secret", secret, allowlist=["trusted"])
    with pytest.raises(ToolAllowlistViolation):
        await mediator.invoke("secret", {"value": "hi"}, caller="intruder")


@pytest.mark.asyncio
async def test_tool_mediator_unknown_tool_raises() -> None:
    mediator = ToolMediator()
    with pytest.raises(HarnessError):
        await mediator.invoke("ghost", {}, caller="anyone")


@pytest.mark.asyncio
async def test_tool_mediator_handler_failure_returns_failed_result() -> None:
    mediator = ToolMediator()

    async def boom() -> None:
        raise RuntimeError("kaboom")

    mediator.register_tool("boom", boom, allowlist=["caller"])
    result = await mediator.invoke("boom", {}, caller="caller")
    assert result.success is False
    assert result.output is None
    assert "kaboom" in (result.error or "")


# ---------------------------------------------------------------------------
# Layer 3 — EvidenceCollector
# ---------------------------------------------------------------------------


def test_evidence_record_and_verify() -> None:
    collector = EvidenceCollector()
    ev = collector.record_evidence(
        source="web_search",
        content="Python 3.11 was released in October 2022.",
        evidence_type="fact",
    )
    assert ev.verified is False
    assert collector.list_unverified() == [ev]

    collector.verify(ev.evidence_id, verifier="reviewer-1")
    assert ev.verified is True
    assert collector.list_unverified() == []


def test_evidence_verify_unknown_raises() -> None:
    collector = EvidenceCollector()
    with pytest.raises(HarnessError):
        collector.verify("missing", verifier="r")


def test_evidence_cross_check_identical_content() -> None:
    collector = EvidenceCollector()
    a = collector.record_evidence("s1", "hello world", "t")
    b = collector.record_evidence("s2", "hello world", "t")
    assert collector.cross_check(a, b) == pytest.approx(1.0)


def test_evidence_cross_check_disjoint_content() -> None:
    collector = EvidenceCollector()
    a = collector.record_evidence("s1", "aaaaa", "t")
    b = collector.record_evidence("s2", "zzzzz", "t")
    assert collector.cross_check(a, b) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Layer 4 — GovernanceBoundary
# ---------------------------------------------------------------------------


def test_governance_violation_detected() -> None:
    gov = GovernanceBoundary()
    gov.add_rule(
        rule_id="no_direct_db",
        description="直接操作数据库",
        severity="critical",
    )
    violations = gov.check_violation("agent 试图直接操作数据库以绕过 Repository")
    assert len(violations) == 1
    assert violations[0].rule_id == "no_direct_db"
    assert "no_direct_db" in violations[0].message


def test_governance_no_violation_when_action_clean() -> None:
    gov = GovernanceBoundary()
    gov.add_rule("no_direct_db", "直接操作数据库", "critical")
    assert gov.check_violation("agent called Repository.save()") == []


def test_governance_case_insensitive_match() -> None:
    gov = GovernanceBoundary()
    gov.add_rule("no_drop", "DROP TABLE", "high")
    violations = gov.check_violation("someone ran drop table users")
    assert len(violations) == 1
    assert violations[0].rule_id == "no_drop"


# ---------------------------------------------------------------------------
# Layer 5 — MagicWordsRegistry
# ---------------------------------------------------------------------------


def test_magic_words_detect_chinese_stop() -> None:
    registry = MagicWordsRegistry()
    registry.register_word("停止", MagicWordAction.HALT)
    detections = registry.detect("请立即停止当前操作")
    assert len(detections) == 1
    assert detections[0].word == "停止"
    assert detections[0].action == MagicWordAction.HALT
    assert detections[0].position >= 0
    assert "停止" in detections[0].context


def test_magic_words_detect_english_halt() -> None:
    registry = MagicWordsRegistry()
    registry.register_word("halt", MagicWordAction.HALT)
    detections = registry.detect("the system should halt immediately")
    assert len(detections) == 1
    assert detections[0].word == "halt"
    assert detections[0].action == MagicWordAction.HALT


def test_magic_words_detect_multiple_words_bilingual() -> None:
    registry = MagicWordsRegistry()
    registry.register_word("停止", MagicWordAction.HALT)
    registry.register_word("halt", MagicWordAction.HALT)
    text = "first 停止 then halt"
    detections = registry.detect(text)
    words = {d.word for d in detections}
    assert words == {"停止", "halt"}


def test_magic_words_with_defaults_includes_bilingual_set() -> None:
    registry = MagicWordsRegistry.with_defaults()
    assert "停止" in registry.list_words()
    assert "halt" in registry.list_words()
    assert "stop" in registry.list_words()
    # DEFAULT_MAGIC_WORDS is exposed and non-empty.
    assert "停止" in DEFAULT_MAGIC_WORDS


def test_magic_words_no_detection_when_absent() -> None:
    registry = MagicWordsRegistry()
    registry.register_word("halt", MagicWordAction.HALT)
    assert registry.detect("all good here") == []


# ---------------------------------------------------------------------------
# Layer 6 — EntropyController
# ---------------------------------------------------------------------------


def test_entropy_cleanup_expired() -> None:
    controller = EntropyController()
    controller.register_artifact("stale", ttl_seconds=10)
    controller.register_artifact("fresh", ttl_seconds=3600)

    # Backdate the stale entry so it is past its TTL.
    entry = controller.get_entry("stale")
    assert entry is not None
    entry.last_touched = datetime.now(timezone.utc) - timedelta(seconds=100)

    expired = controller.list_expired()
    assert expired == ["stale"]

    cleaned = controller.cleanup_expired()
    assert cleaned == 1
    assert controller.count() == 1
    assert controller.get_entry("stale") is None
    assert controller.get_entry("fresh") is not None


def test_entropy_touch_resets_ttl() -> None:
    controller = EntropyController()
    controller.register_artifact("a1", ttl_seconds=10)
    entry = controller.get_entry("a1")
    assert entry is not None
    entry.last_touched = datetime.now(timezone.utc) - timedelta(seconds=100)
    assert controller.list_expired() == ["a1"]

    controller.touch("a1")
    assert controller.list_expired() == []


def test_entropy_register_duplicate_raises() -> None:
    controller = EntropyController()
    controller.register_artifact("a1", ttl_seconds=10)
    with pytest.raises(HarnessError):
        controller.register_artifact("a1", ttl_seconds=10)


# ---------------------------------------------------------------------------
# Layer 7 — HarnessabilityScorer
# ---------------------------------------------------------------------------


def test_harnessability_perfect_score_is_A() -> None:
    scorer = HarnessabilityScorer()
    factors = HarnessabilityFactors(
        durable_state_coverage=1.0,
        tool_allowlist_strictness=1.0,
        evidence_completeness=1.0,
        governance_rule_count=5,
        magic_word_coverage=1.0,
        entropy_cleanup_rate=1.0,
    )
    score = scorer.score(factors)
    assert score == pytest.approx(1.0)
    assert scorer.grade(score) == "A"
    # grade() also works on a raw float.
    assert scorer.grade(1.0) == "A"


def test_harnessability_mid_score_is_C_or_D() -> None:
    scorer = HarnessabilityScorer()
    assert scorer.grade(0.5) in ("C", "D")
    # Confirm 0.5 actually maps to D under the chosen thresholds.
    assert scorer.grade(0.5) == "D"


def test_harnessability_score_weights_sum_to_one() -> None:
    # If every factor is 0.5 and governance is saturated (5 rules -> 1.0),
    # the weighted sum is: 0.5*(0.2+0.2+0.2+0.15+0.1) + 1.0*0.15
    #                    = 0.5*0.85 + 0.15 = 0.425 + 0.15 = 0.575
    scorer = HarnessabilityScorer()
    factors = HarnessabilityFactors(
        durable_state_coverage=0.5,
        tool_allowlist_strictness=0.5,
        evidence_completeness=0.5,
        governance_rule_count=5,
        magic_word_coverage=0.5,
        entropy_cleanup_rate=0.5,
    )
    score = scorer.score(factors)
    assert score == pytest.approx(0.575)
    assert scorer.grade(score) == "D"


def test_harnessability_grade_boundaries() -> None:
    scorer = HarnessabilityScorer()
    assert scorer.grade(0.95) == "A"
    assert scorer.grade(0.85) == "B"
    assert scorer.grade(0.65) == "C"
    assert scorer.grade(0.45) == "D"
    assert scorer.grade(0.2) == "F"
