"""Tier 1-4 Recovery Grading — classify failures and pick a recovery action.

Distributed reliability primitive (task.md P1-6, F022). Failures are not
homogeneous: a transient timeout wants a retry, a dead provider wants a
failover, an already-executed side effect wants a rollback, and an unknown
blow-up wants human escalation. ``TierRecoveryService`` maps an error type
to a ``RecoveryTier`` and emits a concrete ``RecoveryAction``.

Tier ladder (escalating severity):
    TIER_1_RETRY    — transient error, auto-retry the same target
    TIER_2_FAILOVER — provider down, switch to a backup target
    TIER_3_ROLLBACK — side effect already happened, roll back via WAL
    TIER_4_ESCALATE — cannot auto-recover, escalate to a human
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from flowforge.core.errors import ReliabilityError
from flowforge.core.reliability.side_effect_wal import WalEntry
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.tier_recovery")

__all__ = [
    "RecoveryTier",
    "RecoveryActionType",
    "RecoveryPolicy",
    "FailureContext",
    "RecoveryAction",
    "TierRecoveryService",
]


class RecoveryTier(str, Enum):
    """Escalating severity tiers for failure recovery."""

    TIER_1_RETRY = "tier_1_retry"
    TIER_2_FAILOVER = "tier_2_failover"
    TIER_3_ROLLBACK = "tier_3_rollback"
    TIER_4_ESCALATE = "tier_4_escalate"


class RecoveryActionType(str, Enum):
    """Concrete action emitted by the recovery service."""

    RETRY = "retry"
    FAILOVER = "failover"
    ROLLBACK = "rollback"
    ESCALATE = "escalate"


# Tier -> default action type. TIER_3 maps to ROLLBACK only when WAL entries
# are present; otherwise it degrades to ESCALATE (handled in handle_failure).
_TIER_ACTION: dict[RecoveryTier, RecoveryActionType] = {
    RecoveryTier.TIER_1_RETRY: RecoveryActionType.RETRY,
    RecoveryTier.TIER_2_FAILOVER: RecoveryActionType.FAILOVER,
    RecoveryTier.TIER_3_ROLLBACK: RecoveryActionType.ROLLBACK,
    RecoveryTier.TIER_4_ESCALATE: RecoveryActionType.ESCALATE,
}


@dataclass
class RecoveryPolicy:
    """How a particular error type should be recovered.

    ``failover_targets`` is an ordered preference list consulted by the
    provider host when the tier is TIER_2_FAILOVER. ``rollback_strategy``
    is a free-form label (e.g. "wal_replay", "compensating_action") used
    by the caller to dispatch the right rollback mechanism.
    """

    tier: RecoveryTier
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    failover_targets: list[str] = field(default_factory=list)
    rollback_strategy: str = "wal_replay"


@dataclass
class FailureContext:
    """What happened, where, and which WAL entries are at risk."""

    error_type: str
    error_message: str
    source: str
    wal_entries: list[WalEntry] = field(default_factory=list)


@dataclass
class RecoveryAction:
    """Concrete recovery directive for the caller to execute."""

    tier: RecoveryTier
    action: RecoveryActionType
    target: str | None = None
    notes: str = ""


class TierRecoveryService:
    """Map failure contexts to recovery actions via registered policies.

    Callers ``register_policy`` per error type (e.g. "timeout",
    "provider_down", "side_effect_failed"). Unknown error types escalate
    to TIER_4_ESCALATE so nothing fails silently.
    """

    def __init__(self) -> None:
        self._policies: dict[str, RecoveryPolicy] = {}

    def register_policy(self, error_type: str, policy: RecoveryPolicy) -> None:
        if not error_type:
            raise ReliabilityError("error_type must be non-empty")
        if error_type in self._policies:
            raise ReliabilityError(
                f"recovery policy for {error_type!r} already registered"
            )
        self._policies[error_type] = policy
        logger.info(
            f"reliability: register_policy error_type={error_type!r} "
            f"tier={policy.tier.value}"
        )

    def get_policy(self, error_type: str) -> RecoveryPolicy | None:
        return self._policies.get(error_type)

    async def handle_failure(self, error: FailureContext) -> RecoveryAction:
        """Classify ``error`` and emit the recovery action to take.

        - Registered policy -> action derived from the policy's tier.
        - TIER_3_ROLLBACK without WAL entries degrades to ESCALATE
          (nothing to roll back).
        - TIER_2_FAILOVER with no configured failover_targets degrades to
          ESCALATE (nowhere to fail over).
        - Unknown error_type -> TIER_4_ESCALATE.
        """
        policy = self._policies.get(error.error_type)
        if policy is None:
            action = RecoveryAction(
                tier=RecoveryTier.TIER_4_ESCALATE,
                action=RecoveryActionType.ESCALATE,
                target=None,
                notes=f"unknown error_type {error.error_type!r}; no policy registered",
            )
            logger.warning(
                f"reliability: handle_failure escalate unknown "
                f"error_type={error.error_type!r} source={error.source!r}"
            )
            return action

        action_type = _TIER_ACTION[policy.tier]
        target: str | None = None
        notes = ""

        if policy.tier == RecoveryTier.TIER_1_RETRY:
            target = error.source
            notes = (
                f"retry up to {policy.max_retries} times with "
                f"{policy.retry_delay_seconds}s delay"
            )

        elif policy.tier == RecoveryTier.TIER_2_FAILOVER:
            if not policy.failover_targets:
                action_type = RecoveryActionType.ESCALATE
                notes = "no failover_targets configured; escalating"
            else:
                target = policy.failover_targets[0]
                notes = (
                    f"failover to {target}; alternatives="
                    f"{policy.failover_targets[1:]}"
                )

        elif policy.tier == RecoveryTier.TIER_3_ROLLBACK:
            if not error.wal_entries:
                action_type = RecoveryActionType.ESCALATE
                notes = "no WAL entries to roll back; escalating"
            else:
                target = error.source
                notes = (
                    f"roll back {len(error.wal_entries)} WAL entries via "
                    f"{policy.rollback_strategy}"
                )

        else:  # TIER_4_ESCALATE
            notes = "unrecoverable; escalate to operator"

        action = RecoveryAction(
            tier=policy.tier if action_type == _TIER_ACTION[policy.tier] else RecoveryTier.TIER_4_ESCALATE,
            action=action_type,
            target=target,
            notes=notes,
        )
        logger.info(
            f"reliability: handle_failure error_type={error.error_type!r} "
            f"tier={action.tier.value} action={action.action.value} "
            f"target={action.target!r}"
        )
        return action
