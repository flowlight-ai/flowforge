"""Three retrieval entries into a MemoryCollection (P1-4).

Per task.md P1-4 the federation exposes three independent retrieval paths:
- GrepRetriever     — substring match (deterministic)
- SemanticRetriever — TF-IDF cosine similarity (no external embedding)
- IndexRetriever    — tag index lookup

All retrievers are async (I/O-shaped, even when computation is local) so they
slot into the async agent loop without surprise. Each retriever calls
MemoryEntry.touch() on hits so access_count / last_accessed stay current —
this feeds ConsumptionWeightedRanker.access_frequency downstream.

RetrievalResult is the public dataclass for callers that need the score and
matched_by provenance alongside the entry.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from typing import Literal

from flowforge.core.memory.collection import MemoryCollection, MemoryEntry
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.memory.retrieval_entries")


RetrievalMatchedBy = Literal["grep", "semantic", "index"]


@dataclass
class RetrievalResult:
    """One scored hit returned by a retriever.

    entry      — the matched MemoryEntry
    score      — retriever-specific score (0.0..1.0 for semantic; 1.0 for
                 grep hits; tag-overlap ratio for index)
    matched_by — which retriever produced this hit
    """

    entry: MemoryEntry
    score: float
    matched_by: RetrievalMatchedBy


def _tokenize(text: str) -> list[str]:
    """Lowercase + whitespace split. No stopword removal, no stemming."""
    return [t for t in text.lower().split() if t]


class GrepRetriever:
    """Substring match over entry.content (case-insensitive)."""

    async def search(
        self,
        query: str,
        collection: MemoryCollection,
    ) -> list[MemoryEntry]:
        """Return every entry whose content contains the query substring."""
        if not query:
            return []
        needle = query.lower()
        hits = [e for e in collection.all() if needle in e.content.lower()]
        for hit in hits:
            hit.touch()
        logger.debug(f"grep: q={query!r} hits={len(hits)}")
        return hits


class SemanticRetriever:
    """TF-IDF cosine similarity retriever (no external embedding).

    Builds the IDF table on the fly over the whole collection for each query
    — fine for in-memory collections up to a few thousand entries. The
    smoothed IDF formula `log((1+n) / (1+df)) + 1` (sklearn-style) ensures
    that even query tokens appearing in every document retain a non-zero
    IDF, so degenerate "common term" queries still return ranked hits
    instead of an empty result.
    """

    async def search(
        self,
        query: str,
        collection: MemoryCollection,
        top_k: int = 5,
    ) -> list[MemoryEntry]:
        """Return the top_k entries ranked by TF-IDF cosine similarity."""
        entries = collection.all()
        if not entries or not query.strip():
            return []
        docs = [_tokenize(e.content) for e in entries]
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        # Smoothed IDF over the collection (sklearn-style: +1 ensures a
        # term appearing in every doc still has non-zero weight).
        n_docs = len(docs)
        df: Counter[str] = Counter()
        for tokens in docs:
            for token in set(tokens):
                df[token] += 1
        idf: dict[str, float] = {
            t: math.log((1 + n_docs) / (1 + d)) + 1.0 for t, d in df.items()
        }

        # Query TF-IDF vector.
        q_counts = Counter(query_tokens)
        q_vec: dict[str, float] = {
            t: q_counts[t] * idf.get(t, 0.0) for t in q_counts
        }
        q_norm = math.sqrt(sum(v * v for v in q_vec.values())) or 1.0

        # Score each doc by cosine similarity against the query.
        results: list[RetrievalResult] = []
        for entry, tokens in zip(entries, docs):
            if not tokens:
                continue
            d_counts = Counter(tokens)
            d_vec: dict[str, float] = {
                t: d_counts[t] * idf.get(t, 0.0) for t in d_counts
            }
            d_norm = math.sqrt(sum(v * v for v in d_vec.values())) or 1.0
            shared = q_vec.keys() & d_vec.keys()
            dot = sum(q_vec[t] * d_vec[t] for t in shared)
            cosine = dot / (q_norm * d_norm) if (q_norm and d_norm) else 0.0
            if cosine > 0.0:
                results.append(
                    RetrievalResult(
                        entry=entry, score=cosine, matched_by="semantic"
                    )
                )
        results.sort(key=lambda r: r.score, reverse=True)
        top = results[:top_k]
        for r in top:
            r.entry.touch()
        logger.debug(f"semantic: q={query!r} hits={len(top)}")
        return [r.entry for r in top]


class IndexRetriever:
    """Tag-index lookup — returns entries matching ANY of the given tags."""

    async def search(
        self,
        tags: list[str],
        collection: MemoryCollection,
    ) -> list[MemoryEntry]:
        """Return entries that carry at least one of the requested tags."""
        if not tags:
            return []
        hits = collection.list_by_tags(tags)
        for hit in hits:
            hit.touch()
        logger.debug(f"index: tags={tags} hits={len(hits)}")
        return hits
