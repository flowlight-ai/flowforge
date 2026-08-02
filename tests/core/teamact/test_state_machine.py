"""Tests for the TeamAct state machine and its collaborators.

Covers (per task.md P1-2):
- TeamActStep ordering STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE
- TerminationReport — five conditions, mark/met/check semantics
- TeamActState advance / iteration / termination / pass_ball / escalate
- HandoffCapsule is_valid + append via pass_ball
- PingPongCircuitBreaker should_break after threshold consecutive failures

> TODO(refactor): AtMentionRouter / BallCustodyRegistry / PushBackProtocol were
> removed in the v7.0 refactor; re-add their tests once they are reimplemented.

No LLM is involved — these are pure data-structure + state-machine tests.
"""

from __future__ import annotations

import pytest

from flowforge.core.teamact.circuit_breaker import PingPongCircuitBreaker
from flowforge.core.teamact.handoff import HandoffCapsule
from flowforge.core.teamact.state_machine import (
    CVO_AGENT_ID,
    TeamActState,
    TerminationReport,
)
from flowforge.core.teamact.types import (
    BallStatus,
    TeamActStep,
    TerminationCondition,
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def _advance_full_cycle(state: TeamActState) -> None:
    """Advance STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE → STATE.

    The final advance wraps from ROUTE and increments iteration.
    """
    for _ in range(6):
        state.advance(action="worked", evidence="trace-123")


def _valid_capsule(**overrides: object) -> HandoffCapsule:
    base: dict[str, object] = {
        "from_agent": "fk-author",
        "to_agent": "fk-coder",
        "task_summary": "implemented feature F002",
        "next_step": "write tests",
    }
    base.update(overrides)
    return HandoffCapsule(**base)  # type: ignore[arg-type]


def _state(task_id: str = "task-001", **overrides: object) -> TeamActState:
    return TeamActState(task_id=task_id, **overrides)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# TeamActStep — step ordering
# --------------------------------------------------------------------------- #


class TestTeamActStepOrdering:
    def test_canonical_order_is_six_steps(self) -> None:
        assert TeamActStep.ordered() == [
            TeamActStep.STATE,
            TeamActStep.OWNER,
            TeamActStep.ACTION,
            TeamActStep.EVIDENCE,
            TeamActStep.VERDICT,
            TeamActStep.ROUTE,
        ]

    def test_next_wraps_route_to_state(self) -> None:
        assert TeamActStep.ROUTE.next() is TeamActStep.STATE
        assert TeamActStep.STATE.next() is TeamActStep.OWNER

    def test_next_covers_the_whole_cycle(self) -> None:
        order = TeamActStep.ordered()
        for i, step in enumerate(order):
            nxt = order[(i + 1) % len(order)]
            assert step.next() is nxt


# --------------------------------------------------------------------------- #
# TeamActState — advance + iteration
# --------------------------------------------------------------------------- #


class TestTeamActStateAdvance:
    def test_fresh_state_starts_at_state(self) -> None:
        state = _state()
        assert state.current_step is TeamActStep.STATE
        assert state.iteration == 0
        assert state.ball_holder is None

    def test_advance_follows_canonical_order(self) -> None:
        state = _state()
        for step in TeamActStep.ordered()[1:]:
            assert state.advance() is step

    def test_advance_route_to_state_increments_iteration(self) -> None:
        state = _state()
        _advance_full_cycle(state)
        assert state.current_step is TeamActStep.STATE
        assert state.iteration == 1

    def test_advance_appends_history_entry(self) -> None:
        state = _state()
        state.advance(action="read spec", evidence="")
        assert len(state.history) == 1
        entry = state.history[0]
        assert entry.step is TeamActStep.STATE
        assert entry.action == "read spec"
        assert entry.agent is None

    def test_advance_records_ball_holder_in_history(self) -> None:
        state = _state(ball_holder="fk-coder")
        state.advance(action="patch", evidence="commit-abc")
        assert state.history[0].agent == "fk-coder"

    def test_evidence_on_evidence_step_marks_condition(self) -> None:
        state = _state()
        # move to EVIDENCE step, then record evidence
        state.advance()  # OWNER
        state.advance()  # ACTION
        state.advance()  # EVIDENCE
        state.advance(evidence="trace-99")  # records at EVIDENCE step
        assert state.termination_status.evidence_attached is True


# --------------------------------------------------------------------------- #
# TerminationReport
# --------------------------------------------------------------------------- #


class TestTerminationReport:
    def test_fresh_report_is_not_terminated(self) -> None:
        report = TerminationReport()
        assert report.is_terminated() is False
        assert report.met_conditions() == []
        assert set(report.missing_conditions()) == set(TerminationCondition.all())

    def test_mark_then_met_conditions(self) -> None:
        report = TerminationReport()
        report.mark(TerminationCondition.ACCEPTANCE_DONE)
        report.mark(TerminationCondition.EVIDENCE_ATTACHED)
        assert report.is_met(TerminationCondition.ACCEPTANCE_DONE) is True
        assert report.is_met(TerminationCondition.EVIDENCE_ATTACHED) is True
        assert report.is_met(TerminationCondition.VISION_CONVERGED) is False
        assert set(report.met_conditions()) == {
            TerminationCondition.ACCEPTANCE_DONE,
            TerminationCondition.EVIDENCE_ATTACHED,
        }

    def test_mark_unmark_supported(self) -> None:
        report = TerminationReport()
        report.mark(TerminationCondition.ACCEPTANCE_DONE, met=True)
        report.mark(TerminationCondition.ACCEPTANCE_DONE, met=False)
        assert report.is_met(TerminationCondition.ACCEPTANCE_DONE) is False

    def test_all_five_conditions_terminate(self) -> None:
        report = TerminationReport()
        for condition in TerminationCondition.all():
            report.mark(condition)
        assert report.is_terminated() is True
        assert len(report.missing_conditions()) == 0

    def test_to_summary_reports_missing(self) -> None:
        report = TerminationReport()
        summary = report.to_summary()
        assert "NOT_TERMINATED" in summary
        assert TerminationCondition.ACCEPTANCE_DONE.value in summary


# --------------------------------------------------------------------------- #
# TeamActState — termination
# --------------------------------------------------------------------------- #


class TestTeamActStateTermination:
    def test_fresh_state_does_not_terminate(self) -> None:
        state = _state()
        assert state.is_terminated() is False

    def test_all_conditions_marked_terminates(self) -> None:
        state = _state()
        for condition in TerminationCondition.all():
            state.mark_termination(condition)
        assert state.is_terminated() is True
        assert state.termination_status.met_conditions() == TerminationCondition.all()

    def test_mark_single_condition_is_not_terminated(self) -> None:
        state = _state()
        state.mark_termination(TerminationCondition.VISION_CONVERGED)
        assert state.is_terminated() is False

    def test_check_termination_derives_evidence(self) -> None:
        state = _state()
        state.advance(action="x", evidence="commit-abc")
        state.check_termination()
        assert state.termination_status.evidence_attached is True

    def test_check_termination_derives_no_dangling_when_resolved(self) -> None:
        state = _state()
        capsule = _valid_capsule(open_questions=[])
        state.pass_ball(to_agent="fk-coder", capsule=capsule)
        state.check_termination()
        assert state.termination_status.no_dangling_ownership is True

    def test_check_termination_keeps_dangling_open_questions(self) -> None:
        state = _state()
        capsule = _valid_capsule(open_questions=["is spec §3.2 final?"])
        state.pass_ball(to_agent="fk-coder", capsule=capsule)
        state.check_termination()
        assert state.termination_status.no_dangling_ownership is False

    def test_get_open_questions_collects_across_capsules(self) -> None:
        state = _state()
        state.pass_ball(
            to_agent="fk-coder",
            capsule=_valid_capsule(open_questions=["q1"]),
        )
        state.pass_ball(
            to_agent="fk-reviewer",
            capsule=_valid_capsule(
                from_agent="fk-coder",
                to_agent="fk-reviewer",
                open_questions=["q2"],
            ),
        )
        assert state.get_open_questions() == ["q1", "q2"]


# --------------------------------------------------------------------------- #
# HandoffCapsule + pass_ball
# --------------------------------------------------------------------------- #


class TestHandoffCapsule:
    def test_valid_capsule_is_valid(self) -> None:
        assert _valid_capsule().is_valid() is True

    def test_rejects_empty_from_agent(self) -> None:
        assert _valid_capsule(from_agent="").is_valid() is False

    def test_rejects_empty_to_agent(self) -> None:
        assert _valid_capsule(to_agent="").is_valid() is False

    def test_rejects_empty_task_summary(self) -> None:
        assert _valid_capsule(task_summary="").is_valid() is False

    def test_rejects_empty_next_step(self) -> None:
        assert _valid_capsule(next_step="").is_valid() is False

    def test_rejects_self_handoff(self) -> None:
        assert _valid_capsule(from_agent="fk-a", to_agent="fk-a").is_valid() is False

    def test_accepts_required_fields_only(self) -> None:
        capsule = HandoffCapsule(
            from_agent="fk-a",
            to_agent="fk-b",
            task_summary="did work",
            next_step="review",
        )
        assert capsule.is_valid() is True

    def test_pass_ball_sets_holder_and_status(self) -> None:
        state = _state()
        capsule = _valid_capsule(to_agent="fk-coder")
        assert state.pass_ball(to_agent="fk-coder", capsule=capsule) is True
        assert state.ball_holder == "fk-coder"
        assert state.ball_status is BallStatus.PASSED
        assert state.capsules == [capsule]

    def test_pass_ball_rejects_invalid_capsule(self) -> None:
        state = _state()
        bad = _valid_capsule(task_summary="")
        assert state.pass_ball(to_agent="fk-coder", capsule=bad) is False
        assert state.ball_holder is None

    def test_pass_ball_rejects_owner_mismatch(self) -> None:
        state = _state()
        capsule = _valid_capsule(to_agent="fk-coder")
        assert state.pass_ball(to_agent="fk-reviewer", capsule=capsule) is False
        assert state.ball_holder is None


# --------------------------------------------------------------------------- #
# escalate
# --------------------------------------------------------------------------- #


class TestEscalate:
    def test_escalate_to_cvo(self) -> None:
        state = _state(ball_holder="fk-coder")
        state.escalate(to_cvo=True)
        assert state.ball_holder == CVO_AGENT_ID
        assert state.ball_status is BallStatus.ESCALATED

    def test_escalate_to_operator(self) -> None:
        state = _state()
        state.escalate(to_cvo=False)
        assert state.ball_holder == "operator"
        assert state.ball_status is BallStatus.ESCALATED

    def test_escalate_appends_history(self) -> None:
        state = _state(ball_holder="fk-coder")
        state.escalate(to_cvo=True)
        assert len(state.history) == 1
        assert state.history[0].ball_status is BallStatus.ESCALATED


# --------------------------------------------------------------------------- #
# PingPongCircuitBreaker
# --------------------------------------------------------------------------- #


class TestPingPongCircuitBreaker:
    def test_fresh_breaker_does_not_break(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        assert breaker.should_break("fk-coder") is False

    def test_threshold_failures_trip(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        for _ in range(3):
            breaker.record_failure("fk-coder", reason="ping-pong")
        assert breaker.should_break("fk-coder") is False
        breaker.record_failure("fk-coder", reason="ping-pong")
        assert breaker.should_break("fk-coder") is True

    def test_reset_clears_failure_count(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=2)
        for _ in range(3):
            breaker.record_failure("fk-coder", reason="no progress")
        assert breaker.should_break("fk-coder") is True
        breaker.reset("fk-coder")
        assert breaker.should_break("fk-coder") is False

    def test_failures_isolated_per_owner(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=1)
        breaker.record_failure("fk-a", reason="r1")
        breaker.record_failure("fk-a", reason="r2")
        breaker.record_failure("fk-b", reason="r1")
        assert breaker.should_break("fk-a") is True
        assert breaker.should_break("fk-b") is False

    def test_max_rounds_hard_break(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=10, max_rounds=4)
        for _ in range(5):
            breaker.record_failure("fk-coder", reason="r")
        assert breaker.should_break("fk-coder") is True

    def test_default_threshold_is_three(self) -> None:
        assert PingPongCircuitBreaker().threshold == 3

    def test_get_failure_data_reports_counts(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        breaker.record_failure("fk-coder", reason="ping-pong")
        data = breaker.get_failure_data("fk-coder")
        assert data["agent_id"] == "fk-coder"
        assert data["rounds_count"] == 1
        assert data["should_break"] is False
        assert data["last_failure_reason"] == "ping-pong"

    def test_get_failure_data_empty_owner(self) -> None:
        breaker = PingPongCircuitBreaker()
        data = breaker.get_failure_data("fk-unknown")
        assert data["rounds_count"] == 0
        assert data["should_break"] is False


# --------------------------------------------------------------------------- #
# Deferred (removed in v7.0 refactor)
# --------------------------------------------------------------------------- #


def test_removed_collaborators_todo() -> None:
    """AtMentionRouter / BallCustodyRegistry / PushBackProtocol were removed.

    TODO(refactor): re-add coverage once these collaborators are reimplemented.
    """
    assert True
