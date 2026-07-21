"""Memory governance — retention, decay, conflict detection.

Three governance primitives operate over a MemoryCollection:
- RetentionPolicy   — caps collection size by evicting low-importance or
                       stale entries
- DecayPolicy       — periodically decays importance to model forgetting
- ConflictResolver  — picks a winner among conflicting entries
                       (same domain + same tag set)
- MemoryGovernor    — orchestrates retention / decay / conflict detection

Policies are frozen dataclasses so they can be shared across collections
without surprise. Mutation of MemoryEntry instances (importance, etc.) is
done in-place by the governor — the collection owns its entries.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import MemoryError
from flowforge.core.memory.collection import MemoryCollection, MemoryEntry
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.memory.governance")


@dataclass(frozen=True)
class RetentionPolicy:
    """Retention policy — evict entries that violate any of these caps.

    max_entries      — hard cap on collection size; lowest-importance
                       entries are evicted first (None = no size cap)
    max_age_seconds  — evict entries older than this (None = no age cap)
    min_importance   — evict entries with importance strictly below this
    """

    max_entries: int | None = None
    max_age_seconds: float | None = None
    min_importance: float = 0.0


@dataclass(frozen=True)
class DecayPolicy:
    """Decay policy — multiplicative importance decay.

    decay_rate               — factor applied each pass (0.0..1.0)
    decay_interval_seconds   — only entries older than this are decayed
                               (prevents brand-new entries from decaying
                               on the very first governor pass)
    """

    decay_rate: float = 0.95
    decay_interval_seconds: float = 3600.0


class ConflictResolver:
    """Resolve conflicts among entries sharing domain + tag set.

    Selection rule (per task spec): highest importance wins; ties broken by
    most-recently-created; further ties broken by entry_id (deterministic
    for tests).
    """

    def resolve(self, conflicting: list[MemoryEntry]) -> MemoryEntry:
        """Return the single winning entry from a conflict group."""
        if not conflicting:
            raise ValueError("Cannot resolve an empty conflict set")
        return max(
            conflicting,
            key=lambda e: (e.importance, e.created_at, e.entry_id),
        )


class MemoryGovernor:
    """Applies retention / decay / conflict detection over a collection."""

    def apply_retention(
        self,
        collection: MemoryCollection,
        policy: RetentionPolicy,
    ) -> int:
        """Apply the retention policy; return the number of entries removed.

        Eviction order:
        1. Entries violating max_age_seconds or min_importance.
        2. If still over max_entries, evict the lowest-importance (then
           oldest-created) survivors until under the cap.
        """
        now = datetime.now(timezone.utc)
        to_remove: list[str] = []
        already_marked: set[str] = set()

        # Pass 1: age + importance eviction.
        for entry in collection.all():
            if policy.max_age_seconds is not None:
                age = (now - entry.created_at).total_seconds()
                if age > policy.max_age_seconds:
                    self._mark(entry.entry_id, to_remove, already_marked)
                    continue
            if entry.importance < policy.min_importance:
                self._mark(entry.entry_id, to_remove, already_marked)

        # Pass 2: size cap eviction.
        if (
            policy.max_entries is not None
            and collection.count() - len(already_marked) > policy.max_entries
        ):
            survivors = [
                e for e in collection.all() if e.entry_id not in already_marked
            ]
            overflow = len(survivors) - policy.max_entries
            if overflow > 0:
                # Lowest importance first, then oldest created_at.
                survivors.sort(key=lambda e: (e.importance, e.created_at))
                for entry in survivors[:overflow]:
                    self._mark(entry.entry_id, to_remove, already_marked)

        removed = 0
        for entry_id in to_remove:
            try:
                collection.remove(entry_id)
                removed += 1
            except MemoryError:
                # Already gone (shouldn't happen, but stay defensive).
                pass
        logger.info(
            f"governor: retention removed={removed} "
            f"max_entries={policy.max_entries} "
            f"max_age={policy.max_age_seconds} "
            f"min_importance={policy.min_importance}"
        )
        return removed

    def apply_decay(
        self,
        collection: MemoryCollection,
        policy: DecayPolicy,
    ) -> None:
        """Decay importance of entries older than decay_interval_seconds."""
        now = datetime.now(timezone.utc)
        decayed = 0
        for entry in collection.all():
            age = (now - entry.created_at).total_seconds()
            if age < policy.decay_interval_seconds:
                continue
            entry.importance = max(0.0, entry.importance * policy.decay_rate)
            decayed += 1
        logger.info(
            f"governor: decay applied rate={policy.decay_rate} "
            f"interval={policy.decay_interval_seconds} decayed={decayed}"
        )

    def detect_conflicts(
        self,
        collection: MemoryCollection,
    ) -> list[list[MemoryEntry]]:
        """Group entries by (domain, frozenset(tags)).

        Any group with more than one entry is a conflict — same domain and
        the exact same tag set suggests duplicate or competing memories.
        """
        groups: dict[tuple[object, frozenset[str]], list[MemoryEntry]] = {}
        for entry in collection.all():
            key = (entry.domain, frozenset(entry.tags))
            groups.setdefault(key, []).append(entry)
        conflicts = [group for group in groups.values() if len(group) > 1]
        logger.debug(f"governor: detected {len(conflicts)} conflict groups")
        return conflicts

    @staticmethod
    def _mark(
        entry_id: str,
        to_remove: list[str],
        already_marked: set[str],
    ) -> None:
        if entry_id not in already_marked:
            to_remove.append(entry_id)
            already_marked.add(entry_id)
