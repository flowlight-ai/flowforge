"""Durable State Surface — snapshot/restore for agent state (roleagent.md Ch.7).

Layer 1 of the Harness seven-layer guardrail. State snapshots are stored
in-memory (dict); production swaps in SQLite/PostgreSQL without changing
the surface API.
"""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from flowforge.core.errors import HarnessError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.durable_state")

__all__ = ["DurableState", "DurableStateSurface"]


@dataclass
class DurableState:
    """One immutable state snapshot."""

    snapshot_id: str
    state_dict: dict[str, Any]
    created_at: datetime
    parent_snapshot_id: str | None = None


class DurableStateSurface:
    """Persistent state surface — snapshot, restore, list.

    ``snapshot`` deep-copies the input dict so later mutation by the caller
    cannot corrupt the stored snapshot. ``restore`` deep-copies on the way
    back out for the same reason.
    """

    def __init__(self) -> None:
        self._snapshots: dict[str, DurableState] = {}

    def snapshot(
        self,
        state_dict: dict[str, Any],
        parent_snapshot_id: str | None = None,
    ) -> str:
        """Persist a deep copy of ``state_dict`` and return its snapshot_id."""
        snapshot_id = uuid.uuid4().hex
        self._snapshots[snapshot_id] = DurableState(
            snapshot_id=snapshot_id,
            state_dict=copy.deepcopy(state_dict),
            created_at=datetime.now(timezone.utc),
            parent_snapshot_id=parent_snapshot_id,
        )
        logger.info(f"harness: snapshot id={snapshot_id}")
        return snapshot_id

    def restore(self, snapshot_id: str) -> dict[str, Any]:
        """Return a deep copy of the stored state for ``snapshot_id``."""
        if snapshot_id not in self._snapshots:
            raise HarnessError(f"snapshot {snapshot_id!r} not found")
        state_dict = self._snapshots[snapshot_id].state_dict
        logger.info(f"harness: restore id={snapshot_id}")
        return copy.deepcopy(state_dict)

    def list_snapshots(self) -> list[str]:
        return list(self._snapshots.keys())
