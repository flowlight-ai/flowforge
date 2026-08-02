"""Tests for the multi-domain memory federation (roleagent.md §4 / P1-4).

Covers the v7.0 memory_federation module:
- MemoryCollection / MemoryEntry + mark_consumed behavior
- CollectionManager CRUD + find_by_domain
- GrepEntry substring search (grep-first, case-sensitive)
- SemanticEntry keyword-overlap fallback + injected embedding_fn
- IndexEntry tag lookup + consumption_count ordering
- RetrievalCoordinator routing
- MemoryGovernance: compute_authority / compute_weight / apply_decay
- RecencyFactor + ConsumptionWeightedRanker
- MindCodex add / search / derive_from_experience (rule-based fallback)
"""

from __future__ import annotations

import asyncio

import pytest

from flowforge.core.memory_federation import (
    CollectionManager,
    ConsumptionWeightedRanker,
    GovernanceConfig,
    GrepEntry,
    IndexEntry,
    MemoryCollection,
    MemoryEntry,
    MemoryGovernance,
    MindCodex,
    MindCodexEntry,
    RecencyFactor,
    RetrievalCoordinator,
    RetrievalEntryType,
    RetrievalRequest,
    RetrievalResult,
    SemanticEntry,
)


# ---------------------------------------------------------------------------
# Collection: MemoryEntry / MemoryCollection / CollectionManager
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_collection_manager_create_and_get() -> None:
    mgr = CollectionManager()
    coll = await mgr.create(name="python_async_patterns", domain="programming")
    assert coll.name == "python_async_patterns"
    assert coll.domain == "programming"
    assert coll.collection_id != ""

    fetched = await mgr.get(coll.collection_id)
    assert fetched is coll


@pytest.mark.asyncio
async def test_collection_manager_get_missing_returns_none() -> None:
    mgr = CollectionManager()
    assert await mgr.get("nope") is None


@pytest.mark.asyncio
async def test_collection_manager_add_entry_roundtrip() -> None:
    mgr = CollectionManager()
    coll = await mgr.create(name="python", domain="programming")
    entry = MemoryEntry(content="deploy fastapi with uvicorn workers")
    await mgr.add_entry(coll.collection_id, entry)
    assert coll.entries == [entry]
    assert entry.entry_id != ""


@pytest.mark.asyncio
async def test_collection_manager_add_entry_missing_collection_raises() -> None:
    mgr = CollectionManager()
    with pytest.raises(KeyError, match="not found"):
        await mgr.add_entry("ghost", MemoryEntry(content="x"))


@pytest.mark.asyncio
async def test_collection_manager_find_by_domain() -> None:
    mgr = CollectionManager()
    await mgr.create(name="py", domain="programming")
    await mgr.create(name="go", domain="programming")
    await mgr.create(name="tax", domain="finance")
    prog = await mgr.find_by_domain("programming")
    assert len(prog) == 2
    assert await mgr.find_by_domain("nonexistent") == []


def test_memory_entry_mark_consumed_returns_new_entry() -> None:
    entry = MemoryEntry(content="x", source="fk-a", tags=["t1"])
    consumed = entry.mark_consumed()
    assert consumed.consumption_count == 1
    assert consumed.last_accessed >= entry.last_accessed
    # Original untouched (immutable semantics).
    assert entry.consumption_count == 0
    assert consumed.entry_id == entry.entry_id


def test_memory_entry_default_fields() -> None:
    entry = MemoryEntry(content="x")
    assert entry.entry_id != ""
    assert entry.authority_level == 0.5
    assert entry.tags == []
    assert entry.source == ""
    assert entry.consumption_count == 0


def test_memory_collection_entries_are_appendable() -> None:
    coll = MemoryCollection(name="c", domain="d")
    assert coll.entries == []
    coll.entries.append(MemoryEntry(content="a"))
    assert len(coll.entries) == 1


# ---------------------------------------------------------------------------
# GrepEntry (grep-first, case-sensitive substring)
# ---------------------------------------------------------------------------


