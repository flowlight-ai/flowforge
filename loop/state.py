"""LoopState — shared mutable state across the five-step loop.

Includes:
- task brief + acceptance criteria
- shared working memory (key-value)
- handoff capsule (passed to the next owner)
- evidence anchors (commits, test runs, traces)
- iteration counter
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class HandoffCapsule:
    """Self-contained message passed from one owner to the next.

    A capsule carries everything the next agent needs to pick up the work
    without re-reading the entire conversation. Mirrors roleagent.md Ch.3.
    """

    capsule_id: str = field(default_factory=lambda: f"hc-{uuid.uuid4().hex[:10]}")
    from_owner: str = ""
    to_owner: str = ""
    summary: str = ""
    open_questions: list[str] = field(default_factory=list)
    evidence_anchors: list[str] = field(default_factory=list)
    next_action_hint: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class LoopState:
    """Mutable shared state for a single loop run.

    Iteration is incremented every time the loop moves from one owner to the
    next. The loop terminates when:
    1. acceptance_criteria all met AND
    2. evidence attached for every criterion AND
    3. cross-agent review passed AND
    4. no open questions AND
    5. CVO vision convergence confirmed
    """

    state_id: str = field(default_factory=lambda: f"ls-{uuid.uuid4().hex[:10]}")
    task_brief: str = ""
    scope_baseline: str = ""
    acceptance_criteria: list[str] = field(default_factory=list)
    working_memory: dict[str, Any] = field(default_factory=dict)
    evidence: dict[str, list[str]] = field(default_factory=dict)  # criterion -> [anchors]
    handoff_log: list[HandoffCapsule] = field(default_factory=list)
    iteration: int = 0
    max_iterations: int = 5
    terminated: bool = False
    termination_reason: str = ""
    quality_score: float = 0.0
    reviewer_notes: list[dict[str, Any]] = field(default_factory=list)
    cvo_vision_confirmed: bool = False

    def attach_evidence(self, criterion: str, anchor: str) -> None:
        self.evidence.setdefault(criterion, []).append(anchor)

    def push_handoff(self, capsule: HandoffCapsule) -> None:
        self.handoff_log.append(capsule)
        self.iteration += 1

    def all_criteria_have_evidence(self) -> bool:
        if not self.acceptance_criteria:
            return False
        for crit in self.acceptance_criteria:
            anchors = self.evidence.get(crit, [])
            if not anchors:
                return False
        return True

    def has_open_questions(self) -> bool:
        return any(c.open_questions for c in self.handoff_log)

    def should_terminate(self) -> tuple[bool, str]:
        """Check five termination conditions from roleagent.md Ch.2."""
        if self.iteration >= self.max_iterations:
            return True, f"max_iterations ({self.max_iterations}) reached"
        if not self.all_criteria_have_evidence():
            return False, "not all acceptance criteria have evidence"
        if self.quality_score < 0.85:
            return False, f"quality_score {self.quality_score:.2f} < 0.85 threshold"
        if not self.reviewer_notes:
            return False, "no cross-agent review yet"
        if self.has_open_questions():
            return False, "open questions remain"
        if not self.cvo_vision_confirmed:
            return False, "CVO vision convergence not confirmed"
        return True, "all termination conditions met"

    def terminate(self, reason: str) -> None:
        self.terminated = True
        self.termination_reason = reason
