"""Tests for the TeamAct state machine and its collaborators.

Covers (per task.md P1-2):
- TeamActStep ordering STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE
- Termination conditions (MAX_ITERATIONS, QUALITY_BAR_MET, ALL_CRITERIA_MET)
- HandoffCapsule append + validation
- PingPongCircuitBreaker trip after 3 consecutive failures
- AtMentionRouter: "@coder fix bug", "@all standup", @role:, @forgekin:
- BallCustodyRegistry acquire / release / expire
- PushBackProtocol create / resolve / list

No LLM is involved — these are pure data-structure + state-machine tests.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from flowforge.core.errors import TeamActError
from flowforge.core.teamact.at_mention_router import AtMentionRouter
from flowforge.core.teamact.ball_custody import BallCustodyRegistry
from flowforge.core.teamact.circuit_breaker import PingPongCircuitBreaker
from flowforge.core.teamact.handoff import HandoffCapsule
from flowforge.core.teamact.push_back import PushBack, PushBackProtocol
from flowforge.core.teamact.state_machine import TeamActState
from flowforge.core.teamact.types import (
    TeamActPhase,
    TeamActStep,
    TerminationCondition,
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def _advance_full_cycle(state: TeamActState) -> None:
    """Advance STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE → STATE.

    The final STATE advance wraps from ROUTE and increments iteration.
    """
    for step in (
        TeamActStep.OWNER,
        TeamActStep.ACTION,
        TeamActStep.EVIDENCE,
        TeamActStep.VERDICT,
        TeamActStep.ROUTE,
        TeamActStep.STATE,
    ):
        state.advance(step)


def _valid_capsule(**overrides: object) -> HandoffCapsule:
    base: dict[str, object] = {
        "from_owner": "fk-author",
        "to_owner": "fk-coder",
        "summary": "implemented feature F002",
        "next_action_hint": "write tests",
    }
    base.update(overrides)
    return HandoffCapsule(**base)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# TeamActState — step ordering
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

    def test_advance_follows_canonical_order(self) -> None:
        state = TeamActState()
        assert state.current_step is TeamActStep.STATE
        assert state.phase is TeamActPhase.PLANNING
        assert state.iteration == 0

        state.advance(TeamActStep.OWNER)
        assert state.current_step is TeamActStep.OWNER
        assert state.phase is TeamActPhase.PLANNING

        state.advance(TeamActStep.ACTION)
        assert state.current_step is TeamActStep.ACTION
        assert state.phase is TeamActPhase.EXECUTING

        state.advance(TeamActStep.EVIDENCE)
        assert state.current_step is TeamActStep.EVIDENCE
        assert state.phase is TeamActPhase.EXECUTING

        state.advance(TeamActStep.VERDICT)
        assert state.current_step is TeamActStep.VERDICT
        assert state.phase is TeamActPhase.REVIEWING

        state.advance(TeamActStep.ROUTE)
        assert state.current_step is TeamActStep.ROUTE
        assert state.phase is TeamActPhase.REVIEWING

    def test_advance_route_to_state_increments_iteration(self) -> None:
        state = TeamActState()
        _advance_full_cycle(state)
        assert state.current_step is TeamActStep.STATE
        assert state.iteration == 1

    def test_advance_rejects_out_of_order_jump(self) -> None:
        state = TeamActState()
        # STATE -> ACTION is illegal (must go through OWNER)
        with pytest.raises(TeamActError, match="invalid step transition"):
            state.advance(TeamActStep.ACTION)

    def test_advance_rejects_skipping_evidence(self) -> None:
        state = TeamActState()
        state.advance(TeamActStep.OWNER)
        state.advance(TeamActStep.ACTION)
        # ACTION -> VERDICT skips EVIDENCE
        with pytest.raises(TeamActError, match="invalid step transition"):
            state.advance(TeamActStep.VERDICT)

    def test_advance_after_terminate_raises(self) -> None:
        state = TeamActState()
        state.terminate(TerminationCondition.MAGIC_WORD)
        with pytest.raises(TeamActError, match="terminated"):
            state.advance(TeamActStep.OWNER)

    def test_terminate_sets_phase_and_reason(self) -> None:
        state = TeamActState()
        state.terminate(TerminationCondition.MAGIC_WORD)
        assert state.terminated is True
        assert state.termination_reason is TerminationCondition.MAGIC_WORD
        assert state.phase is TeamActPhase.TERMINATED


# --------------------------------------------------------------------------- #
# TeamActState — termination conditions
# --------------------------------------------------------------------------- #


class TestTerminationConditions:
    def test_fresh_state_does_not_terminate(self) -> None:
        state = TeamActState()
        stop, reason = state.should_terminate()
        assert stop is False
        assert reason is None

    def test_max_iterations_termination(self) -> None:
        state = TeamActState(max_iterations=2)
        # Two full cycles → iteration == 2 → MAX_ITERATIONS
        _advance_full_cycle(state)
        assert state.iteration == 1
        stop, reason = state.should_terminate()
        assert stop is False  # still under cap

        _advance_full_cycle(state)
        assert state.iteration == 2
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.MAX_ITERATIONS

    def test_quality_bar_met_termination(self) -> None:
        state = TeamActState(quality_threshold=0.85)
        # Verdict passed with high score, but not all five conditions met
        # (no cross_agent_verified / vision_converged) → QUALITY_BAR_MET
        state.record_verdict(passed=True, score=0.9)
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.QUALITY_BAR_MET

    def test_quality_bar_not_met_below_threshold(self) -> None:
        state = TeamActState(quality_threshold=0.85)
        state.record_verdict(passed=True, score=0.7)
        stop, reason = state.should_terminate()
        assert stop is False
        assert reason is None

    def test_quality_bar_not_met_verdict_failed(self) -> None:
        state = TeamActState(quality_threshold=0.85)
        state.record_verdict(passed=False, score=0.9)
        stop, reason = state.should_terminate()
        assert stop is False
        assert reason is None

    def test_all_criteria_met_termination(self) -> None:
        state = TeamActState(
            acceptance_criteria=["criterion_1"],
            quality_threshold=0.85,
        )
        state.record_evidence("criterion_1", "commit-abc")
        state.record_verdict(passed=True, score=0.9)
        state.cross_agent_verified = True
        state.no_dangling_ownership = True
        state.vision_converged = True
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.ALL_CRITERIA_MET

    def test_all_criteria_not_met_missing_evidence(self) -> None:
        state = TeamActState(
            acceptance_criteria=["c1", "c2"],
            quality_threshold=0.85,
        )
        state.record_evidence("c1", "anchor")
        # c2 has no evidence → ALL_CRITERIA_MET false, falls through to QUALITY_BAR
        state.record_verdict(passed=True, score=0.9)
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.QUALITY_BAR_MET

    def test_circuit_breaker_outranks_iterations(self) -> None:
        state = TeamActState(max_iterations=2)
        _advance_full_cycle(state)
        _advance_full_cycle(state)  # iteration == 2
        state.circuit_breaker_tripped = True
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.CIRCUIT_BREAKER_TRIPPED

    def test_magic_word_outranks_all(self) -> None:
        state = TeamActState(max_iterations=2)
        _advance_full_cycle(state)
        _advance_full_cycle(state)
        state.circuit_breaker_tripped = True
        state.magic_word_invoked = True
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.MAGIC_WORD

    def test_energy_depleted_termination(self) -> None:
        state = TeamActState()
        state.energy_depleted = True
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.ENERGY_DEPLETED

    def test_already_terminated_returns_stored_reason(self) -> None:
        state = TeamActState()
        state.terminate(TerminationCondition.QUALITY_BAR_MET)
        stop, reason = state.should_terminate()
        assert stop is True
        assert reason is TerminationCondition.QUALITY_BAR_MET


# --------------------------------------------------------------------------- #
# HandoffCapsule
# --------------------------------------------------------------------------- #


class TestHandoffCapsule:
    def test_valid_capsule_passes_validation(self) -> None:
        capsule = _valid_capsule()
        capsule.validate()  # should not raise

    def test_push_handoff_appends_and_sets_owner(self) -> None:
        state = TeamActState()
        assert state.get_current_owner() is None
        capsule = _valid_capsule(to_owner="fk-coder")
        state.push_handoff(capsule)
        assert len(state.handoff_log) == 1
        assert state.get_current_owner() == "fk-coder"

    def test_validate_rejects_empty_from_owner(self) -> None:
        capsule = HandoffCapsule(
            from_owner="",
            to_owner="fk-coder",
            summary="did work",
        )
        with pytest.raises(TeamActError, match="from_owner"):
            capsule.validate()

    def test_validate_rejects_empty_summary(self) -> None:
        capsule = HandoffCapsule(
            from_owner="fk-author",
            to_owner="fk-coder",
            summary="",
        )
        with pytest.raises(TeamActError, match="summary"):
            capsule.validate()

    def test_validate_requires_owner_or_capabilities(self) -> None:
        # Neither to_owner nor required_capabilities → ambiguous routing
        capsule = HandoffCapsule(
            from_owner="fk-author",
            to_owner="",
            summary="did work",
            required_capabilities=[],
        )
        with pytest.raises(TeamActError, match="to_owner or required_capabilities"):
            capsule.validate()

    def test_validate_accepts_capabilities_without_to_owner(self) -> None:
        capsule = HandoffCapsule(
            from_owner="fk-author",
            to_owner="",
            summary="did work",
            required_capabilities=["coding", "review"],
        )
        capsule.validate()  # should not raise

    def test_push_handoff_validates_capsule(self) -> None:
        state = TeamActState()
        bad_capsule = HandoffCapsule(from_owner="", summary="")
        with pytest.raises(TeamActError):
            state.push_handoff(bad_capsule)

    def test_push_handoff_after_terminate_raises(self) -> None:
        state = TeamActState()
        state.terminate(TerminationCondition.MAGIC_WORD)
        with pytest.raises(TeamActError, match="terminated"):
            state.push_handoff(_valid_capsule())

    def test_custody_lease_id_is_optional(self) -> None:
        capsule = _valid_capsule(custody_lease_id="lease-123")
        assert capsule.custody_lease_id == "lease-123"
        capsule2 = _valid_capsule()
        assert capsule2.custody_lease_id == ""


# --------------------------------------------------------------------------- #
# Evidence / Verdict recording
# --------------------------------------------------------------------------- #


class TestEvidenceAndVerdict:
    def test_record_evidence_appends(self) -> None:
        state = TeamActState()
        state.record_evidence("c1", "commit-a")
        state.record_evidence("c1", "commit-b")
        assert state.evidence["c1"] == ["commit-a", "commit-b"]

    def test_record_evidence_rejects_empty_key(self) -> None:
        state = TeamActState()
        with pytest.raises(TeamActError, match="key"):
            state.record_evidence("  ", "anchor")

    def test_record_verdict_stores_signals(self) -> None:
        state = TeamActState()
        state.record_verdict(passed=True, score=0.92, notes="all green")
        assert state.verdict_passed is True
        assert state.quality_score == pytest.approx(0.92)
        assert state.verdict_notes[-1]["notes"] == "all green"

    def test_record_verdict_rejects_out_of_range_score(self) -> None:
        state = TeamActState()
        with pytest.raises(TeamActError, match="quality score"):
            state.record_verdict(passed=True, score=1.5)
        with pytest.raises(TeamActError, match="quality score"):
            state.record_verdict(passed=True, score=-0.1)


# --------------------------------------------------------------------------- #
# PingPongCircuitBreaker
# --------------------------------------------------------------------------- #


class TestPingPongCircuitBreaker:
    def test_three_consecutive_failures_trip(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        assert breaker.is_tripped("fk-coder") is False

        breaker.record_failure("fk-coder")
        assert breaker.is_tripped("fk-coder") is False
        breaker.record_failure("fk-coder")
        assert breaker.is_tripped("fk-coder") is False
        breaker.record_failure("fk-coder")
        assert breaker.is_tripped("fk-coder") is True

    def test_success_resets_failure_count(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        breaker.record_failure("fk-coder")
        breaker.record_failure("fk-coder")
        breaker.record_success("fk-coder")
        assert breaker.is_tripped("fk-coder") is False
        assert breaker.failure_count("fk-coder") == 0

    def test_failures_isolated_per_owner(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        breaker.record_failure("fk-a")
        breaker.record_failure("fk-a")
        breaker.record_failure("fk-b")
        assert breaker.is_tripped("fk-a") is False
        assert breaker.is_tripped("fk-b") is False

    def test_reset_clears_owner(self) -> None:
        breaker = PingPongCircuitBreaker(threshold=3)
        breaker.record_failure("fk-a")
        breaker.record_failure("fk-a")
        breaker.record_failure("fk-a")
        assert breaker.is_tripped("fk-a") is True
        breaker.reset("fk-a")
        assert breaker.is_tripped("fk-a") is False
        assert breaker.failure_count("fk-a") == 0

    def test_default_threshold_is_three(self) -> None:
        breaker = PingPongCircuitBreaker()
        assert breaker.threshold == 3

    def test_threshold_below_one_rejected(self) -> None:
        with pytest.raises(TeamActError, match="threshold"):
            PingPongCircuitBreaker(threshold=0)

    def test_record_failure_rejects_empty_owner(self) -> None:
        breaker = PingPongCircuitBreaker()
        with pytest.raises(TeamActError, match="owner"):
            breaker.record_failure("")


# --------------------------------------------------------------------------- #
# AtMentionRouter
# --------------------------------------------------------------------------- #


class TestAtMentionRouter:
    def test_basic_owner_routing(self) -> None:
        router = AtMentionRouter()
        decision = router.route("@coder fix bug")
        assert decision.to_owner == "coder"
        assert decision.message_body == "fix bug"
        assert decision.mentioned_capabilities == []
        assert decision.has_routing_directive is True
        assert decision.is_broadcast is False

    def test_broadcast_all(self) -> None:
        router = AtMentionRouter()
        decision = router.route("@all standup")
        assert decision.to_owner == "all"
        assert decision.message_body == "standup"
        assert decision.is_broadcast is True

    def test_role_routing(self) -> None:
        router = AtMentionRouter()
        decision = router.route("@role:coder refactor module")
        assert decision.to_owner == "coder"
        assert decision.mentioned_capabilities == ["coder"]
        assert decision.message_body == "refactor module"

    def test_forgekin_id_routing(self) -> None:
        router = AtMentionRouter()
        decision = router.route("@forgekin:fk-001 pick up the ball")
        assert decision.to_owner == "fk-001"
        assert decision.mentioned_capabilities == []
        assert decision.message_body == "pick up the ball"

    def test_narrative_at_is_not_a_route(self) -> None:
        router = AtMentionRouter()
        # @ buried mid-sentence is narrative, not a routing directive
        decision = router.route("hey @coder what do you think")
        assert decision.to_owner == ""
        assert decision.has_routing_directive is False
        assert decision.message_body == "hey @coder what do you think"

    def test_leading_whitespace_then_directive(self) -> None:
        router = AtMentionRouter()
        decision = router.route("   @coder fix bug")
        assert decision.to_owner == "coder"
        assert decision.message_body == "fix bug"

    def test_empty_role_rejected(self) -> None:
        router = AtMentionRouter()
        with pytest.raises(TeamActError, match="role"):
            router.route("@role: fix bug")

    def test_empty_forgekin_id_rejected(self) -> None:
        router = AtMentionRouter()
        with pytest.raises(TeamActError, match="forgekin"):
            router.route("@forgekin: fix bug")

    def test_owner_with_dashes_and_digits(self) -> None:
        router = AtMentionRouter()
        decision = router.route("@fk-coder-01 do thing")
        assert decision.to_owner == "fk-coder-01"
        assert decision.message_body == "do thing"


# --------------------------------------------------------------------------- #
# BallCustodyRegistry
# --------------------------------------------------------------------------- #


class TestBallCustodyRegistry:
    def test_acquire_returns_lease_id(self) -> None:
        registry = BallCustodyRegistry()
        lease_id = registry.acquire("ball-1", "fk-a", ttl_seconds=60)
        assert lease_id.startswith("lease-")

    def test_current_holder(self) -> None:
        registry = BallCustodyRegistry()
        assert registry.current_holder("ball-1") is None
        registry.acquire("ball-1", "fk-a", ttl_seconds=60)
        assert registry.current_holder("ball-1") == "fk-a"

    def test_acquire_blocked_while_held(self) -> None:
        registry = BallCustodyRegistry()
        registry.acquire("ball-1", "fk-a", ttl_seconds=60)
        with pytest.raises(TeamActError, match="already held"):
            registry.acquire("ball-1", "fk-b", ttl_seconds=60)

    def test_release_frees_ball(self) -> None:
        registry = BallCustodyRegistry()
        lease_id = registry.acquire("ball-1", "fk-a", ttl_seconds=60)
        registry.release(lease_id)
        assert registry.current_holder("ball-1") is None
        # A new owner can now acquire
        registry.acquire("ball-1", "fk-b", ttl_seconds=60)
        assert registry.current_holder("ball-1") == "fk-b"

    def test_renew_extends_lease(self) -> None:
        registry = BallCustodyRegistry()
        lease_id = registry.acquire("ball-1", "fk-a", ttl_seconds=1)
        assert registry.is_expired(lease_id) is False
        registry.renew(lease_id)
        assert registry.is_expired(lease_id) is False

    def test_expiry_releases_holder(self) -> None:
        # Injected clock so we can advance time without sleeping.
        clock = {"now": datetime(2026, 7, 17, 12, 0, 0)}
        registry = BallCustodyRegistry(now_fn=lambda: clock["now"])

        lease_id = registry.acquire("ball-1", "fk-a", ttl_seconds=30)
        assert registry.current_holder("ball-1") == "fk-a"
        assert registry.is_expired(lease_id) is False

        # Advance past the TTL
        clock["now"] = clock["now"] + timedelta(seconds=31)
        assert registry.is_expired(lease_id) is True
        assert registry.current_holder("ball-1") is None

        # Expired lease frees the ball for a new owner
        registry.acquire("ball-1", "fk-b", ttl_seconds=30)
        assert registry.current_holder("ball-1") == "fk-b"

    def test_acquire_rejects_invalid_args(self) -> None:
        registry = BallCustodyRegistry()
        with pytest.raises(TeamActError, match="ball_id"):
            registry.acquire("", "fk-a", 60)
        with pytest.raises(TeamActError, match="owner"):
            registry.acquire("ball-1", "", 60)
        with pytest.raises(TeamActError, match="ttl_seconds"):
            registry.acquire("ball-1", "fk-a", 0)

    def test_release_unknown_lease_raises(self) -> None:
        registry = BallCustodyRegistry()
        with pytest.raises(TeamActError, match="not found"):
            registry.release("lease-nope")

    def test_is_expired_unknown_lease_is_true(self) -> None:
        registry = BallCustodyRegistry()
        assert registry.is_expired("lease-unknown") is True


# --------------------------------------------------------------------------- #
# PushBackProtocol
# --------------------------------------------------------------------------- #


class TestPushBackProtocol:
    def test_create_push_back(self) -> None:
        protocol = PushBackProtocol()
        pb = protocol.create_push_back(
            from_owner="fk-author",
            to_owner="fk-reviewer",
            reason="review comment contradicts spec §3.2",
            evidence=["commit-abc", "spec-link"],
        )
        assert isinstance(pb, PushBack)
        assert pb.from_owner == "fk-author"
        assert pb.to_owner == "fk-reviewer"
        assert pb.resolved is False
        assert pb.resolution == ""
        assert pb.push_back_id.startswith("pb-")
        assert len(pb.evidence) == 2

    def test_list_unresolved(self) -> None:
        protocol = PushBackProtocol()
        pb1 = protocol.create_push_back(
            "fk-a", "fk-b", "reason 1", ["e1"]
        )
        pb2 = protocol.create_push_back(
            "fk-c", "fk-d", "reason 2", ["e2"]
        )
        unresolved = protocol.list_unresolved()
        assert len(unresolved) == 2
        protocol.resolve(pb1.push_back_id, "accepted, reviewer was wrong")
        unresolved = protocol.list_unresolved()
        assert len(unresolved) == 1
        assert unresolved[0].push_back_id == pb2.push_back_id

    def test_resolve_marks_resolved(self) -> None:
        protocol = PushBackProtocol()
        pb = protocol.create_push_back("fk-a", "fk-b", "reason", ["e1"])
        protocol.resolve(pb.push_back_id, "escalated to operator")
        fetched = protocol.get(pb.push_back_id)
        assert fetched.resolved is True
        assert fetched.resolution == "escalated to operator"

    def test_create_rejects_empty_reason(self) -> None:
        protocol = PushBackProtocol()
        with pytest.raises(TeamActError, match="reason"):
            protocol.create_push_back("fk-a", "fk-b", "", ["e1"])

    def test_create_rejects_missing_evidence(self) -> None:
        protocol = PushBackProtocol()
        with pytest.raises(TeamActError, match="evidence"):
            protocol.create_push_back("fk-a", "fk-b", "reason", [])

    def test_create_rejects_empty_owners(self) -> None:
        protocol = PushBackProtocol()
        with pytest.raises(TeamActError, match="from_owner"):
            protocol.create_push_back("", "fk-b", "reason", ["e1"])
        with pytest.raises(TeamActError, match="to_owner"):
            protocol.create_push_back("fk-a", "", "reason", ["e1"])

    def test_resolve_unknown_raises(self) -> None:
        protocol = PushBackProtocol()
        with pytest.raises(TeamActError, match="not found"):
            protocol.resolve("pb-nope", "resolution")

    def test_resolve_rejects_empty_resolution(self) -> None:
        protocol = PushBackProtocol()
        pb = protocol.create_push_back("fk-a", "fk-b", "reason", ["e1"])
        with pytest.raises(TeamActError, match="resolution"):
            protocol.resolve(pb.push_back_id, "  ")
