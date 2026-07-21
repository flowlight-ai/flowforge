"""MemoryCollection — multi-domain long-term memory federation substrate.

A MemoryCollection is an in-memory store of MemoryEntry records tagged by
MemoryDomain. It is the substrate for the three retrieval entries
(grep / semantic / index), governance policies (retention / decay /
conflict), and consumption-weighted ranking.

This module is pure-Python: no LLM, no external embedding service. Memory
entries are mutable (access_count, last_accessed, importance are updated by
retrievers and the governor).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from flowforge.core.errors import MemoryError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.memory.collection")


class MemoryDomain(str, Enum):
    """Top-level memory domain (记忆域).

    EPISODIC    — event-based memories ("what happened when")
    SEMANTIC    — fact-based memories ("what is true")
    PROCEDURAL  — skill-based memories ("how to do X")
    SHARED      — cross-agent shared memories
    FORGE_CODEX — forgekin method library index (灵典)
    """

    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROCEDURAL = "procedural"
    SHARED = "shared"
    FORGE_CODEX = "forge_codex"


@dataclass
class MemoryEntry:
    """One memory record (记忆条目).

    importance is clamped to [0.0, 1.0] at add() time. access_count and
    last_accessed are bumped by retrievers via touch().
    """

    content: str
    domain: MemoryDomain = MemoryDomain.SEMANTIC
    entry_id: str = field(default_factory=lambda: f"mem-{uuid.uuid4().hex[:12]}")
    tags: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_accessed: datetime | None = None
    access_count: int = 0
    importance: float = 0.5

    def touch(self) -> None:
        """Mark this entry as accessed (bump last_accessed + access_count)."""
        self.last_accessed = datetime.now(timezone.utc)
        self.access_count += 1


class MemoryCollection:
    """In-memory store of MemoryEntry records, indexed by entry_id.

    The collection is the federated substrate: any number of domains coexist,
    and the three retrieval entries operate over a single collection. Two
    secondary indices (domain, tag) are kept in sync for O(1) lookups.
    """

    def __init__(self) -> None:
        self._by_id: dict[str, MemoryEntry] = {}
        # Keyed by MemoryDomain enum (hashable).
        self._by_domain: dict[MemoryDomain, list[MemoryEntry]] = {}
        # Keyed by tag string.
        self._by_tag: dict[str, list[MemoryEntry]] = {}

    def add(self, entry: MemoryEntry) -> str:
        """Add a memory entry; returns the entry_id.

        Raises MemoryError on empty content or duplicate entry_id.
        """
        if not entry.content:
            raise MemoryError("MemoryEntry must declare non-empty content")
        if entry.entry_id in self._by_id:
            raise MemoryError(f"Memory entry {entry.entry_id!r} already exists")
        # Clamp importance into [0.0, 1.0].
        entry.importance = max(0.0, min(1.0, entry.importance))
        self._by_id[entry.entry_id] = entry
        self._by_domain.setdefault(entry.domain, []).append(entry)
        for tag in entry.tags:
            self._by_tag.setdefault(tag, []).append(entry)
        logger.info(
            f"memory: +entry id={entry.entry_id} domain={entry.domain.value}"
        )
        return entry.entry_id

    def get(self, entry_id: str) -> MemoryEntry:
        """Return the entry with entry_id; touches access metadata.

        Raises MemoryError if not found.
        """
        if entry_id not in self._by_id:
            raise MemoryError(f"Memory entry {entry_id!r} not found")
        entry = self._by_id[entry_id]
        entry.touch()
        return entry

    def list_by_domain(self, domain: str) -> list[MemoryEntry]:
        """Return all entries whose domain matches the given value.

        Accepts either the string value (e.g. "semantic") or a MemoryDomain
        instance — both compare equal because MemoryDomain inherits from str.
        """
        domain_key = self._normalize_domain(domain)
        if domain_key is None:
            return []
        return list(self._by_domain.get(domain_key, []))

    def list_by_tags(self, tags: list[str]) -> list[MemoryEntry]:
        """Return entries matching ANY of the given tags (deduplicated)."""
        if not tags:
            return []
        matched: list[MemoryEntry] = []
        seen: set[str] = set()
        for tag in tags:
            for entry in self._by_tag.get(tag, []):
                if entry.entry_id not in seen:
                    matched.append(entry)
                    seen.add(entry.entry_id)
        return matched

    def count(self) -> int:
        """Total number of entries in the collection."""
        return len(self._by_id)

    def all(self) -> list[MemoryEntry]:
        """Return a snapshot list of all entries (for governance / ranking)."""
        return list(self._by_id.values())

    def remove(self, entry_id: str) -> MemoryEntry:
        """Remove and return the entry with entry_id.

        Raises MemoryError if not found.
        """
        if entry_id not in self._by_id:
            raise MemoryError(f"Memory entry {entry_id!r} not found")
        entry = self._by_id.pop(entry_id)
        # Rebuild domain index entry without this entry.
        domain_list = self._by_domain.get(entry.domain)
        if domain_list is not None:
            self._by_domain[entry.domain] = [
                e for e in domain_list if e.entry_id != entry_id
            ]
        # Rebuild each tag index entry without this entry.
        for tag in entry.tags:
            tag_list = self._by_tag.get(tag)
            if tag_list is not None:
                self._by_tag[tag] = [e for e in tag_list if e.entry_id != entry_id]
        logger.info(f"memory: -entry id={entry_id}")
        return entry

    def clear(self) -> None:
        """Drop every entry and reset all indices."""
        self._by_id.clear()
        self._by_domain.clear()
        self._by_tag.clear()

    @staticmethod
    def _normalize_domain(domain: str | MemoryDomain) -> MemoryDomain | None:
        """Coerce a string or MemoryDomain into a MemoryDomain enum member."""
        if isinstance(domain, MemoryDomain):
            return domain
        try:
            return MemoryDomain(domain)
        except ValueError:
            return None
