"""Entropy Control — TTL-based artifact retirement (roleagent.md Ch.7).

Layer 6 of the Harness seven-layer guardrail. Stale artifacts are retired
so the working set stays bounded — the harness does not accumulate entropy.
An artifact expires when ``now - last_touched > ttl_seconds``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import HarnessError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.entropy_control")

__all__ = ["EntropyEntry", "EntropyController"]


@dataclass
class EntropyEntry:
    """One tracked artifact with a TTL."""

    artifact_id: str
    created_at: datetime
    last_touched: datetime
    ttl_seconds: int


class EntropyController:
    """TTL-based artifact retirement."""

    def __init__(self) -> None:
        self._entries: dict[str, EntropyEntry] = {}

    def register_artifact(self, artifact_id: str, ttl_seconds: int) -> None:
        if not artifact_id:
            raise HarnessError("artifact_id must be non-empty")
        if ttl_seconds < 0:
            raise HarnessError("ttl_seconds must be non-negative")
        if artifact_id in self._entries:
            raise HarnessError(f"artifact {artifact_id!r} already registered")
        now = datetime.now(timezone.utc)
        self._entries[artifact_id] = EntropyEntry(
            artifact_id=artifact_id,
            created_at=now,
            last_touched=now,
            ttl_seconds=ttl_seconds,
        )
        logger.info(
            f"harness: register_artifact id={artifact_id!r} ttl={ttl_seconds}s"
        )

    def touch(self, artifact_id: str) -> None:
        """Reset ``last_touched`` to now, deferring expiry."""
        if artifact_id not in self._entries:
            raise HarnessError(f"artifact {artifact_id!r} not found")
        self._entries[artifact_id].last_touched = datetime.now(timezone.utc)
        logger.debug(f"harness: touch artifact id={artifact_id!r}")

    def list_expired(self) -> list[str]:
        now = datetime.now(timezone.utc)
        return [
            aid
            for aid, entry in self._entries.items()
            if (now - entry.last_touched).total_seconds() > entry.ttl_seconds
        ]

    def cleanup_expired(self) -> int:
        """Remove all expired entries and return the count removed."""
        expired = self.list_expired()
        for aid in expired:
            del self._entries[aid]
        if expired:
            logger.info(f"harness: cleanup_expired count={len(expired)}")
        return len(expired)

    def get_entry(self, artifact_id: str) -> EntropyEntry | None:
        return self._entries.get(artifact_id)

    def count(self) -> int:
        return len(self._entries)
