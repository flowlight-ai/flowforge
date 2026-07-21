"""State-Machine vs Workflow classification — pick the right orchestration pattern.

Distributed reliability primitive (task.md P1-6, F024). Not every multi-step
flow needs a full workflow engine. A *strong* workflow (every step has a
compensation, all steps idempotent) can be recovered automatically by replay.
A *weak* state machine (no compensation, depends on external state) cannot be
recovered — it must be restarted from a checkpoint. A *hybrid* mixes both.

``StateWorkflowComparator`` inspects a step list and recommends the pattern:
    STRONG -> "use workflow engine"  (replayable, compensatable)
    WEAK   -> "use state machine"    (checkpoint-and-restart, no replay)
    HYBRID -> "hybrid"               (workflow engine with state-machine
                                      checkpoints for the non-compensatable steps)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.state_workflow")

__all__ = [
    "WorkflowStrength",
    "WorkflowStep",
    "StateWorkflowComparator",
]


class WorkflowStrength(str, Enum):
    """How recoverable a multi-step flow is.

    STRONG — every step has a compensation and is idempotent; full replay safe
    WEAK   — at least one step has no compensation; replay would re-execute
             non-idempotent side effects, so checkpoint-restart is required
    HYBRID — some steps are strong, some weak; mix both patterns
    """

    STRONG = "strong"
    WEAK = "weak"
    HYBRID = "hybrid"


@dataclass
class WorkflowStep:
    """One step in a multi-step flow.

    ``has_compensation`` — can the step be undone (rolled back)?
    ``idempotent``       — can the step be re-executed safely after a crash?
    ``requires_external_state`` — does the step read/write state outside the
        workflow engine (e.g. a third-party API)? Such steps cannot be
        safely replayed without coordination.
    """

    name: str
    has_compensation: bool = False
    idempotent: bool = False
    requires_external_state: bool = False


class StateWorkflowComparator:
    """Classify a workflow's recoverability and recommend an orchestration pattern.

    Classification rules:
    - STRONG  — every step has compensation AND is idempotent AND does not
                require external state. (Fully replayable.)
    - WEAK    — no step has compensation. (Nothing to replay; restart only.)
    - HYBRID  — some steps are compensatable/idempotent, others are not.
    """

    def classify_workflow(self, steps: list[WorkflowStep]) -> WorkflowStrength:
        if not steps:
            raise ReliabilityError("cannot classify an empty workflow")

        compensatable = [s for s in steps if s.has_compensation]
        idempotent_all = all(s.idempotent for s in steps)
        external_any = any(s.requires_external_state for s in steps)

        # STRONG: full replay is safe — every step compensatable + idempotent
        # + no external state that replay could desync.
        if (
            len(compensatable) == len(steps)
            and idempotent_all
            and not external_any
        ):
            strength = WorkflowStrength.STRONG
        # WEAK: nothing can be compensated — replay is meaningless, must restart.
        elif not compensatable:
            strength = WorkflowStrength.WEAK
        # HYBRID: mixed — some steps recoverable, some not.
        else:
            strength = WorkflowStrength.HYBRID

        logger.info(
            f"reliability: classify_workflow steps={len(steps)} "
            f"compensatable={len(compensatable)} idempotent_all={idempotent_all} "
            f"external_any={external_any} strength={strength.value}"
        )
        return strength

    def recommend_pattern(self, strength: WorkflowStrength) -> str:
        """Return the recommended orchestration pattern for ``strength``."""
        if strength == WorkflowStrength.STRONG:
            return "use workflow engine"
        if strength == WorkflowStrength.WEAK:
            return "use state machine"
        return "hybrid"