def _prog_collections() -> list[MemoryCollection]:
    return [
        MemoryCollection(
            name="python",
            domain="programming",
            entries=[
                MemoryEntry(
                    content="How to deploy fastapi with uvicorn",
                    source="fk-python",
                ),
                MemoryEntry(content="How to bake sourdough bread"),
            ],
        ),
        MemoryCollection(
            name="ops",
            domain="programming",
            entries=[
                MemoryEntry(content="fastapi on kubernetes"),
            ],
        ),
    ]


@pytest.mark.asyncio
async def test_grep_entry_substring_match_across_collections() -> None:
    grep = GrepEntry(collections=_prog_collections())
    hits = await grep.search(
        RetrievalRequest(query="fastapi", entry_type=RetrievalEntryType.GREP)
    )
    assert len(hits) == 2
    contents = {r.entry.content for r in hits}
    assert "How to deploy fastapi with uvicorn" in contents
    assert "fastapi on kubernetes" in contents


@pytest.mark.asyncio
async def test_grep_entry_is_case_sensitive() -> None:
    grep = GrepEntry(
        collections=[
            MemoryCollection(name="c", domain="d", entries=[MemoryEntry(content="Python is Fun")])
        ]
    )
    assert await grep.search(RetrievalRequest(query="python")) == []
    assert len(await grep.search(RetrievalRequest(query="Python"))) == 1


@pytest.mark.asyncio
async def test_grep_entry_no_hits_returns_empty() -> None:
    grep = GrepEntry(collections=_prog_collections())
    hits = await grep.search(RetrievalRequest(query="nonexistent"))
    assert hits == []


@pytest.mark.asyncio
async def test_grep_entry_empty_query_returns_empty() -> None:
    grep = GrepEntry(collections=_prog_collections())
    assert await grep.search(RetrievalRequest(query="")) == []


@pytest.mark.asyncio
async def test_grep_entry_domain_filter() -> None:
    grep = GrepEntry(collections=_prog_collections())
    hits = await grep.search(
        RetrievalRequest(
            query="fastapi",
            filters={"domain": "finance"},
        )
    )
    assert hits == []
    hits = await grep.search(
        RetrievalRequest(
            query="fastapi",
            filters={"domain": "programming"},
        )
    )
    assert len(hits) == 2


@pytest.mark.asyncio
async def test_grep_entry_respects_max_results() -> None:
    grep = GrepEntry(collections=_prog_collections())
    hits = await grep.search(
        RetrievalRequest(query="fastapi", max_results=1)
    )
    assert len(hits) == 1


# ---------------------------------------------------------------------------
# SemanticEntry (keyword-overlap fallback + injected embedding_fn)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_semantic_entry_keyword_overlap_fallback() -> None:
    semantic = SemanticEntry(collections=_prog_collections())
    hits = await semantic.search(
        RetrievalRequest(
            query="deploy fastapi",
            entry_type=RetrievalEntryType.SEMANTIC,
        )
    )
    assert len(hits) == 2
    # The entry matching both query terms ranks first.
    assert hits[0].entry.content == "How to deploy fastapi with uvicorn"


@pytest.mark.asyncio
async def test_semantic_entry_uses_injected_embedding_fn() -> None:
    def embedding(text: str) -> list[float]:
        # Bag-of-words pseudo-vector: {token: 1.0}
        tokens = text.lower().split()
        vector = [1.0 if tok in tokens else 0.0 for tok in ("deploy", "fastapi", "kubernetes")]
        return vector

    semantic = SemanticEntry(
        embedding_fn=embedding,
        collections=_prog_collections(),
    )
    hits = await semantic.search(
        RetrievalRequest(
            query="fastapi kubernetes",
            entry_type=RetrievalEntryType.SEMANTIC,
        )
    )
    # Content with both query vectors ranks first; bread entry scores 0.
    assert hits[0].entry.content == "fastapi on kubernetes"
    assert [r.entry.content for r in hits][-1] == "How to bake sourdough bread"


@pytest.mark.asyncio
async def test_semantic_entry_no_overlap_returns_empty() -> None:
    semantic = SemanticEntry(collections=_prog_collections())
    hits = await semantic.search(
        RetrievalRequest(
            query="quantum teleportation",
            entry_type=RetrievalEntryType.SEMANTIC,
        )
    )
    assert hits == []


