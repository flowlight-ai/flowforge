"""BallCustodyRegistry — ball-custody leases for TeamAct owners.

roleagent.md Ch.2 (RA-014): when an owner must exit the session to wait for
an external condition (CI completion, operator confirmation, timed wake-up),
it declares custody of the ball via a structured lease. The lease has a TTL;
if the owner vanishes the lease expires and another owner may acquire.

This prevents the "ball on the floor" failure where one forgekin leaves and
no one else knows whether the task still has an owner.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from flowforge.core.errors import TeamActError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.teamact.ball_custody")

# Default TTL is generous: leases are renewed by long-running owners; the
# expiry is a safety net, not the primary release mechanism.
DEFAULT_TTL_SECONDS: int = 300

NowFn = Callable[[], datetime]


@dataclass
class CustodyLease:
    """Internal record of one active custody lease."""

    lease_id: str
    ball_id: str
    owner: str
    expires_at: datetime


class BallCustodyRegistry:
    """In-memory registry of ball-custody leases."""

    def __init__(self, now_fn: NowFn | None = None) -> None:
        # now_fn is injected (not a global) so tests can advance time without
        # sleeping — keeps the suite fast and deterministic.
        self._now_fn: NowFn = now_fn or (lambda: datetime.now(timezone.utc))
        self._leases: dict[str, CustodyLease] = {}  # lease_id -> lease
        self._ball_to_lease: dict[str, str] = {}  # ball_id -> lease_id

    def acquire(self, ball_id: str, owner: str, ttl_seconds: int) -> str:
        if not ball_id.strip():
            raise TeamActError("ball_id must not be empty")
        if not owner.strip():
            raise TeamActError("owner must not be empty when acquiring custody")
        if ttl_seconds <= 0:
            raise TeamActError(f"ttl_seconds must be > 0, got {ttl_seconds}")

        # Drop any expired lease on this ball before deciding it is held.
        existing_lease_id = self._ball_to_lease.get(ball_id)
        if existing_lease_id is not None:
            existing = self._leases.get(existing_lease_id)
            if existing is not None and not self._is_expired(existing):
                raise TeamActError(
                    f"ball {ball_id!r} is already held by {existing.owner!r} "
                    f"(lease {existing.lease_id!r})"
                )
            # expired — clean up the stale lease
            self._evict(existing_lease_id)

        lease_id = f"lease-{uuid.uuid4().hex[:10]}"
        expires_at = self._now_fn() + timedelta(seconds=ttl_seconds)
        lease = CustodyLease(
            lease_id=lease_id,
            ball_id=ball_id,
            owner=owner,
            expires_at=expires_at,
        )
        self._leases[lease_id] = lease
        self._ball_to_lease[ball_id] = lease_id
        logger.info(
            f"ball_custody: acquire ball={ball_id!r} owner={owner!r} "
            f"lease={lease_id!r} ttl={ttl_seconds}s"
        )
        return lease_id

    def renew(self, lease_id: str) -> None:
        lease = self._require_lease(lease_id)
        # Renewing an already-expired lease is allowed (the owner is back) but
        # we re-check ball ownership in case another owner grabbed it.
        new_expiry = self._now_fn() + timedelta(seconds=DEFAULT_TTL_SECONDS)
        lease.expires_at = new_expiry
        logger.info(
            f"ball_custody: renew lease={lease_id!r} owner={lease.owner!r} "
            f"new_expiry={new_expiry.isoformat()}"
        )

    def release(self, lease_id: str) -> None:
        lease = self._require_lease(lease_id)
        self._evict(lease_id)
        logger.info(
            f"ball_custody: release lease={lease_id!r} ball={lease.ball_id!r} "
            f"owner={lease.owner!r}"
        )

    def current_holder(self, ball_id: str) -> str | None:
        lease_id = self._ball_to_lease.get(ball_id)
        if lease_id is None:
            return None
        lease = self._leases.get(lease_id)
        if lease is None:
            return None
        if self._is_expired(lease):
            return None
        return lease.owner

    def is_expired(self, lease_id: str) -> bool:
        lease = self._leases.get(lease_id)
        if lease is None:
            # An unknown lease is treated as expired so callers can evict safely.
            return True
        return self._is_expired(lease)

    def _is_expired(self, lease: CustodyLease) -> bool:
        return self._now_fn() >= lease.expires_at

    def _require_lease(self, lease_id: str) -> CustodyLease:
        lease = self._leases.get(lease_id)
        if lease is None:
            raise TeamActError(f"custody lease {lease_id!r} not found")
        return lease

    def _evict(self, lease_id: str) -> None:
        lease = self._leases.pop(lease_id, None)
        if lease is not None:
            # Only clear the ball mapping if this lease still owns it.
            if self._ball_to_lease.get(lease.ball_id) == lease_id:
                self._ball_to_lease.pop(lease.ball_id, None)
