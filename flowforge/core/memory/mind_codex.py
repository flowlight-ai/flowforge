"""MindCodex — searchable forgekin method library (灵典).

A ForgeMethod is a distilled procedural memory: name + description + steps +
preconditions + postconditions + evidence. The codex supports keyword search
(over name + description + steps) and is the FORGE_CODEX-domain substrate
for the federation.

This module is pure-Python and depends only on flowforge.core.errors and
flowforge.core.tracing — no LLM, no external embedding service, no *forge
imports.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from flowforge.core.errors import MemoryError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.memory.mind_codex")


@dataclass
class ForgeMethod:
    """One distilled method (灵法) — procedural memory record.

    success_rate is clamped to [0.0, 1.0] at add_method() time. usage_count
    and success_rate are updated by callers (e.g. after a loop replay).
    """

    name: str
    domain: str
    description: str = ""
    method_id: str = field(
        default_factory=lambda: f"method-{uuid.uuid4().hex[:12]}"
    )
    steps: list[str] = field(default_factory=list)
    preconditions: list[str] = field(default_factory=list)
    postconditions: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    usage_count: int = 0
    success_rate: float = 0.0  # 0.0..1.0


class MindCodex:
    """Searchable in-memory library of ForgeMethods (灵典)."""

    def __init__(self) -> None:
        self._by_id: dict[str, ForgeMethod] = {}

    def add_method(self, method: ForgeMethod) -> str:
        """Register a method; returns method_id.

        Raises MemoryError on empty name/domain or duplicate method_id.
        """
        if not method.name:
            raise MemoryError("ForgeMethod must declare a non-empty name")
        if not method.domain:
            raise MemoryError("ForgeMethod must declare a non-empty domain")
        if method.method_id in self._by_id:
            raise MemoryError(
                f"ForgeMethod {method.method_id!r} already exists"
            )
        method.success_rate = max(0.0, min(1.0, method.success_rate))
        self._by_id[method.method_id] = method
        logger.info(
            f"codex: +method id={method.method_id} name={method.name!r} "
            f"domain={method.domain}"
        )
        return method.method_id

    def search(self, query: str, top_k: int = 5) -> list[ForgeMethod]:
        """Return methods whose name / description / steps contain the query.

        Ranking is crude substring count — sufficient for in-memory codex
        inspection and consistent with the federation's no-embedding rule.
        """
        if not query:
            return []
        needle = query.lower()
        scored: list[tuple[int, ForgeMethod]] = []
        for method in self._by_id.values():
            text = (
                method.name
                + " "
                + method.description
                + " "
                + " ".join(method.steps)
            ).lower()
            if needle in text:
                # Crude relevance: how many times the needle appears.
                score = text.count(needle)
                scored.append((score, method))
        # Highest count first; ties broken by insertion order (stable sort).
        scored.sort(key=lambda t: t[0], reverse=True)
        return [method for _, method in scored[:top_k]]

    def get(self, method_id: str) -> ForgeMethod:
        """Return the method with method_id.

        Raises MemoryError if not found.
        """
        if method_id not in self._by_id:
            raise MemoryError(f"ForgeMethod {method_id!r} not found")
        return self._by_id[method_id]

    def list_by_domain(self, domain: str) -> list[ForgeMethod]:
        """Return all methods belonging to the given domain."""
        return [m for m in self._by_id.values() if m.domain == domain]

    def count(self) -> int:
        """Total number of methods in the codex."""
        return len(self._by_id)

    def clear(self) -> None:
        """Drop every method."""
        self._by_id.clear()