# ---------------------------------------------------------------------------
# IndexEntry (tag lookup, consumption-first ordering)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_index_entry_by_tag() -> None:
    collections = [
        MemoryCollection(
            name="c",
            domain="d",
            entries=[
                MemoryEntry(content="m1", tags=["deploy", "fastapi"]),
                MemoryEntry(content="m2", tags=["deploy", "k8s"]),
                MemoryEntry(content="m3", tags=["baking"]),
            ],
        )
    ]
    index = IndexEntry(collections=collections)
    hits = await index.search(
        RetrievalRequest(query="deploy", entry_type=RetrievalEntryType.INDEX)
    )
    assert len(hits) == 2
    assert all(r.score == 1.0 for r in hits)


@pytest.mark.asyncio
async def test_index_entry_empty_tag_returns_empty() -> None:
    index = IndexEntry(collections=_prog_collections())
    assert await index.search(RetrievalRequest(query="ghost_tag")) == []


@pytest.mark.asyncio
async def test_index_entry_orders_by_consumption_count() -> None:
    collections = [
        MemoryCollection(
            name="c",
            domain="d",
            entries=[
                MemoryEntry(content="low", tags=["t"], entry_id="low", consumption_count=1),
                MemoryEntry(content="high", tags=["t"], entry_id="high", consumption_count=9),
            ],
        )
    ]
    index = IndexEntry(collections=collections)
    hits = await index.search(RetrievalRequest(query="t"))
    assert [r.entry.entry_id for r in hits] == ["high", "low"]


@pytest.mark.asyncio
async def test_index_entry_rebuilds_on_set_collections() -> None:
    index = IndexEntry()
    assert await index.search(RetrievalRequest(query="t1")) == []
    index.set_collections(
        [
            MemoryCollection(
                name="c",
                domain="d",
                entries=[MemoryEntry(content="x", tags=["t1"])],
            )
        ]
    )
    hits = await index.search(RetrievalRequest(query="t1"))
    assert len(hits) == 1


# ---------------------------------------------------------------------------
# RetrievalCoordinator routing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_coordinator_routes_grep() -> None:
    coordinator = RetrievalCoordinator()
    coordinator.update_collections(_prog_collections())
    hits = await coordinator.retrieve(
        RetrievalRequest(query="fastapi", entry_type=RetrievalEntryType.GREP)
    )
    assert len(hits) == 2


@pytest.mark.asyncio
async def test_coordinator_routes_semantic() -> None:
    coordinator = RetrievalCoordinator()
    coordinator.update_collections(_prog_collections())
    hits = await coordinator.retrieve(
        RetrievalRequest(
            query="deploy fastapi",
            entry_type=RetrievalEntryType.SEMANTIC,
        )
    )
    assert len(hits) == 2


@pytest.mark.asyncio
async def test_coordinator_routes_index() -> None:
    coordinator = RetrievalCoordinator()
    coordinator.update_collections(
        [
            MemoryCollection(
                name="c",
                domain="d",
                entries=[
                    MemoryEntry(content="sourdough recipe", tags=["baking"]),
                    MemoryEntry(content="unrelated"),
                ],
            )
        ]
    )
    hits = await coordinator.retrieve(
        RetrievalRequest(
            query="baking",
            entry_type=RetrievalEntryType.INDEX,
        )
    )
    assert len(hits) == 1
    assert hits[0].entry.tags == ["baking"]


@pytest.mark.asyncio
async def test_coordinator_defaults_to_grep() -> None:
    coordinator = RetrievalCoordinator()
    coordinator.update_collections(_prog_collections())
    hits = await coordinator.retrieve(RetrievalRequest(query="fastapi"))
    assert len(hits) == 2


# ---------------------------------------------------------------------------
# MemoryGovernance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_governance_authority_base_and_verified_source() -> None:
    governance = MemoryGovernance()
    assert await governance.compute_authority(MemoryEntry(content="x")) == pytest.approx(0.5)

    boosted = MemoryGovernance(
        GovernanceConfig(
            verified_sources=["fk-python"],
            authority_source_boost=0.2,
        )
    )
    entry = MemoryEntry(content="x", source="fk-python")
    assert await boosted.compute_authority(entry) == pytest.approx(0.7)


