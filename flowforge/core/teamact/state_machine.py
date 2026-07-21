"""TeamActState — the core six-step collaboration state machine.

roleagent.md Ch.2 + docs/features/F002-teamact-loop.md.

The loop: State → Owner → Action → Evidence → Verdict → Route, then wraps back
to State for the next iteration. Five termination conditions (RA-010) must all
hold for ALL_CRITERIA_MET; the looser QUALITY_BAR_MET fires when the quality
threshold is crossed and the verdict passed.

This module is LLM-free and independently testable: termination is driven by
plain dataclass fields that the harness layer (LoopExecutor / TeamAct runner)
populates from real evidence, cross-agent review, and operator confirmation.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from flowforge.core.errors import TeamActError
from flowforge.core.teamact.handoff import HandoffCapsule
from flowforge.core.teamact.types import (
    TeamActPhase,
    TeamActStep,
    TerminationCondition,
)
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.teamact.state_machine")

DEFAULT_QUALITY_THRESHOLD: float = 0.85
DEFAULT_MAX_ITERATIONS: int = 5


@dataclass
class TeamActState:
    """Mutable shared state for one TeamAct loop run.

    Step transitions are validated against the canonical six-step order so a
    buggy caller cannot silently skip Evidence or Verdict. Iteration wraps
    exactly when ROUTE advances back to STATE.
    """

    team_id: str = field(default_factory=lambda: f"ta-{uuid.uuid4().hex[:10]}")
    current_step: TeamActStep = TeamActStep.STATE
    phase: TeamActPhase = TeamActPhase.PLANNING
    iteration: int = 0

    # Owner of the ball this iteration
    current_owner: str = ""

    # Caps & thresholds
    max_iterations: int = DEFAULT_MAX_ITERATIONS
    quality_threshold: float = DEFAULT_QUALITY_THRESHOLD

    # Acceptance criteria + evidence (criterion -> anchor list)
    acceptance_criteria: list[str] = field(default_factory=list)
    evidence: dict[str, list[Any]] = field(default_factory=dict)

    # Verdict signals
    quality_score: float = 0.0
    verdict_passed: bool = False
    verdict_notes: list[dict[str, Any]] = field(default_factory=list)

    # Five termination condition signals (roleagent.md §2.2)
    cross_agent_verified: bool = False
    no_dangling_ownership: bool = False
    vision_converged: bool = False

    # Operator / breaker interventions (set by the harness layer)
    magic_word_invoked: bool = False
    circuit_breaker_tripped: bool = False
    energy_depleted: bool = False

    # Lifecycle
    handoff_log: list[HandoffCapsule] = field(default_factory=list)
    terminated: bool = False
    termination_reason: TerminationCondition | None = None

    # ---- step transitions -------------------------------------------------

    def advance(self, step: TeamActStep) -> None:
        """Advance to the next step in canonical order.

        Validates that `step` is the expected successor of the current step
        (ROUTE → STATE wraps and increments iteration). Out-of-order jumps
        raise TeamActError so a skipped Evidence/Verdict cannot slip through.
        """
        if self.terminated:
            raise TeamActError("cannot advance a terminated TeamActState")
        expected = self.current_step.next()
        if step != expected:
            raise TeamActError(
                f"invalid step transition: at {self.current_step.value!r}, "
                f"expected next={expected.value!r}, got {step.value!r}"
            )
        # ROUTE → STATE wraps to a new iteration
        if self.current_step is TeamActStep.ROUTE and step is TeamActStep.STATE:
            self.iteration += 1
        self.current_step = step
        self._update_phase()
        logger.info(
            f"teamact: advance step={step.value} iteration={self.iteration} "
            f"phase={self.phase.value}"
        )

    def _update_phase(self) -> None:
        if self.terminated:
            self.phase = TeamActPhase.TERMINATED
            return
        if self.current_step in (TeamActStep.STATE, TeamActStep.OWNER):
            self.phase = TeamActPhase.PLANNING
        elif self.current_step in (TeamActStep.ACTION, TeamActStep.EVIDENCE):
            self.phase = TeamActPhase.EXECUTING
        else:  # VERDICT, ROUTE
            self.phase = TeamActPhase.REVIEWING

    # ---- termination -------------------------------------------------------

    def should_terminate(self) -> tuple[bool, TerminationCondition | None]:
        """Check termination conditions in priority order.

        Returns (should_stop, reason). Operator interventions outrun the
        iteration cap; the cap outruns success signals so a converged-but-
        over-budget loop still reports MAX_ITERATIONS.
        """
        if self.terminated:
            return True, self.termination_reason

        if self.magic_word_invoked:
            return True, TerminationCondition.MAGIC_WORD
        if self.circuit_breaker_tripped:
            return True, TerminationCondition.CIRCUIT_BREAKER_TRIPPED
        if self.energy_depleted:
            return True, TerminationCondition.ENERGY_DEPLETED
        if self.iteration >= self.max_iterations:
            return True, TerminationCondition.MAX_ITERATIONS

        if self._all_criteria_met():
            return True, TerminationCondition.ALL_CRITERIA_MET
        if self.quality_score >= self.quality_threshold and self.verdict_passed:
            return True, TerminationCondition.QUALITY_BAR_MET

        return False, None

    def terminate(self, reason: TerminationCondition) -> None:
        """Mark the loop as terminated for the given reason (idempotent)."""
        self.terminated = True
        self.termination_reason = reason
        self.phase = TeamActPhase.TERMINATED
        logger.info(
            f"teamact: terminate team={self.team_id!r} reason={reason.value} "
            f"iteration={self.iteration}"
        )

    def _all_criteria_met(self) -> bool:
        """Five termination conditions (roleagent.md §2.2), all required."""
        if not self.acceptance_criteria:
            return False
        for crit in self.acceptance_criteria:
            if not self.evidence.get(crit):
                return False
        return (
            self.cross_agent_verified
            and self.no_dangling_ownership
            and self.vision_converged
            and self.quality_score >= self.quality_threshold
        )

    # ---- handoffs / ownership ---------------------------------------------

    def push_handoff(self, capsule: HandoffCapsule) -> None:
        """Append a handoff capsule and adopt its target as the current owner."""
        if self.terminated:
            raise TeamActError("cannot push handoff onto a terminated TeamActState")
        capsule.validate()
        self.handoff_log.append(capsule)
        if capsule.to_owner:
            self.current_owner = capsule.to_owner
        logger.info(
            f"teamact: handoff from={capsule.from_owner!r} to={capsule.to_owner!r} "
            f"capsule={capsule.capsule_id!r}"
        )

    def get_current_owner(self) -> str | None:
        if not self.current_owner:
            return None
        return self.current_owner

    # ---- evidence / verdict ----------------------------------------------

    def record_evidence(self, key: str, value: Any) -> None:
        if not key.strip():
            raise TeamActError("evidence key must not be empty")
        self.evidence.setdefault(key, []).append(value)
        logger.debug(f"teamact: +evidence key={key!r} count={len(self.evidence[key])}")

    def record_verdict(self, passed: bool, score: float, notes: str = "") -> None:
        if score < 0.0 or score > 1.0:
            raise TeamActError(f"quality score must be in [0.0, 1.0], got {score}")
        self.verdict_passed = passed
        self.quality_score = score
        self.verdict_notes.append(
            {"passed": passed, "score": score, "notes": notes}
        )
        logger.info(
            f"teamact: verdict passed={passed} score={score:.4f} "
            f"iteration={self.iteration}"
        )
