"""PushBackProtocol — Generator push-back right (RA-015).

roleagent.md Ch.2: any agent in any role has the right to push back — provided
it brings evidence, an applicability argument, and an alternative. A push-back
without evidence is illegitimate; a push-back with evidence MUST be taken
seriously. This replaces the one-way review protocol (reviewer → author fixes)
with a two-way debate: when the reviewer is wrong, the author can push back.

Unresolved push-backs block the QUALITY_BAR_MET termination condition until
they are either accepted (with a resolution) or escalated.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flowforge.core.errors import TeamActError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.teamact.push_back")


@dataclass
class PushBack:
    """A structured push-back from one owner to another.

    Fields:
        from_owner:  the agent issuing the push-back (typically the author)
        to_owner:    the agent being pushed back on (typically the reviewer)
        reason:      applicability argument — why the original ask/review is wrong
        evidence:    anchors supporting the push-back (commits, traces, test runs)
        created_at:  when the push-back was raised
        resolved:    whether the push-back has been resolved
        resolution:  free-text resolution once settled (accept / reject / escalate)
    """

    from_owner: str = ""
    to_owner: str = ""
    reason: str = ""
    evidence: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resolved: bool = False
    resolution: str = ""
    push_back_id: str = field(default_factory=lambda: f"pb-{uuid.uuid4().hex[:10]}")


class PushBackProtocol:
    """Track push-backs and their resolution state."""

    def __init__(self) -> None:
        self._push_backs: dict[str, PushBack] = {}

    def create_push_back(
        self,
        from_owner: str,
        to_owner: str,
        reason: str,
        evidence: list[str],
    ) -> PushBack:
        if not from_owner.strip():
            raise TeamActError("push_back from_owner must not be empty")
        if not to_owner.strip():
            raise TeamActError("push_back to_owner must not be empty")
        if not reason.strip():
            # A push-back without a reason is illegitimate (RA-015).
            raise TeamActError("push_back reason must not be empty")
        if not evidence:
            # A push-back without evidence is illegitimate (RA-015).
            raise TeamActError("push_back must carry at least one evidence anchor")

        push_back = PushBack(
            from_owner=from_owner,
            to_owner=to_owner,
            reason=reason,
            evidence=list(evidence),
        )
        self._push_backs[push_back.push_back_id] = push_back
        logger.info(
            f"push_back: create id={push_back.push_back_id!r} "
            f"from={from_owner!r} to={to_owner!r} "
            f"evidence_count={len(evidence)}"
        )
        return push_back

    def resolve(self, push_back_id: str, resolution: str) -> None:
        push_back = self._push_backs.get(push_back_id)
        if push_back is None:
            raise TeamActError(f"push_back {push_back_id!r} not found")
        if not resolution.strip():
            raise TeamActError("resolution must not be empty")
        push_back.resolved = True
        push_back.resolution = resolution
        logger.info(
            f"push_back: resolve id={push_back_id!r} resolution={resolution!r}"
        )

    def list_unresolved(self) -> list[PushBack]:
        return [pb for pb in self._push_backs.values() if not pb.resolved]

    def list_all(self) -> list[PushBack]:
        return list(self._push_backs.values())

    def get(self, push_back_id: str) -> PushBack:
        push_back = self._push_backs.get(push_back_id)
        if push_back is None:
            raise TeamActError(f"push_back {push_back_id!r} not found")
        return push_back
