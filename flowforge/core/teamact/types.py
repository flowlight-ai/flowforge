"""TeamAct type primitives — enums for the six-step collaboration state machine.

References:
- roleagent.md Ch.2 (TeamAct team main loop)
- docs/features/F002-teamact-loop.md

TeamAct is the engineering closed-loop of the Shared State pattern:
State → Owner → Action → Evidence → Verdict → Route, with five termination
conditions, handoff capsules, ping-pong circuit breaker, at-mention routing,
ball custody leases, and Generator push-back rights.
"""

from __future__ import annotations

from enum import Enum


class TeamActStep(str, Enum):
    """The six steps of the TeamAct loop.

    Order is significant: a healthy loop advances
    STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE, then loops back to
    STATE for the next iteration.
    """

    STATE = "state"
    OWNER = "owner"
    ACTION = "action"
    EVIDENCE = "evidence"
    VERDICT = "verdict"
    ROUTE = "route"

    @classmethod
    def ordered(cls) -> list[TeamActStep]:
        """Return the steps in canonical loop order."""
        return [
            cls.STATE,
            cls.OWNER,
            cls.ACTION,
            cls.EVIDENCE,
            cls.VERDICT,
            cls.ROUTE,
        ]

    def next(self) -> TeamActStep:
        """Return the next step, looping ROUTE → STATE."""
        order = self.ordered()
        idx = order.index(self)
        return order[(idx + 1) % len(order)]


class TerminationCondition(str, Enum):
    """Why a TeamAct loop stopped.

    ALL_CRITERIA_MET        — all five termination conditions satisfied
    MAX_ITERATIONS          — iteration cap reached before convergence
    CIRCUIT_BREAKER_TRIPPED — ping-pong breaker tripped (escalate to operator)
    MAGIC_WORD              — operator invoked a magic-word escape hatch
    ENERGY_DEPLETED         — owning forgekin exhausted its task budget
    QUALITY_BAR_MET         — quality score crossed the configured threshold
    """

    ALL_CRITERIA_MET = "all_criteria_met"
    MAX_ITERATIONS = "max_iterations"
    CIRCUIT_BREAKER_TRIPPED = "circuit_breaker_tripped"
    MAGIC_WORD = "magic_word"
    ENERGY_DEPLETED = "energy_depleted"
    QUALITY_BAR_MET = "quality_bar_met"


class TeamActPhase(str, Enum):
    """Coarse-grained phase the state machine is currently in.

    PLANNING    — reading state / picking owner
    EXECUTING   — acting / producing evidence
    REVIEWING   — verdict / cross-agent review
    TERMINATED  — loop has stopped
    """

    PLANNING = "planning"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    TERMINATED = "terminated"
