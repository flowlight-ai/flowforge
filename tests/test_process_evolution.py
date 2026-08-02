"""Tests for Mode B — Process Evolution."""

from __future__ import annotations

import pytest

from flowforge.evolution.process_evolution import (
    MIN_EVIDENCE_SOURCES,
    ProcessEvolution,
)


@pytest.fixture
def pe() -> ProcessEvolution:
    return ProcessEvolution()


def test_no_trigger_on_empty_inputs(pe: ProcessEvolution) -> None:
    assert pe.detect_trigger([], [], [], []) is None


def test_repeated_error_priority(pe: ProcessEvolution) -> None:
    trigger = pe.detect_trigger(
        error_history=[{"err": "x"}, {"err": "x"}],
        user_corrections=[{"generalizable": True}],
        sop_gaps=["gap"],
        review_findings=[{"systemic": True}],
    )
    assert trigger == "repeated_error"


def test_user_correction_trigger(pe: ProcessEvolution) -> None:
    trigger = pe.detect_trigger(
        error_history=[],
        user_corrections=[{"generalizable": True}],
        sop_gaps=[],
        review_findings=[],
    )
    assert trigger == "user_correction"


def test_sop_gap_trigger(pe: ProcessEvolution) -> None:
    trigger = pe.detect_trigger(
        error_history=[],
        user_corrections=[],
        sop_gaps=["missing step X"],
        review_findings=[],
    )
    assert trigger == "sop_gap"


def test_review_systemic_trigger(pe: ProcessEvolution) -> None:
    trigger = pe.detect_trigger(
        error_history=[],
        user_corrections=[],
        sop_gaps=[],
        review_findings=[{"systemic": True}],
    )
    assert trigger == "review_systemic"


def test_create_proposal_validates_trigger_type(pe: ProcessEvolution) -> None:
    with pytest.raises(ValueError, match="Invalid trigger_type"):
        pe.create_proposal(
            trigger_type="bogus",
            trigger="x",
            evidence=["a", "b"],
            root_cause="rc",
            lever="memory",
            verify="v",
        )


def test_validate_proposal_rejects_insufficient_evidence(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["only one source"],
        root_cause="rc",
        lever="memory",
        verify="v",
    )
    ok, errors = pe.validate_proposal(proposal)
    assert not ok
    assert any("evidence" in e for e in errors)


def test_validate_proposal_rejects_empty_slots(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["a", "b"],
        root_cause="",
        lever="memory",
        verify="v",
    )
    ok, errors = pe.validate_proposal(proposal)
    assert not ok
    assert any("root_cause" in e for e in errors)


def test_validate_proposal_rejects_invalid_lever(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["a", "b"],
        root_cause="rc",
        lever="bogus_lever",
        verify="v",
    )
    ok, errors = pe.validate_proposal(proposal)
    assert not ok
    assert any("lever" in e for e in errors)


def test_validate_proposal_accepts_good_input(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["a", "b"],
        root_cause="rc",
        lever="memory",
        verify="v",
    )
    ok, errors = pe.validate_proposal(proposal)
    assert ok, errors


def test_get_minimal_leverage_picks_lightest(pe: ProcessEvolution) -> None:
    result = pe.get_minimal_leverage(["l0", "memory", "skill", "sop"])
    assert result == "memory"


def test_accept_proposal_requires_commit_ref(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["a", "b"],
        root_cause="rc",
        lever="memory",
        verify="v",
    )
    with pytest.raises(ValueError, match="commit_ref is required"):
        pe.accept_proposal(proposal.proposal_id, "")


def test_accept_proposal_transitions_status(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["a", "b"],
        root_cause="rc",
        lever="memory",
        verify="v",
    )
    accepted = pe.accept_proposal(proposal.proposal_id, "abc123")
    assert accepted is not None
    assert accepted.status == "accepted"
    assert accepted.commit_ref == "abc123"
    assert accepted.accepted_at is not None


def test_schedule_replay_check(pe: ProcessEvolution) -> None:
    proposal = pe.create_proposal(
        trigger_type="repeated_error",
        trigger="t",
        evidence=["a", "b"],
        root_cause="rc",
        lever="memory",
        verify="v",
    )
    due = pe.schedule_replay_check(proposal.proposal_id, days=30)
    assert due is not None
    due_list = pe.get_due_replay_checks()
    # Not yet due (30 days in future)
    assert due_list == []


def test_min_evidence_sources_constant() -> None:
    assert MIN_EVIDENCE_SOURCES == 2
