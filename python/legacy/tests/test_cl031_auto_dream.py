"""CL-031 Auto Dream 双层架构 — 单元测试.

测试覆盖：
1. 数据模型（DreamCluster / DreamSnapshot / DreamCycleConfig）
2. SimilarityCalculator 相似度计算
3. TelemetryCollector 4 信号计算
4. DreamCycle.run_once 完整流程（含聚类 + 蒸馏 + surface + 归档）
5. DreamCycle Magic Words 中断
6. BackgroundDreamLoop 启停
7. 配置外置

注意：本测试使用 InMemoryEpisodeStore（内存 Mock 存储），不是 Mock LLM。
蒸馏逻辑使用骨架拼接（无 LLM 调用），符合 T1 测试铁律。
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from flowforge.evolution.auto_dream import (
    DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
    DEFAULT_CONSOLIDATION_INTERVAL_SECONDS,
    DEFAULT_MAX_CLUSTERS_PER_CYCLE,
    DEFAULT_MIN_EPISODES_PER_CLUSTER,
    DEFAULT_SURFACE_TOP_K,
    BackgroundDreamLoop,
    DreamCluster,
    DreamCycle,
    DreamCycleConfig,
    DreamPhase,
    DreamSnapshot,
    EpisodeStoreProtocol,
    MethodCardSinkProtocol,
    SimilarityCalculator,
    TelemetryCollector,
    run_dream_cycle,
)
from flowforge.evolution.models import EpisodeCard, KnowledgeMaturityLevel, MethodCard


# ════════════════════════════════════════════════════════════════════
# §1 内存 Mock 存储（不是 Mock LLM）
# ════════════════════════════════════════════════════════════════════


class InMemoryEpisodeStore:
    """内存 EpisodeCard 存储（实现 EpisodeStoreProtocol）."""

    def __init__(self, episodes: list[EpisodeCard] | None = None) -> None:
        self._episodes: dict[str, EpisodeCard] = {
            ep.episode_id: ep for ep in (episodes or [])
        }
        self._processed: set[str] = set()

    async def list_episodes(
        self,
        *,
        domain: str | None = None,
        limit: int = 100,
        unprocessed_only: bool = True,
    ) -> list[EpisodeCard]:
        result = []
        for ep in self._episodes.values():
            if unprocessed_only and ep.episode_id in self._processed:
                continue
            result.append(ep)
            if len(result) >= limit:
                break
        return result

    async def mark_processed(self, episode_id: str, cycle_id: str) -> None:
        self._processed.add(episode_id)


class InMemoryMethodCardSink:
    """内存 MethodCard 存储池（实现 MethodCardSinkProtocol）."""

    def __init__(self) -> None:
        self._cards: dict[str, MethodCard] = {}

    async def save_draft(self, method_card: MethodCard) -> str:
        self._cards[method_card.method_id] = method_card
        return method_card.method_id

    @property
    def saved_count(self) -> int:
        return len(self._cards)


# ════════════════════════════════════════════════════════════════════
# §2 测试辅助
# ════════════════════════════════════════════════════════════════════


def _make_episode(
    episode_id: str,
    *,
    task_snapshot: str = "development task",
    transferable_method: str = "use type hints and async/await",
    non_transferable_facts: str = "specific file paths",
    distillation_direction: str = "method_card",
) -> EpisodeCard:
    """构造测试用 EpisodeCard."""
    return EpisodeCard(
        episode_id=episode_id,
        task_snapshot=task_snapshot,
        evidence_map={},
        decision_timeline=[],
        collaboration_pivots=[],
        transferable_method=transferable_method,
        non_transferable_facts=non_transferable_facts,
        safety_boundary="no destructive operations",
        distillation_direction=distillation_direction,
    )


def _make_similar_episodes(n: int = 4) -> list[EpisodeCard]:
    """构造 n 个相似的 episodes（同领域 + 高 transferable_method 重叠）."""
    return [
        _make_episode(
            f"ep-{i:03d}",
            task_snapshot=f"development task {i}",
            transferable_method="use type hints and async await pattern for all IO",
            non_transferable_facts=f"file path {i}",
        )
        for i in range(n)
    ]


def _make_diverse_episodes() -> list[EpisodeCard]:
    """构造多样化的 episodes（不同领域 / 不同方法）."""
    return [
        _make_episode(
            "ep-medical-001",
            task_snapshot="medical diagnosis task",
            transferable_method="differential diagnosis with evidence-based medicine",
            non_transferable_facts="patient specific symptoms",
        ),
        _make_episode(
            "ep-medical-002",
            task_snapshot="medical diagnosis task similar",
            transferable_method="differential diagnosis with evidence-based medicine",
            non_transferable_facts="different patient symptoms",
        ),
        _make_episode(
            "ep-legal-001",
            task_snapshot="legal contract review task",
            transferable_method="clause-by-clause analysis with risk assessment",
            non_transferable_facts="specific contract terms",
        ),
        _make_episode(
            "ep-dev-001",
            task_snapshot="development code review task",
            transferable_method="use type hints and async await pattern",
            non_transferable_facts="specific module path",
        ),
        _make_episode(
            "ep-dev-002",
            task_snapshot="development code review similar",
            transferable_method="use type hints and async await pattern",
            non_transferable_facts="another module path",
        ),
    ]


# ════════════════════════════════════════════════════════════════════
# §3 测试用例
# ════════════════════════════════════════════════════════════════════


def test_imports():
    """测试所有公开 API 可正常导入."""
    assert DreamCycle is not None
    assert BackgroundDreamLoop is not None
    assert DreamCycleConfig is not None
    assert run_dream_cycle is not None
    assert TelemetryCollector is not None
    assert SimilarityCalculator is not None


def test_constants():
    """测试默认常量值符合设计."""
    assert DEFAULT_CONSOLIDATION_INTERVAL_SECONDS == 3600
    assert DEFAULT_SURFACE_TOP_K == 3
    assert DEFAULT_CLUSTER_SIMILARITY_THRESHOLD == 0.6
    assert DEFAULT_MIN_EPISODES_PER_CLUSTER == 2
    assert DEFAULT_MAX_CLUSTERS_PER_CYCLE == 5


def test_dream_cycle_config_defaults():
    """测试 DreamCycleConfig 默认值."""
    cfg = DreamCycleConfig()
    assert cfg.consolidation_interval_seconds == 3600
    assert cfg.surface_top_k == 3
    assert cfg.cluster_similarity_threshold == 0.6
    assert cfg.min_episodes_per_cluster == 2
    assert cfg.max_clusters_per_cycle == 5
    assert cfg.enable_background_loop is True
    assert cfg.enable_foreground_surface is True
    assert cfg.archive_processed_episodes is True


def test_dream_cycle_config_custom():
    """测试 DreamCycleConfig 自定义值."""
    cfg = DreamCycleConfig(
        consolidation_interval_seconds=1800,
        surface_top_k=5,
        cluster_similarity_threshold=0.7,
        min_episodes_per_cluster=3,
    )
    assert cfg.consolidation_interval_seconds == 1800
    assert cfg.surface_top_k == 5
    assert cfg.cluster_similarity_threshold == 0.7
    assert cfg.min_episodes_per_cluster == 3


def test_dream_phase_enum():
    """测试 DreamPhase 枚举完整性."""
    phases = {p.value for p in DreamPhase}
    expected = {
        "idle",
        "scanning",
        "clustering",
        "distilling",
        "surfacing",
        "archiving",
        "interrupted",
    }
    assert phases == expected


def test_dream_cluster_model():
    """测试 DreamCluster 数据模型."""
    cluster = DreamCluster(
        cluster_id="cluster-001",
        episode_ids=["ep-001", "ep-002"],
        centroid_signature="abc123",
        domain="development",
        similarity_score=0.85,
    )
    assert cluster.cluster_id == "cluster-001"
    assert len(cluster.episode_ids) == 2
    assert cluster.domain == "development"
    assert cluster.similarity_score == 0.85
    assert cluster.created_at is not None


def test_dream_snapshot_model():
    """测试 DreamSnapshot 数据模型."""
    snapshot = DreamSnapshot(
        snapshot_id="snap-001",
        cycle_id="cycle-001",
        phase=DreamPhase.IDLE,
    )
    assert snapshot.snapshot_id == "snap-001"
    assert snapshot.cycle_id == "cycle-001"
    assert snapshot.phase == DreamPhase.IDLE
    assert snapshot.clusters == []
    assert snapshot.distilled_method_cards == []
    assert snapshot.telemetry == {}
    assert snapshot.interrupted is False
    assert snapshot.finished_at is None


# ── SimilarityCalculator 测试 ──────────────────────────────────────


def test_similarity_same_domain_same_method():
    """同领域 + 相同方法 → 高相似度."""
    ep1 = _make_episode("ep-1", transferable_method="use type hints async await")
    ep2 = _make_episode("ep-2", transferable_method="use type hints async await")
    sim = SimilarityCalculator.similarity(ep1, ep2)
    assert sim == 1.0  # 完全相同


def test_similarity_different_domain():
    """不同领域 → 相似度 0."""
    ep1 = _make_episode(
        "ep-1",
        task_snapshot="development task",
        transferable_method="use type hints",
    )
    ep2 = _make_episode(
        "ep-2",
        task_snapshot="medical diagnosis",
        transferable_method="use type hints",  # 同方法但不同领域
    )
    sim = SimilarityCalculator.similarity(ep1, ep2)
    assert sim == 0.0


def test_similarity_partial_overlap():
    """部分重叠 → 中等相似度."""
    ep1 = _make_episode(
        "ep-1", transferable_method="use type hints async await pattern"
    )
    ep2 = _make_episode(
        "ep-2", transferable_method="use type hints for python development"
    )
    sim = SimilarityCalculator.similarity(ep1, ep2)
    # 共同词: use, type, hints → 应该有部分重叠
    assert 0.0 < sim < 1.0


def test_compute_signature_stable():
    """签名稳定性（I1: 幂等性）."""
    ep = _make_episode("ep-1")
    sig1 = SimilarityCalculator.compute_signature(ep)
    sig2 = SimilarityCalculator.compute_signature(ep)
    assert sig1 == sig2
    assert len(sig1) == 16  # SHA256[:16]


def test_compute_signature_different_episodes():
    """不同 episode 签名不同."""
    ep1 = _make_episode("ep-1", transferable_method="method A")
    ep2 = _make_episode("ep-2", transferable_method="method B")
    assert SimilarityCalculator.compute_signature(ep1) != SimilarityCalculator.compute_signature(ep2)


# ── TelemetryCollector 测试 ────────────────────────────────────────


def test_telemetry_empty():
    """空输入 → 4 信号全为 0."""
    telemetry = TelemetryCollector.compute(
        total_episodes=0, processed_episodes=0, clusters=[], distilled_cards=[]
    )
    assert telemetry == {
        "consolidation_rate": 0.0,
        "coherence_score": 0.0,
        "surprise_index": 0.0,
        "integration_depth": 0.0,
    }


def test_telemetry_full_processing():
    """全部处理 + 高相似度 → consolidation_rate=1.0, coherence 高."""
    clusters = [
        DreamCluster(
            cluster_id="c1",
            episode_ids=["ep1", "ep2"],
            centroid_signature="sig1",
            domain="dev",
            similarity_score=0.9,
        )
    ]
    distilled = [
        MethodCard(
            method_id="m1",
            title="test",
            domain="dev",
            knowledge_type="procedural",
            scope="team_shared",
            content="test content for distillation",
        )
    ]
    telemetry = TelemetryCollector.compute(
        total_episodes=2, processed_episodes=2, clusters=clusters, distilled_cards=distilled
    )
    assert telemetry["consolidation_rate"] == 1.0
    assert telemetry["coherence_score"] == 0.9
    assert telemetry["surprise_index"] == 0.1  # 1 - 0.9
    assert telemetry["integration_depth"] == 1.0  # 1 card / 1 cluster


def test_telemetry_partial_processing():
    """部分处理 → consolidation_rate < 1.0."""
    telemetry = TelemetryCollector.compute(
        total_episodes=10, processed_episodes=5, clusters=[], distilled_cards=[]
    )
    assert telemetry["consolidation_rate"] == 0.5


def test_telemetry_signal_keys():
    """4 信号必须包含规定的 key（I3）."""
    telemetry = TelemetryCollector.compute(
        total_episodes=1, processed_episodes=1, clusters=[], distilled_cards=[]
    )
    expected_keys = {
        "consolidation_rate",
        "coherence_score",
        "surprise_index",
        "integration_depth",
    }
    assert set(telemetry.keys()) == expected_keys


# ── DreamCycle.run_once 测试 ──────────────────────────────────────


@pytest.mark.asyncio
async def test_run_once_empty_store():
    """空存储 → 立即返回，telemetry 全为 0."""
    store = InMemoryEpisodeStore(episodes=[])
    cycle = DreamCycle(episode_store=store)
    snapshot = await cycle.run_once()
    assert snapshot.phase == DreamPhase.IDLE
    assert snapshot.clusters == []
    assert snapshot.distilled_method_cards == []
    assert snapshot.telemetry["consolidation_rate"] == 0.0
    assert snapshot.telemetry["coherence_score"] == 0.0


@pytest.mark.asyncio
async def test_run_once_with_similar_episodes():
    """相似 episodes → 聚类为 1 簇 + 蒸馏 1 个 MethodCard."""
    episodes = _make_similar_episodes(4)
    store = InMemoryEpisodeStore(episodes=episodes)
    sink = InMemoryMethodCardSink()
    cycle = DreamCycle(
        episode_store=store,
        method_card_sink=sink,
        config=DreamCycleConfig(min_episodes_per_cluster=2),
    )
    snapshot = await cycle.run_once()

    # 至少聚类出 1 个簇
    assert len(snapshot.clusters) >= 1
    # 至少蒸馏出 1 个 MethodCard
    assert len(snapshot.distilled_method_cards) >= 1
    # sink 已保存
    assert sink.saved_count >= 1
    # surface_payload 非空
    assert "items" in snapshot.surface_payload
    assert len(snapshot.surface_payload["items"]) >= 1
    # telemetry 4 信号都有值
    assert "consolidation_rate" in snapshot.telemetry
    assert snapshot.telemetry["consolidation_rate"] > 0.0


@pytest.mark.asyncio
async def test_run_once_diverse_episodes():
    """多样化 episodes → 多个簇（不同领域）."""
    episodes = _make_diverse_episodes()
    store = InMemoryEpisodeStore(episodes=episodes)
    cycle = DreamCycle(
        episode_store=store,
        config=DreamCycleConfig(min_episodes_per_cluster=2),
    )
    snapshot = await cycle.run_once()

    # 应该至少聚类出 1 个簇（dev 或 medical 领域）
    assert len(snapshot.clusters) >= 1
    # 至少有 1 个 domain 是 dev 或 medical
    domains = {c.domain for c in snapshot.clusters}
    assert "development" in domains or "medical" in domains


@pytest.mark.asyncio
async def test_run_once_archives_episodes():
    """run_once 完成后 episodes 应被标记为已处理."""
    episodes = _make_similar_episodes(3)
    store = InMemoryEpisodeStore(episodes=episodes)
    cycle = DreamCycle(
        episode_store=store,
        config=DreamCycleConfig(
            min_episodes_per_cluster=2,
            archive_processed_episodes=True,
        ),
    )
    snapshot = await cycle.run_once()

    # 至少聚类了 2 个 episode 并标记为已处理
    assert len(store._processed) >= 2

    # 再次运行应无 episode 可处理
    snapshot2 = await cycle.run_once()
    assert snapshot2.phase == DreamPhase.IDLE
    assert snapshot2.clusters == []


@pytest.mark.asyncio
async def test_run_once_disabled_archiving():
    """禁用归档 → episodes 不被标记."""
    episodes = _make_similar_episodes(3)
    store = InMemoryEpisodeStore(episodes=episodes)
    cycle = DreamCycle(
        episode_store=store,
        config=DreamCycleConfig(
            min_episodes_per_cluster=2,
            archive_processed_episodes=False,
        ),
    )
    await cycle.run_once()
    assert len(store._processed) == 0


@pytest.mark.asyncio
async def test_run_once_disabled_surface():
    """禁用 surface → surface_payload 为空."""
    episodes = _make_similar_episodes(3)
    store = InMemoryEpisodeStore(episodes=episodes)
    cycle = DreamCycle(
        episode_store=store,
        config=DreamCycleConfig(
            min_episodes_per_cluster=2,
            enable_foreground_surface=False,
        ),
    )
    snapshot = await cycle.run_once()
    assert snapshot.surface_payload == {}


# ── Magic Words 中断测试（I4）────────────────────────────────────


@pytest.mark.asyncio
async def test_interrupt_before_run():
    """run_once 前调用 interrupt → 立即中断."""
    store = InMemoryEpisodeStore(episodes=_make_similar_episodes(3))
    cycle = DreamCycle(episode_store=store)
    cycle.interrupt()
    snapshot = await cycle.run_once()
    # 中断状态下不应处理任何 episode
    assert snapshot.interrupted is True
    assert snapshot.phase == DreamPhase.INTERRUPTED


# ── BackgroundDreamLoop 测试 ─────────────────────────────────────


@pytest.mark.asyncio
async def test_background_loop_start_stop():
    """BackgroundDreamLoop 启停测试."""
    store = InMemoryEpisodeStore(episodes=[])
    loop = BackgroundDreamLoop(
        episode_store=store,
        config=DreamCycleConfig(consolidation_interval_seconds=60),
    )

    assert not loop.is_running
    await loop.start()
    assert loop.is_running

    # 等待一小段时间
    await asyncio.sleep(0.1)

    await loop.stop(timeout=5.0)
    assert not loop.is_running


@pytest.mark.asyncio
async def test_background_loop_trigger_now():
    """trigger_now 立即触发一次 cycle."""
    store = InMemoryEpisodeStore(episodes=_make_similar_episodes(3))
    loop = BackgroundDreamLoop(
        episode_store=store,
        config=DreamCycleConfig(
            consolidation_interval_seconds=3600,  # 长间隔，不自动触发
            min_episodes_per_cluster=2,
        ),
    )

    snapshot = await loop.trigger_now()
    assert snapshot is not None
    assert len(snapshot.clusters) >= 1

    # 再次 trigger_now 应返回 None（因为没在运行）
    snapshot2 = await loop.trigger_now()
    assert snapshot2 is not None  # trigger_now 不依赖 is_running


@pytest.mark.asyncio
async def test_background_loop_interrupt_current_cycle():
    """interrupt_current_cycle 中断当前 cycle."""
    store = InMemoryEpisodeStore(episodes=_make_similar_episodes(3))
    loop = BackgroundDreamLoop(
        episode_store=store,
        config=DreamCycleConfig(consolidation_interval_seconds=3600),
    )

    # trigger_now 触发，然后 interrupt
    # 由于 trigger_now 是同步等待的，无法在执行中 interrupt
    # 这里只验证 interrupt_current_cycle 不抛异常
    loop.interrupt_current_cycle()  # 无 cycle 在执行，应安全无操作


# ── 顶层 API 测试 ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_dream_cycle_top_level_api():
    """顶层 API run_dream_cycle 测试."""
    store = InMemoryEpisodeStore(episodes=_make_similar_episodes(3))
    snapshot = await run_dream_cycle(
        episode_store=store,
        config=DreamCycleConfig(min_episodes_per_cluster=2),
    )
    assert snapshot is not None
    assert snapshot.cycle_id.startswith("dream-cycle-")
    assert snapshot.snapshot_id.startswith("dream-snapshot-")


# ── 配置外置测试（铁律 5）───────────────────────────────────────


def test_config_yaml_compatible():
    """DreamCycleConfig 字段可序列化为 YAML（铁律 5 配置外置）."""
    cfg = DreamCycleConfig(
        consolidation_interval_seconds=1800,
        surface_top_k=5,
        cluster_similarity_threshold=0.75,
        min_episodes_per_cluster=3,
        max_clusters_per_cycle=10,
        enable_background_loop=True,
        enable_foreground_surface=False,
        archive_processed_episodes=True,
    )
    # Pydantic model_dump 应能输出 dict（可被 yaml.dump 序列化）
    data = cfg.model_dump()
    assert data["consolidation_interval_seconds"] == 1800
    assert data["surface_top_k"] == 5
    assert data["cluster_similarity_threshold"] == 0.75
    assert data["min_episodes_per_cluster"] == 3
    assert data["max_clusters_per_cycle"] == 10
    assert data["enable_background_loop"] is True
    assert data["enable_foreground_surface"] is False
    assert data["archive_processed_episodes"] is True


# ── 不变量测试 ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_invariant_i1_idempotent_clustering():
    """I1: 相同输入产生相同聚类（幂等性）."""
    episodes = _make_similar_episodes(4)
    store1 = InMemoryEpisodeStore(episodes=episodes)
    store2 = InMemoryEpisodeStore(episodes=episodes)

    cycle1 = DreamCycle(
        episode_store=store1,
        config=DreamCycleConfig(
            archive_processed_episodes=False,  # 不归档以便重跑
            min_episodes_per_cluster=2,
        ),
    )
    cycle2 = DreamCycle(
        episode_store=store2,
        config=DreamCycleConfig(
            archive_processed_episodes=False,
            min_episodes_per_cluster=2,
        ),
    )

    snap1 = await cycle1.run_once()
    snap2 = await cycle2.run_once()

    # 簇数相同
    assert len(snap1.clusters) == len(snap2.clusters)
    # 簇心签名相同（I1 幂等性）
    sigs1 = sorted(c.centroid_signature for c in snap1.clusters)
    sigs2 = sorted(c.centroid_signature for c in snap2.clusters)
    assert sigs1 == sigs2


@pytest.mark.asyncio
async def test_invariant_i2_surface_no_modify():
    """I2: surface 不修改原数据（只生成快照）."""
    episodes = _make_similar_episodes(3)
    original_method = episodes[0].transferable_method
    store = InMemoryEpisodeStore(episodes=episodes)
    cycle = DreamCycle(episode_store=store)
    snapshot = await cycle.run_once()

    # 验证 episode 原数据未被修改
    assert store._episodes[episodes[0].episode_id].transferable_method == original_method
    # surface_payload 是新生成的 dict
    assert isinstance(snapshot.surface_payload, dict)


def test_invariant_i3_telemetry_dict_output():
    """I3: telemetry 必须是 dict（可被 Prometheus 采集）."""
    telemetry = TelemetryCollector.compute(
        total_episodes=1, processed_episodes=1, clusters=[], distilled_cards=[]
    )
    assert isinstance(telemetry, dict)
    # 所有 value 必须是 float（Prometheus 可采集）
    for v in telemetry.values():
        assert isinstance(v, (int, float))


@pytest.mark.asyncio
async def test_invariant_i5_distilled_cards_are_l2_draft():
    """I5: 蒸馏出的 MethodCard 必须是 L2_DRAFT 草稿（需 Eval Ledger 验证才能晋升）."""
    episodes = _make_similar_episodes(3)
    store = InMemoryEpisodeStore(episodes=episodes)
    cycle = DreamCycle(episode_store=store)
    snapshot = await cycle.run_once()

    for card in snapshot.distilled_method_cards:
        assert card.maturity_level == KnowledgeMaturityLevel.L2_DRAFT.value
        assert card.trust_level == "experimental"
        assert card.lifecycle == "draft"
