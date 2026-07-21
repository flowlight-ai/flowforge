"""Governance Boundary — compression-immune rule store (roleagent.md Ch.7).

Layer 4 of the Harness seven-layer guardrail. Governance rules live as
structured ``GovernanceRule`` objects and are checked programmatically by
``check_violation`` — they NEVER enter the LLM prompt context, so they
cannot be compressed away or ignored by context-window pressure.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import HarnessError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.governance")

__all__ = [
    "GovernanceRule",
    "GovernanceViolation",
    "GovernanceBoundary",
]


@dataclass
class GovernanceRule:
    """One governance rule. Stored structurally — never serialized into prompts."""

    rule_id: str
    description: str
    severity: str
    created_at: datetime


@dataclass
class GovernanceViolation:
    """A detected violation of a governance rule."""

    rule_id: str
    action: str
    message: str
    timestamp: datetime


class GovernanceBoundary:
    """Compression-immune governance boundary.

    Rules are stored as structured ``GovernanceRule`` objects and checked by
    ``check_violation`` programmatically. Because they never appear in prompt
    context, an LLM cannot elide them during context compression.

    ``check_violation`` does a case-insensitive substring match: if a rule's
    ``description`` appears inside the ``action`` text, that rule is flagged.
    The description thus doubles as the forbidden phrase — keeping the matcher
    simple and deterministic (no LLM judgement involved).
    """

    def __init__(self) -> None:
        self._rules: dict[str, GovernanceRule] = {}

    def add_rule(
        self,
        rule_id: str,
        description: str,
        severity: str,
    ) -> None:
        if not rule_id:
            raise HarnessError("rule_id must be non-empty")
        if rule_id in self._rules:
            raise HarnessError(f"rule {rule_id!r} already exists")
        self._rules[rule_id] = GovernanceRule(
            rule_id=rule_id,
            description=description,
            severity=severity,
            created_at=datetime.now(timezone.utc),
        )
        logger.info(
            f"harness: add_rule id={rule_id!r} severity={severity!r}"
        )

    def check_violation(self, action: str) -> list[GovernanceViolation]:
        """Return one ``GovernanceViolation`` per rule whose description is in ``action``."""
        if not action:
            return []
        action_lower = action.lower()
        now = datetime.now(timezone.utc)
        violations: list[GovernanceViolation] = []
        for rule in self._rules.values():
            if not rule.description:
                continue
            if rule.description.lower() in action_lower:
                violations.append(
                    GovernanceViolation(
                        rule_id=rule.rule_id,
                        action=action,
                        message=(
                            f"action violates rule {rule.rule_id!r}: "
                            f"{rule.description}"
                        ),
                        timestamp=now,
                    )
                )
        if violations:
            logger.warning(
                f"harness: governance violations count={len(violations)} "
                f"rules={[v.rule_id for v in violations]}"
            )
        return violations
