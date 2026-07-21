"""AtMentionRouter — line-leading @ routing protocol.

roleagent.md Ch.2 (RA-013): a routing directive MUST appear at the start of
the line. An @ buried mid-sentence is narrative, not a route — mixing the two
is how the ball ends up on the floor.

Supported prefixes:
    @coder fix bug            → route to owner "coder"
    @all standup              → broadcast to every owner
    @role:coder fix bug       → route by capability/role "coder"
    @forgekin:fk-001 fix bug  → route by forgekin id "fk-001"

A message that does not start with @ yields an empty to_owner (no routing
directive) so the caller can decide to keep the current owner.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from flowforge.core.errors import TeamActError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.teamact.at_mention_router")

# Match a leading @token (no interior whitespace), then the rest as the body.
# token forms: "name", "all", "role:coder", "forgekin:fk-001"
_AT_PREFIX_RE = re.compile(r"^@([^\s]+)\s*(.*)$", re.DOTALL)

BROADCAST_OWNER: str = "all"


@dataclass
class RoutingDecision:
    """Outcome of routing a message.

    to_owner:              resolved owner id/name, or "all" for broadcast,
                           empty when the message carries no routing directive
    message_body:          the message with the @ prefix stripped
    mentioned_capabilities: capability/role names referenced by @role:...
                           (empty unless the directive was @role:...)
    """

    to_owner: str = ""
    message_body: str = ""
    mentioned_capabilities: list[str] = field(default_factory=list)

    @property
    def is_broadcast(self) -> bool:
        return self.to_owner == BROADCAST_OWNER

    @property
    def has_routing_directive(self) -> bool:
        return bool(self.to_owner)


class AtMentionRouter:
    """Parse a leading @ routing directive out of a message."""

    def route(self, message: str) -> RoutingDecision:
        if message is None:
            raise TeamActError("route() requires a non-None message")
        stripped = message.lstrip()
        if not stripped.startswith("@"):
            # Narrative @ mention — not a route. Preserve the original body.
            logger.debug("at_mention: no leading directive, keeping message as-is")
            return RoutingDecision(to_owner="", message_body=message)

        match = _AT_PREFIX_RE.match(stripped)
        if match is None:
            raise TeamActError(f"could not parse @ routing directive from {message!r}")

        token, body = match.group(1), match.group(2)

        if token.startswith("role:"):
            role = token[len("role:") :]
            if not role:
                raise TeamActError("@role: directive requires a role name")
            owner = role  # resolved later by CapabilityProfile routing
            caps = [role]
        elif token.startswith("forgekin:"):
            owner = token[len("forgekin:") :]
            if not owner:
                raise TeamActError("@forgekin: directive requires a forgekin id")
            caps = []
        elif token == BROADCAST_OWNER:
            owner = BROADCAST_OWNER
            caps = []
        else:
            # bare @name — owner is the name itself
            owner = token
            caps = []

        logger.info(
            f"at_mention: route owner={owner!r} caps={caps} "
            f"broadcast={owner == BROADCAST_OWNER}"
        )
        return RoutingDecision(
            to_owner=owner,
            message_body=body,
            mentioned_capabilities=caps,
        )