@pytest.mark.asyncio
async def test_governance_authority_clamped_at_one() -> None:
    governance = MemoryGovernance(
        GovernanceConfig(verified_sources=["s"], authority_source_boost=0.9)
    )
    assert await governance.compute_authority(MemoryEntry(content="x", source="s")) == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_governance_weight_scales_with_consumption() -> None:
    governance = MemoryGovernance()
    zero = await governance.compute_weight(MemoryEntry(content="x"))
    consumed = await governance.compute_weight(
        MemoryEntry(content="x", consumption_count=10)
    )
    assert zero == pytest.approx(0.0)
    assert 0.0 < consumed < 1.0
    # More consumption → higher weight.
    more = await governance.compute_weight(
        MemoryEntry(content="x", consumption_count=50)
    )
    assert more > consumed


@pytest.mark.asyncio
async def test_governance_decay_lowers_authority_over_time() -> None:
    governance = MemoryGovernance()
    old_entry = MemoryEntry(content="x", authority_level=1.0)
    old_entry.last_accessed = "2020-01-01T00:00:00+00:00"
    decayed = await governance.apply_decay(old_entry)
    assert decayed.authority_level < 1.0
    assert decayed.authority_level >= governance._config.decay_min_score


@pytest.mark.asyncio
async def test_governance_decay_is_idempotent() -> None:
    governance = MemoryGovernance()
    entry = MemoryEntry(content="x", authority_level=0.8)
    entry.last_accessed = "2020-06-01T00:00:00+00:00"
    decayed_1 = await governance.apply_decay(entry)
    decayed_2 = await governance.apply_decay(entry)
    assert decayed_1.authority_level == pytest.approx(decayed_2.authority_level)


@pytest.mark.asyncio
async def test_governance_decay_never_below_min() -> None:
    governance = MemoryGovernance()
    old_entry = MemoryEntry(content="x", authority_level=0.5)
    old_entry.last_accessed = "1999-01-01T00:00:00+00:00"
    decayed = await governance.apply_decay(old_entry)
    assert decayed.authority_level == pytest.approx(
        governance._config.decay_min_score
    )


# ---------------------------------------------------------------------------
# RecencyFactor + ConsumptionWeightedRanker
# ---------------------------------------------------------------------------


def test_recency_factor_fresh_is_one() -> None:
    factor = RecencyFactor()
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    assert factor.compute(now) == pytest.approx(1.0)


def test_recency_factor_halves_after_half_life() -> None:
    factor = RecencyFactor(half_life_days=1.0)
    # Roughly one half-life ago.
    assert factor.compute("2020-01-01T00:00:00+00:00") < 1.0


def test_recency_factor_invalid_returns_min() -> None:
    factor = RecencyFactor(min_factor=0.2)
    assert factor.compute("not-a-date") == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_ranker_unconsumed_entries_sink() -> None:
    entries = [
        MemoryEntry(content="cold", entry_id="cold", consumption_count=0),
        MemoryEntry(content="hot", entry_id="hot", consumption_count=10),
    ]
    ranked = await ConsumptionWeightedRanker().rank(entries)
    assert [e.entry_id for e in ranked] == ["hot", "cold"]


@pytest.mark.asyncio
async def test_ranker_orders_by_consumption() -> None:
    entries = [
        MemoryEntry(content="low", entry_id="low", consumption_count=1),
        MemoryEntry(content="high", entry_id="high", consumption_count=20),
        MemoryEntry(content="mid", entry_id="mid", consumption_count=5),
    ]
    ranked = await ConsumptionWeightedRanker().rank(entries)
    assert [e.entry_id for e in ranked] == ["high", "mid", "low"]


@pytest.mark.asyncio
async def test_ranker_relevance_scores_break_ties() -> None:
    entries = [
        MemoryEntry(content="a", entry_id="a", consumption_count=5),
        MemoryEntry(content="b", entry_id="b", consumption_count=5),
    ]
    ranker = ConsumptionWeightedRanker(
        relevance_scores={"a": 1.0, "b": 0.1}
    )
    ranked = await ranker.rank(entries)
    assert [e.entry_id for e in ranked] == ["a", "b"]


