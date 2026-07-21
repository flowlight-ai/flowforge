"""Side-Effect Write-Ahead Log — durable record of effects before execution.

Distributed reliability primitive (task.md P1-6, F021). Every side effect
(publish, db write, external API call) is appended to the WAL *before* the
effect is attempted. On crash the recovery layer replays PENDING entries:
re-execute (if idempotent) or roll back (if a compensating action exists).

Storage is an in-memory dict; production swaps in SQLite/PostgreSQL without
changing the surface API (mirrors DurableStateSurface's storage strategy).
"""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.side_effect_wal")

__all__ = ["WalStatus", "WalEntry", "WriteAheadLog"]


class WalStatus(str, Enum):
    """Lifecycle state of a WAL entry.

    PENDING     — appended, effect not yet confirmed durable
    COMMITTED   — effect confirmed durable, no further action needed
    ROLLED_BACK — effect compensated / undone
    """

    PENDING = "pending"
    COMMITTED = "committed"
    ROLLED_BACK = "rolled_back"


@dataclass
class WalEntry:
    """One recorded side effect.

    ``params`` is deep-copied on append so later caller mutation cannot
    corrupt the audit trail.
    """

    entry_id: str
    action: str
    target: str
    params: dict[str, Any]
    created_at: datetime
    status: WalStatus = WalStatus.PENDING


@dataclass
class _StoredEntry:
    """Internal stored representation (holds a defensive copy of params)."""

    entry: WalEntry


class WriteAheadLog:
    """Append-only log of side effects with commit/rollback lifecycle.

    Append returns a unique ``entry_id``; the caller references it later to
    mark the effect committed (success) or rolled back (compensated).
    ``list_uncommitted`` returns only PENDING entries so the recovery layer
    can replay exactly the effects whose durability is unconfirmed.
    """

    def __init__(self) -> None:
        self._entries: dict[str, _StoredEntry] = {}

    async def append(
        self,
        action: str,
        target: str,
        params: dict[str, Any] | None = None,
    ) -> str:
        """Append a side-effect record and return its entry_id.

        ``params`` is deep-copied so the caller cannot later mutate the
        stored audit trail by holding onto the original dict.
        """
        if not action:
            raise ReliabilityError("wal append requires a non-empty action")
        if not target:
            raise ReliabilityError("wal append requires a non-empty target")
        entry_id = uuid.uuid4().hex
        entry = WalEntry(
            entry_id=entry_id,
            action=action,
            target=target,
            params=copy.deepcopy(params or {}),
            created_at=datetime.now(timezone.utc),
            status=WalStatus.PENDING,
        )
        self._entries[entry_id] = _StoredEntry(entry=entry)
        logger.info(
            f"reliability: wal append id={entry_id} action={action} target={target}"
        )
        return entry_id

    async def get(self, entry_id: str) -> WalEntry:
        """Return a deep copy of the entry for ``entry_id``.

        Returns a copy so callers cannot mutate the stored audit trail by
        editing the returned dataclass's ``params`` dict.
        """
        stored = self._entries.get(entry_id)
        if stored is None:
            raise ReliabilityError(f"wal entry {entry_id!r} not found")
        return copy.deepcopy(stored.entry)

    async def list_uncommitted(self) -> list[WalEntry]:
        """Return deep copies of all PENDING entries (oldest first)."""
        pending = [
            copy.deepcopy(s.entry)
            for s in self._entries.values()
            if s.entry.status == WalStatus.PENDING
        ]
        pending.sort(key=lambda e: e.created_at)
        return pending

    async def mark_committed(self, entry_id: str) -> None:
        """Transition a PENDING entry to COMMITTED."""
        stored = self._entries.get(entry_id)
        if stored is None:
            raise ReliabilityError(f"wal entry {entry_id!r} not found")
        if stored.entry.status != WalStatus.PENDING:
            raise ReliabilityError(
                f"wal entry {entry_id!r} cannot commit from status "
                f"{stored.entry.status.value!r}"
            )
        stored.entry.status = WalStatus.COMMITTED
        logger.info(f"reliability: wal commit id={entry_id}")

    async def mark_rolled_back(self, entry_id: str) -> None:
        """Transition a PENDING entry to ROLLED_BACK."""
        stored = self._entries.get(entry_id)
        if stored is None:
            raise ReliabilityError(f"wal entry {entry_id!r} not found")
        if stored.entry.status != WalStatus.PENDING:
            raise ReliabilityError(
                f"wal entry {entry_id!r} cannot roll back from status "
                f"{stored.entry.status.value!r}"
            )
        stored.entry.status = WalStatus.ROLLED_BACK
        logger.info(f"reliability: wal rollback id={entry_id}")

    def count(self) -> int:
        """Total entries (any status) — for dashboards/tests."""
        return len(self._entries)
