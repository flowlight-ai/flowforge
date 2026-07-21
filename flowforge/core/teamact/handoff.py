"""HandoffCapsule — structured handoff passed between TeamAct owners.

This is the TeamAct-layer handoff capsule (roleagent.md Ch.2, RA-011).
It is distinct from the loop-layer HandoffCapsule in flowforge/loop/state.py:
the TeamAct capsule carries capability requirements and a ball-custody lease
reference so the next owner can be selected by CapabilityProfile and the
custody registry can track who currently holds the ball.

A capsule is a protocol-layer hard requirement, not optional politeness: the
receiving owner must be able to pick up the work without re-reading the entire
conversation.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flowforge.core.errors import TeamActError


@dataclass
class HandoffCapsule:
    """Self-contained message passed from one TeamAct owner to the next.

    Fields:
        from_owner:           id of the forgekin handing off
        to_owner:             id of the forgekin picking up (may be empty if
                              routing is deferred to the at-mention router)
        summary:              what was done (the "What")
        next_action_hint:     what the next owner should do (the "Next")
        required_capabilities: capabilities the next owner must have (drives
                              CapabilityProfile-based routing, F001)
        custody_lease_id:     ball-custody lease id (F006) being transferred;
                              empty when no lease is in play
    """

    from_owner: str = ""
    to_owner: str = ""
    summary: str = ""
    next_action_hint: str = ""
    required_capabilities: list[str] = field(default_factory=list)
    custody_lease_id: str = ""
    capsule_id: str = field(default_factory=lambda: f"ta-hc-{uuid.uuid4().hex[:10]}")
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def validate(self) -> None:
        """Check required fields; raise TeamActError on violation.

        from_owner and summary are mandatory — an anonymous, summary-less
        capsule forces the receiver to re-read the whole context, which is
        exactly the failure RA-011 calls out.
        """
        if not self.from_owner.strip():
            raise TeamActError("HandoffCapsule.from_owner must not be empty")
        if not self.summary.strip():
            raise TeamActError("HandoffCapsule.summary must not be empty")
        if not self.to_owner.strip() and not self.required_capabilities:
            raise TeamActError(
                "HandoffCapsule must specify either to_owner or required_capabilities "
                "so the next owner can be resolved"
            )
