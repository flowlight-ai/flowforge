"""Consumption-weighted ranking — final ranker over retrieved entries.

Formula (per task spec P1-4):
    score = importance * 0.4 + recency * 0.3 + access_frequency * 0.2 + relevance * 0.1
    recency          = 1.0 - min(age_seconds / 86400, 1.0)   (decays over a day)
    access_frequency = min(access_count / 10, 1.0)
    relevance        = query_context.get("relevance", 0.5)

The ranker is a pure function over a list of entries — it does not touch the
collection. It is the last step in the pipeline:
    collection → retriever → ConsumptionWeightedRanker → agent context
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flowforge.core.memory.collection import MemoryEntry
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.memory.consumption_weighted")

_WEIGHT_IMPORTANCE = 0.4
_WEIGHT_RECENCY = 0.3
_WEIGHT_FREQUENCY = 0.2
_WEIGHT_RELEVANCE = 0.1

# Recency window: 24 hours. After one day the recency term is 0.
_RECENCY_WINDOW_SECONDS = 86400.0
# Frequency normalizer: 10 accesses saturate the frequency term.
_FREQUENCY_NORMALIZER = 10.0
# Default relevance when callers don't supply one.
_DEFAULT_RELEVANCE = 0.5


class ConsumptionWeightedRanker:
    """Rank memory entries by the consumption-weighted score."""

    def rank(
        self,
        entries: list[MemoryEntry],
        query_context: dict[str, Any],
    ) -> list[MemoryEntry]:
        """Return entries sorted by descending consumption-weighted score.

        Ties (rare, since timestamps differ) preserve insertion order via
        Python's stable sort.
        """
        relevance = float(query_context.get("relevance", _DEFAULT_RELEVANCE))
        now = datetime.now(timezone.utc)
        scored: list[tuple[float, MemoryEntry]] = []
        for entry in entries:
            age_seconds = max(0.0, (now - entry.created_at).total_seconds())
            recency = 1.0 - min(age_seconds / _RECENCY_WINDOW_SECONDS, 1.0)
            access_frequency = min(
                entry.access_count / _FREQUENCY_NORMALIZER, 1.0
            )
            score = (
                entry.importance * _WEIGHT_IMPORTANCE
                + recency * _WEIGHT_RECENCY
                + access_frequency * _WEIGHT_FREQUENCY
                + relevance * _WEIGHT_RELEVANCE
            )
            scored.append((score, entry))
        scored.sort(key=lambda t: t[0], reverse=True)
        if scored:
            logger.debug(
                f"ranker: ranked={len(scored)} "
                f"top_score={scored[0][0]:.4f} "
                f"relevance={relevance}"
            )
        return [entry for _, entry in scored]