@pytest.mark.asyncio
async def test_ranker_does_not_mutate_input() -> None:
    entries = [
        MemoryEntry(content="a", entry_id="a", consumption_count=3),
        MemoryEntry(content="b", entry_id="b", consumption_count=1),
    ]
    original = list(entries)
    await ConsumptionWeightedRanker().rank(entries)
    assert entries == original


# ---------------------------------------------------------------------------
# MindCodex
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mind_codex_add_and_list() -> None:
    codex = MindCodex()
    entry = MindCodexEntry(
        title="deploy_fastapi",
        content="build, dockerize, deploy with uvicorn",
        domain="devops",
        skill_tags=["deploy", "fastapi"],
    )
    await codex.add_entry(entry)
    assert codex.list_entries() == [entry]
    assert entry.codex_id != ""


@pytest.mark.asyncio
async def test_mind_codex_search_title_and_content() -> None:
    codex = MindCodex()
    await codex.add_entry(
        MindCodexEntry(
            title="deploy_fastapi",
            content="Steps to deploy a FastAPI app with uvicorn",
            domain="devops",
            skill_tags=["deploy"],
        )
    )
    await codex.add_entry(
        MindCodexEntry(
            title="bake_bread",
            content="Recipe for sourdough",
            domain="food",
        )
    )
    assert len(await codex.search("fastapi")) == 1
    assert len(await codex.search("dockerize")) == 0
    assert len(await codex.search("recipe")) == 1
    assert await codex.search("nonexistent") == []


@pytest.mark.asyncio
async def test_mind_codex_search_top_k() -> None:
    codex = MindCodex()
    for i in range(10):
        await codex.add_entry(
            MindCodexEntry(
                title=f"deploy_{i}",
                content="deploy deploy deploy",
                domain="devops",
            )
        )
    hits = await codex.search("deploy", top_k=3)
    assert len(hits) == 3


@pytest.mark.asyncio
async def test_mind_codex_empty_query_returns_empty() -> None:
    codex = MindCodex()
    await codex.add_entry(MindCodexEntry(title="t", content="c"))
    assert await codex.search("") == []


@pytest.mark.asyncio
async def test_mind_codex_derive_from_experience_fallback() -> None:
    codex = MindCodex()  # no llm_client / prompts → rule-based fallback
    entry = await codex.derive_from_experience(
        {
            "title": "fixed_sql_join_bug",
            "content": "Use explicit JOIN instead of implicit comma",
            "domain": "programming",
            "skill_tags": ["sql", "joins"],
            "source_id": "episode-42",
        }
    )
    assert entry.title == "fixed_sql_join_bug"
    assert entry.domain == "programming"
    assert entry.skill_tags == ["sql", "joins"]
    assert entry.derived_from == "episode-42"
    assert entry in codex.list_entries()


@pytest.mark.asyncio
async def test_mind_codex_derive_with_llm_client_and_prompts(tmp_path) -> None:
    import yaml

    prompts_path = tmp_path / "prompts.yaml"
    prompts_path.write_text(
        yaml.safe_dump(
            {"mind_codex": {"derive_from_experience": "Distill: {title}"}},
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    class FakeLLM:
        async def complete(self, prompt: str) -> str:
            return '{"title": "distilled title", "content": "distilled content", "skill_tags": ["skill1"]}'

    codex = MindCodex(llm_client=FakeLLM(), prompts_path=prompts_path)
    entry = await codex.derive_from_experience(
        {
            "title": "raw title",
            "content": "raw content",
            "domain": "programming",
            "skill_tags": ["raw"],
            "source_id": "episode-7",
        }
    )
    assert entry.title == "distilled title"
    assert entry.derived_from == "episode-7"
    assert entry in codex.list_entries()


# ---------------------------------------------------------------------------
# RetrievalResult dataclass
# ---------------------------------------------------------------------------


def test_retrieval_result_construction() -> None:
    entry = MemoryEntry(content="x")
    result = RetrievalResult(entry=entry, score=0.85, source_collection="c1")
    assert result.entry is entry
    assert result.score == 0.85
    assert result.source_collection == "c1"


def test_retrieval_request_defaults_to_grep() -> None:
    request = RetrievalRequest(query="hello")
    assert request.entry_type is RetrievalEntryType.GREP
    assert request.max_results == 10
    assert request.filters == {}
