"""Tests for the multi-domain memory federation (Phase 1 / P1-4).

Covers:
- MemoryCollection add / get / list_by_domain / list_by_tags / count
- GrepRetriever substring match
- SemanticRetriever TF-IDF cosine ranking
- IndexRetriever tag lookup
- RetentionPolicy (size cap + age + importance)
- DecayPolicy importance decay
- ConflictResolver (highest importance + most recent)
- MemoryGovernor.detect_conflicts
- ConsumptionWeightedRanker (importance / recency / access_count)
- MindCodex add / search / get / list_by_domain
- RetrievalResult dataclass
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from flowforge.core.errors import MemoryError
from flowforge.core.memory import (
    ConsumptionWeightedRanker,
    ConflictResolver,
    DecayPolicy,
    ForgeMethod,
    GrepRetriever,
    IndexRetriever,
    MemoryCollection,
    MemoryDomain,
    MemoryEntry,
    MemoryGovernor,
    MindCodex,
    RetrievalResult,
    RetentionPolicy,
    SemanticRetriever,
)


# ---------------------------------------------------------------------------
# MemoryCollection
# ---------------------------------------------------------------------------


def test_memory_collection_add_get_roundtrip() -> None:
    coll = MemoryCollection()
    entry = MemoryEntry(content="hello world", domain=MemoryDomain.SEMANTIC)
    entry_id = coll.add(entry)
    assert entry_id == entry.entry_id
    fetched = coll.get(entry_id)
    assert fetched.content == "hello world"
    assert fetched.domain == MemoryDomain.SEMANTIC
    # get() touches access metadata.
    assert fetched.access_count >= 1
    assert fetched.last_accessed is not None


def test_memory_collection_get_missing_raises() -> None:
    coll = MemoryCollection()
    with pytest.raises(MemoryError, match="not found"):
        coll.get("nope")


def test_memory_collection_add_duplicate_raises() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="a", entry_id="dup-1"))
    with pytest.raises(MemoryError, match="already exists"):
        coll.add(MemoryEntry(content="b", entry_id="dup-1"))


def test_memory_collection_add_empty_content_raises() -> None:
    coll = MemoryCollection()
    with pytest.raises(MemoryError, match="non-empty content"):
        coll.add(MemoryEntry(content=""))


def test_memory_collection_importance_is_clamped() -> None:
    coll = MemoryCollection()
    entry = MemoryEntry(content="x", importance=2.5)
    coll.add(entry)
    assert entry.importance == 1.0
    entry_neg = MemoryEntry(content="y", importance=-0.3)
    coll.add(entry_neg)
    assert entry_neg.importance == 0.0


def test_memory_collection_list_by_domain() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="s1", domain=MemoryDomain.SEMANTIC))
    coll.add(MemoryEntry(content="s2", domain=MemoryDomain.SEMANTIC))
    coll.add(MemoryEntry(content="e1", domain=MemoryDomain.EPISODIC))
    # Accepts either MemoryDomain or its string value.
    assert len(coll.list_by_domain(MemoryDomain.SEMANTIC.value)) == 2
    assert len(coll.list_by_domain(MemoryDomain.SEMANTIC)) == 2
    assert len(coll.list_by_domain(MemoryDomain.EPISODIC.value)) == 1
    # Unknown domain returns empty list (not error).
    assert coll.list_by_domain("nonexistent_domain") == []


def test_memory_collection_list_by_tags() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="t1", tags=["alpha", "beta"]))
    coll.add(MemoryEntry(content="t2", tags=["beta", "gamma"]))
    coll.add(MemoryEntry(content="t3", tags=["delta"]))
    assert len(coll.list_by_tags(["alpha"])) == 1
    assert len(coll.list_by_tags(["beta"])) == 2  # t1 + t2
    # Multi-tag query is a union (deduplicated).
    multi = coll.list_by_tags(["alpha", "gamma"])
    assert len(multi) == 2
    assert coll.list_by_tags([]) == []


def test_memory_collection_count() -> None:
    coll = MemoryCollection()
    assert coll.count() == 0
    coll.add(MemoryEntry(content="a"))
    coll.add(MemoryEntry(content="b"))
    assert coll.count() == 2


def test_memory_collection_remove_keeps_indices_in_sync() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="m1", entry_id="m1", tags=["t1"]))
    coll.add(MemoryEntry(content="m2", entry_id="m2", tags=["t1"]))
    coll.remove("m1")
    assert coll.count() == 1
    assert len(coll.list_by_tags(["t1"])) == 1
    assert coll.list_by_tags(["t1"])[0].entry_id == "m2"


# ---------------------------------------------------------------------------
# GrepRetriever
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grep_retriever_substring_match() -> None:
    coll = MemoryCollection()
    coll.add(
        MemoryEntry(content="How to deploy fastapi", domain=MemoryDomain.PROCEDURAL)
    )
    coll.add(MemoryEntry(content="How to bake bread"))
    coll.add(MemoryEntry(content="fastapi is great"))
    retriever = GrepRetriever()
    hits = await retriever.search("fastapi", coll)
    assert len(hits) == 2
    contents = {h.content for h in hits}
    assert "How to deploy fastapi" in contents
    assert "fastapi is great" in contents


@pytest.mark.asyncio
async def test_grep_retriever_is_case_insensitive() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="Python is Fun"))
    hits = await GrepRetriever().search("python", coll)
    assert len(hits) == 1


@pytest.mark.asyncio
async def test_grep_retriever_no_hits() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="hello"))
    hits = await GrepRetriever().search("nonexistent", coll)
    assert hits == []


@pytest.mark.asyncio
async def test_grep_retriever_empty_query_returns_empty() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="hello"))
    hits = await GrepRetriever().search("", coll)
    assert hits == []


@pytest.mark.asyncio
async def test_grep_retriever_touches_access_count() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="match me", entry_id="m"))
    before = coll.get("m").access_count
    await GrepRetriever().search("match", coll)
    after = coll.all()[0].access_count
    assert after == before + 1


# ---------------------------------------------------------------------------
# SemanticRetriever
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_semantic_retriever_orders_by_relevance() -> None:
    coll = MemoryCollection()
    coll.add(
        MemoryEntry(
            content="fastapi deployment tutorial with uvicorn workers",
            domain=MemoryDomain.PROCEDURAL,
        )
    )
    coll.add(
        MemoryEntry(
            content="baking sourdough bread at home recipe",
            domain=MemoryDomain.PROCEDURAL,
        )
    )
    coll.add(
        MemoryEntry(
            content="how to deploy fastapi on kubernetes with uvicorn",
            domain=MemoryDomain.PROCEDURAL,
        )
    )
    hits = await SemanticRetriever().search(
        "deploy fastapi uvicorn", coll, top_k=2
    )
    assert len(hits) == 2
    # The doc that matches all three query tokens ranks first.
    assert "deploy fastapi on kubernetes" in hits[0].content
    # The bread entry is not in the top hits.
    assert all("bread" not in h.content for h in hits)


@pytest.mark.asyncio
async def test_semantic_retriever_no_hits_returns_empty() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="alpha beta gamma"))
    hits = await SemanticRetriever().search("zzz nomatch", coll)
    assert hits == []


@pytest.mark.asyncio
async def test_semantic_retriever_empty_collection() -> None:
    coll = MemoryCollection()
    hits = await SemanticRetriever().search("anything", coll)
    assert hits == []


@pytest.mark.asyncio
async def test_semantic_retriever_respects_top_k() -> None:
    coll = MemoryCollection()
    for i in range(10):
        coll.add(
            MemoryEntry(
                content=f"fastapi deployment recipe number {i}",
                domain=MemoryDomain.PROCEDURAL,
            )
        )
    hits = await SemanticRetriever().search("fastapi", coll, top_k=3)
    assert len(hits) == 3


# ---------------------------------------------------------------------------
# IndexRetriever
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_index_retriever_by_tag() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="m1", tags=["deploy", "fastapi"]))
    coll.add(MemoryEntry(content="m2", tags=["deploy", "k8s"]))
    coll.add(MemoryEntry(content="m3", tags=["baking"]))
    hits = await IndexRetriever().search(["deploy"], coll)
    assert len(hits) == 2
    hits_multi = await IndexRetriever().search(["deploy", "baking"], coll)
    assert len(hits_multi) == 3  # union


@pytest.mark.asyncio
async def test_index_retriever_empty_tags_returns_empty() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="m1", tags=["t1"]))
    hits = await IndexRetriever().search([], coll)
    assert hits == []


# ---------------------------------------------------------------------------
# Governance: RetentionPolicy
# ---------------------------------------------------------------------------


def test_retention_policy_evicts_low_importance() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="keep", importance=0.9))
    coll.add(MemoryEntry(content="drop1", importance=0.1))
    coll.add(MemoryEntry(content="drop2", importance=0.05))
    removed = MemoryGovernor().apply_retention(
        coll, RetentionPolicy(min_importance=0.5)
    )
    assert removed == 2
    assert coll.count() == 1
    assert coll.all()[0].content == "keep"


def test_retention_policy_evicts_oldest_when_over_max_entries() -> None:
    coll = MemoryCollection()
    e1 = MemoryEntry(content="old_low", importance=0.2, entry_id="e1")
    e1.created_at = datetime.now(timezone.utc) - timedelta(hours=10)
    coll.add(e1)
    e2 = MemoryEntry(content="mid", importance=0.5, entry_id="e2")
    coll.add(e2)
    e3 = MemoryEntry(content="high", importance=0.9, entry_id="e3")
    coll.add(e3)
    removed = MemoryGovernor().apply_retention(
        coll, RetentionPolicy(max_entries=2)
    )
    assert removed == 1
    assert coll.count() == 2
    remaining_ids = {e.entry_id for e in coll.all()}
    # Lowest-importance entry is evicted.
    assert "e1" not in remaining_ids
    assert "e2" in remaining_ids
    assert "e3" in remaining_ids


def test_retention_policy_evicts_by_age() -> None:
    coll = MemoryCollection()
    e1 = MemoryEntry(content="old", importance=0.9, entry_id="e1")
    e1.created_at = datetime.now(timezone.utc) - timedelta(seconds=7200)
    coll.add(e1)
    e2 = MemoryEntry(content="fresh", importance=0.9, entry_id="e2")
    coll.add(e2)
    removed = MemoryGovernor().apply_retention(
        coll, RetentionPolicy(max_age_seconds=3600)
    )
    assert removed == 1
    assert coll.count() == 1
    assert coll.all()[0].content == "fresh"


def test_retention_policy_no_op_when_within_caps() -> None:
    coll = MemoryCollection()
    coll.add(MemoryEntry(content="a", importance=0.5))
    removed = MemoryGovernor().apply_retention(
        coll, RetentionPolicy(max_entries=10, min_importance=0.0)
    )
    assert removed == 0
    assert coll.count() == 1


# ---------------------------------------------------------------------------
# Governance: DecayPolicy
# ---------------------------------------------------------------------------


def test_decay_policy_lowers_importance_for_old_entries() -> None:
    coll = MemoryCollection()
    e1 = MemoryEntry(content="old", importance=1.0, entry_id="e1")
    e1.created_at = datetime.now(timezone.utc) - timedelta(seconds=7200)
    coll.add(e1)
    e2 = MemoryEntry(content="fresh", importance=1.0, entry_id="e2")
    coll.add(e2)
    MemoryGovernor().apply_decay(
        coll, DecayPolicy(decay_rate=0.5, decay_interval_seconds=3600)
    )
    assert coll.get("e1").importance == pytest.approx(0.5)
    # Fresh entry (younger than interval) is not decayed.
    assert coll.get("e2").importance == pytest.approx(1.0)


def test_decay_policy_respects_interval_for_fresh_entries() -> None:
    coll = MemoryCollection()
    e1 = MemoryEntry(content="fresh", importance=1.0, entry_id="e1")
    coll.add(e1)
    MemoryGovernor().apply_decay(
        coll, DecayPolicy(decay_rate=0.5, decay_interval_seconds=3600)
    )
    assert coll.get("e1").importance == pytest.approx(1.0)


def test_decay_policy_never_drops_below_zero() -> None:
    coll = MemoryCollection()
    e1 = MemoryEntry(content="old", importance=0.01, entry_id="e1")
    e1.created_at = datetime.now(timezone.utc) - timedelta(seconds=7200)
    coll.add(e1)
    MemoryGovernor().apply_decay(
        coll, DecayPolicy(decay_rate=0.1, decay_interval_seconds=3600)
    )
    assert coll.get("e1").importance == pytest.approx(0.001)


# ---------------------------------------------------------------------------
# Governance: ConflictResolver + detect_conflicts
# ---------------------------------------------------------------------------


def test_conflict_resolver_picks_highest_importance() -> None:
    e1 = MemoryEntry(content="a", importance=0.5, entry_id="a")
    e2 = MemoryEntry(content="b", importance=0.9, entry_id="b")
    e3 = MemoryEntry(content="c", importance=0.7, entry_id="c")
    winner = ConflictResolver().resolve([e1, e2, e3])
    assert winner.entry_id == "b"


def test_conflict_resolver_ties_broken_by_most_recent() -> None:
    older = MemoryEntry(content="a", importance=0.5, entry_id="a")
    older.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    newer = MemoryEntry(content="b", importance=0.5, entry_id="b")
    newer.created_at = datetime.now(timezone.utc)
    winner = ConflictResolver().resolve([older, newer])
    assert winner.entry_id == "b"


def test_conflict_resolver_empty_raises() -> None:
    with pytest.raises(ValueError):
        ConflictResolver().resolve([])


def test_detect_conflicts_groups_by_domain_and_tag_set() -> None:
    coll = MemoryCollection()
    coll.add(
        MemoryEntry(content="a", domain=MemoryDomain.SEMANTIC, tags=["t1", "t2"])
    )
    # Same domain, same tag set (order-independent) → conflict.
    coll.add(
        MemoryEntry(content="b", domain=MemoryDomain.SEMANTIC, tags=["t2", "t1"])
    )
    # Different domain → no conflict.
    coll.add(
        MemoryEntry(content="c", domain=MemoryDomain.EPISODIC, tags=["t1"])
    )
    # Same domain, different tag set → no conflict.
    coll.add(
        MemoryEntry(content="d", domain=MemoryDomain.SEMANTIC, tags=["t3"])
    )
    conflicts = MemoryGovernor().detect_conflicts(coll)
    assert len(conflicts) == 1
    assert len(conflicts[0]) == 2


# ---------------------------------------------------------------------------
# ConsumptionWeightedRanker
# ---------------------------------------------------------------------------


def test_ranker_orders_by_importance() -> None:
    entries = [
        MemoryEntry(content="low", importance=0.1, entry_id="low"),
        MemoryEntry(content="high", importance=0.95, entry_id="high"),
        MemoryEntry(content="mid", importance=0.5, entry_id="mid"),
    ]
    ranked = ConsumptionWeightedRanker().rank(entries, {"relevance": 0.5})
    assert [e.entry_id for e in ranked] == ["high", "mid", "low"]


def test_ranker_high_access_count_wins_when_importance_equal() -> None:
    now = datetime.now(timezone.utc)
    e_low_access = MemoryEntry(content="a", importance=0.5, entry_id="a")
    e_low_access.access_count = 1
    e_low_access.created_at = now
    e_high_access = MemoryEntry(content="b", importance=0.5, entry_id="b")
    e_high_access.access_count = 10
    e_high_access.created_at = now
    ranked = ConsumptionWeightedRanker().rank(
        [e_low_access, e_high_access], {"relevance": 0.5}
    )
    assert ranked[0].entry_id == "b"


def test_ranker_recency_wins_when_importance_equal() -> None:
    old = MemoryEntry(content="old", importance=0.5, entry_id="old")
    old.created_at = datetime.now(timezone.utc) - timedelta(hours=48)
    old.access_count = 5
    fresh = MemoryEntry(content="fresh", importance=0.5, entry_id="fresh")
    fresh.created_at = datetime.now(timezone.utc)
    fresh.access_count = 5
    ranked = ConsumptionWeightedRanker().rank(
        [old, fresh], {"relevance": 0.5}
    )
    assert ranked[0].entry_id == "fresh"


def test_ranker_uses_default_relevance_when_not_provided() -> None:
    entries = [MemoryEntry(content="a", importance=0.5, entry_id="a")]
    ranked = ConsumptionWeightedRanker().rank(entries, {})
    assert len(ranked) == 1


def test_ranker_uses_relevance_from_query_context() -> None:
    # Identical entries except relevance — does not change order, but the
    # function must accept the relevance key without error.
    entries = [
        MemoryEntry(content="a", importance=0.5, entry_id="a"),
        MemoryEntry(content="b", importance=0.5, entry_id="b"),
    ]
    ranked = ConsumptionWeightedRanker().rank(entries, {"relevance": 0.9})
    assert len(ranked) == 2


# ---------------------------------------------------------------------------
# MindCodex
# ---------------------------------------------------------------------------


def test_mind_codex_add_search_get() -> None:
    codex = MindCodex()
    m1 = ForgeMethod(
        name="deploy_fastapi",
        domain="devops",
        description="Steps to deploy a FastAPI app with uvicorn",
        steps=["build", "dockerize", "deploy"],
        preconditions=["docker installed"],
        postconditions=["app reachable"],
    )
    m1_id = codex.add_method(m1)
    assert m1_id == m1.method_id

    fetched = codex.get(m1_id)
    assert fetched.name == "deploy_fastapi"
    assert fetched.domain == "devops"

    # Search by keyword in name.
    assert len(codex.search("fastapi")) == 1
    # Search by keyword in steps.
    assert len(codex.search("dockerize")) == 1
    # No hits.
    assert codex.search("nonexistent") == []


def test_mind_codex_list_by_domain() -> None:
    codex = MindCodex()
    codex.add_method(ForgeMethod(name="m1", domain="devops", description="x"))
    codex.add_method(ForgeMethod(name="m2", domain="devops", description="y"))
    codex.add_method(ForgeMethod(name="m3", domain="content", description="z"))
    assert len(codex.list_by_domain("devops")) == 2
    assert codex.list_by_domain("nonexistent") == []


def test_mind_codex_get_missing_raises() -> None:
    codex = MindCodex()
    with pytest.raises(MemoryError, match="not found"):
        codex.get("nope")


def test_mind_codex_add_duplicate_raises() -> None:
    codex = MindCodex()
    codex.add_method(ForgeMethod(name="m1", domain="d", method_id="dup"))
    with pytest.raises(MemoryError, match="already exists"):
        codex.add_method(ForgeMethod(name="m2", domain="d", method_id="dup"))


def test_mind_codex_add_empty_name_raises() -> None:
    codex = MindCodex()
    with pytest.raises(MemoryError, match="non-empty name"):
        codex.add_method(ForgeMethod(name="", domain="d"))


def test_mind_codex_add_empty_domain_raises() -> None:
    codex = MindCodex()
    with pytest.raises(MemoryError, match="non-empty domain"):
        codex.add_method(ForgeMethod(name="m1", domain=""))


def test_mind_codex_search_top_k() -> None:
    codex = MindCodex()
    for i in range(10):
        codex.add_method(
            ForgeMethod(
                name=f"deploy_{i}",
                domain="devops",
                description="deploy deploy deploy",
            )
        )
    hits = codex.search("deploy", top_k=3)
    assert len(hits) == 3


def test_mind_codex_success_rate_clamped() -> None:
    codex = MindCodex()
    m = ForgeMethod(name="m1", domain="d", success_rate=2.5)
    codex.add_method(m)
    assert m.success_rate == 1.0


# ---------------------------------------------------------------------------
# RetrievalResult dataclass
# ---------------------------------------------------------------------------


def test_retrieval_result_dataclass_construction() -> None:
    entry = MemoryEntry(content="x")
    result = RetrievalResult(entry=entry, score=0.85, matched_by="grep")
    assert result.entry is entry
    assert result.score == 0.85
    assert result.matched_by == "grep"
