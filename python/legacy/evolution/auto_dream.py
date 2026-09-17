"""CL-031 Auto Dream 双层架构 — 后台 consolidation + 前台 surface + 4 信号 telemetry.

[doc:design.md#v7.1-§D7.10] Auto Dream 双层架构
[doc:review/review.md#13.4] CL-031 Auto Dream 未实现
[doc:decisions/009-eval-self-metabolism.md] ADR-009 Eval 自代谢

设计哲学：
- "做梦"= 空闲时段对经验记忆（EpisodeCard）进行聚类 + 蒸馏 + 升级
- 后台 consolidation：扫描 L0 EpisodeCard → 聚类相似 episodes → 蒸馏为 L2 MethodCard 草稿
- 前台 surface：将重要梦境内容（高 surprise_index 或低 coherence_score）浮现到当前上下文
- 4 信号 telemetry：consolidation_rate / coherence_score / surprise_index / integration_depth

与三模式的关系：
- Scope Guard（防御层）：阻挡不合规的进化方向
- Process Evolution（改进层）：基于 EpisodeCard 生成 EvolutionProposal
- Knowledge Evolution（成长层）：基于 MethodCard 推进五级成熟度阶梯
- Auto Dream（整合层，本模块）：跨 episode 的聚类 + 蒸馏，是三模式的"睡眠态"补充

不变量：
- I1: consolidation 必须是幂等的（相同输入产生相同聚类）
- I2: surface 不修改原数据，只生成"梦境快照"供前台消费
- I3: 4 信号必须可被 Prometheus 采集（dict 输出）
- I4: 后台任务必须可被 Magic Words 中断（F011 逃生舱）
- I5: 蒸馏出的 MethodCard 必须经过 Eval Ledger 验证才能合入（CL-004）

License: MIT
"""

from __future__ import annotations

import asyncio
import hashlib
import secrets
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Awaitable, Callable, Protocol

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import EpisodeCard, KnowledgeMaturityLevel, MethodCard

logger = get_logger("flowforge.evolution.auto_dream")


# ════════════════════════════════════════════════════════════════════
# §1 常量与枚举
# ════════════════════════════════════════════════════════════════════

DEFAULT_CONSOLIDATION_INTERVAL_SECONDS = 3600  # 默认 1 小时整合一次
DEFAULT_SURFACE_TOP_K = 3  # 前台浮现 Top 3 重要梦境
DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.6  # 聚类相似度阈值
DEFAULT_MIN_EPISODES_PER_CLUSTER = 2  # 单簇最少 episode 数（≥2 才能蒸馏）
DEFAULT_MAX_CLUSTERS_PER_CYCLE = 5  # 单次梦境循环最多处理 5 个簇


class DreamPhase(str, Enum):
    """梦境循环的阶段."""

    IDLE = "idle"  # 空闲态，等待下一次 consolidation
    SCANNING = "scanning"  # 扫描 EpisodeCard
    CLUSTERING = "clustering"  # 聚类相似 episodes
    DISTILLING = "distilling"  # 蒸馏为 MethodCard 草稿
    SURFACING = "surfacing"  # 浮现到前台
    ARCHIVING = "archiving"  # 归档已处理的 episodes
    INTERRUPTED = "interrupted"  # 被 Magic Words 中断


# ════════════════════════════════════════════════════════════════════
# §2 数据模型
# ════════════════════════════════════════════════════════════════════


class DreamCluster(BaseModel):
    """梦境簇 — 相似 EpisodeCard 的聚类结果."""

    cluster_id: str
    episode_ids: list[str]  # 簇内 EpisodeCard 的 episode_id 列表
    centroid_signature: str  # 簇心签名（用于幂等性校验，I1）
    domain: str  # 簇所属领域（development/medical/legal/...）
    similarity_score: float = 0.0  # 簇内平均相似度 0.0~1.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DreamSnapshot(BaseModel):
    """梦境快照 — 单次梦境循环的完整记录（前台 surface 的载体）."""

    snapshot_id: str
    cycle_id: str  # 关联 DreamCycle.cycle_id
    phase: DreamPhase
    clusters: list[DreamCluster] = Field(default_factory=list)
    distilled_method_cards: list[MethodCard] = Field(default_factory=list)
    surface_payload: dict[str, Any] = Field(default_factory=dict)  # 浮现到前台的内容
    telemetry: dict[str, float] = Field(default_factory=dict)  # 4 信号 telemetry
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: datetime | None = None
    interrupted: bool = False  # 是否被 Magic Words 中断


class DreamCycleConfig(BaseModel):
    """梦境循环配置（YAML 外置，铁律 5）."""

    consolidation_interval_seconds: int = DEFAULT_CONSOLIDATION_INTERVAL_SECONDS
    surface_top_k: int = DEFAULT_SURFACE_TOP_K
    cluster_similarity_threshold: float = DEFAULT_CLUSTER_SIMILARITY_THRESHOLD
    min_episodes_per_cluster: int = DEFAULT_MIN_EPISODES_PER_CLUSTER
    max_clusters_per_cycle: int = DEFAULT_MAX_CLUSTERS_PER_CYCLE
    enable_background_loop: bool = True  # 是否启用后台 consolidation 循环
    enable_foreground_surface: bool = True  # 是否启用前台 surface
    archive_processed_episodes: bool = True  # 是否归档已处理的 episodes


# ════════════════════════════════════════════════════════════════════
# §3 存储协议（Protocol — 依赖注入，红线 12）
# ════════════════════════════════════════════════════════════════════


class EpisodeStoreProtocol(Protocol):
    """经验记忆存储协议 — Auto Dream 的输入源."""

    async def list_episodes(
        self,
        *,
        domain: str | None = None,
        limit: int = 100,
        unprocessed_only: bool = True,
    ) -> list[EpisodeCard]:
        """列出 EpisodeCard（支持按领域过滤 + 只看未处理）."""
        ...

    async def mark_processed(self, episode_id: str, cycle_id: str) -> None:
        """标记 episode 为已处理（I5: 避免重复蒸馏）."""
        ...


class MethodCardSinkProtocol(Protocol):
    """MethodCard 输出协议 — 蒸馏产物的去向（通常是 MindCodex）."""

    async def save_draft(self, method_card: MethodCard) -> str:
        """保存 MethodCard 草稿（L2_DRAFT），返回 method_id.

        注意：保存的草稿必须经过 Eval Ledger 验证（CL-004）才能晋升为 L3_VALIDATED。
        """
        ...


# ════════════════════════════════════════════════════════════════════
# §4 相似度计算（默认实现 — 关键词重叠）
# ════════════════════════════════════════════════════════════════════


class SimilarityCalculator:
    """基于关键词重叠的相似度计算器（骨架实现）.

    生产环境应注入向量相似度计算器（如 sentence-transformers cosine similarity）。
    """

    @staticmethod
    def compute_signature(episode: EpisodeCard) -> str:
        """计算 episode 的签名（用于幂等性校验，I1）.

        签名 = SHA256(domain + transferable_method + non_transferable_facts)[:16]
        """
        payload = (
            f"{episode.task_snapshot}|"
            f"{episode.transferable_method}|"
            f"{episode.non_transferable_facts}|"
            f"{episode.distillation_direction}"
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def similarity(a: EpisodeCard, b: EpisodeCard) -> float:
        """计算两个 episode 的相似度（0.0~1.0）.

        规则：
        - 同领域 +1.0 基础分
        - transferable_method 关键词重叠
        - non_transferable_facts 关键词重叠（权重较低）
        """
        if _episode_domain(a) != _episode_domain(b):
            return 0.0

        method_overlap = SimilarityCalculator._keyword_overlap(
            a.transferable_method, b.transferable_method
        )
        facts_overlap = SimilarityCalculator._keyword_overlap(
            a.non_transferable_facts, b.non_transferable_facts
        )
        # 加权：方法重叠权重 0.7，事实重叠权重 0.3
        return 0.7 * method_overlap + 0.3 * facts_overlap

    @staticmethod
    def _keyword_overlap(a: str, b: str) -> float:
        """关键词重叠度（Jaccard 相似度的变体）."""
        if not a or not b:
            return 0.0
        words_a = set(a.lower().split())
        words_b = set(b.lower().split())
        if not words_a or not words_b:
            return 0.0
        intersection = len(words_a & words_b)
        union = len(words_a | words_b)
        return intersection / union if union > 0 else 0.0


# 在 EpisodeCard 上添加 domain() 辅助方法（避免修改 models.py）
def _episode_domain(episode: EpisodeCard) -> str:
    """从 episode 中提取 domain（默认 'development'）."""
    # EpisodeCard 没有显式 domain 字段，从 task_snapshot 推断
    snapshot = episode.task_snapshot.lower()
    if "医学" in snapshot or "medical" in snapshot:
        return "medical"
    if "法律" in snapshot or "legal" in snapshot:
        return "legal"
    return "development"


# ════════════════════════════════════════════════════════════════════
# §5 4 信号 telemetry 计算
# ════════════════════════════════════════════════════════════════════


class TelemetryCollector:
    """4 信号 telemetry 计算（I3: dict 输出，可被 Prometheus 采集）.

    信号定义：
    1. consolidation_rate: 整合速率 = processed_episodes / total_episodes（0.0~1.0）
    2. coherence_score: 梦境连贯性 = 簇内平均相似度（0.0~1.0，越高越连贯）
    3. surprise_index: 意外度 = 1 - 平均相似度（0.0~1.0，越高越意外）
    4. integration_depth: 整合深度 = 蒸馏出的 MethodCard 数 / 簇数（0.0~∞，越深越整合）
    """

    @staticmethod
    def compute(
        *,
        total_episodes: int,
        processed_episodes: int,
        clusters: list[DreamCluster],
        distilled_cards: list[MethodCard],
    ) -> dict[str, float]:
        """计算 4 信号 telemetry."""
        # 1. consolidation_rate
        consolidation_rate = (
            processed_episodes / total_episodes if total_episodes > 0 else 0.0
        )

        # 2. coherence_score（簇内平均相似度）
        if clusters:
            coherence_score = sum(c.similarity_score for c in clusters) / len(clusters)
        else:
            coherence_score = 0.0

        # 3. surprise_index（1 - 平均相似度，无簇时为 0）
        if clusters:
            surprise_index = max(0.0, 1.0 - coherence_score)
        else:
            surprise_index = 0.0

        # 4. integration_depth（蒸馏卡片数 / 簇数）
        if clusters:
            integration_depth = len(distilled_cards) / len(clusters)
        else:
            integration_depth = 0.0

        return {
            "consolidation_rate": round(consolidation_rate, 4),
            "coherence_score": round(coherence_score, 4),
            "surprise_index": round(surprise_index, 4),
            "integration_depth": round(integration_depth, 4),
        }


# ════════════════════════════════════════════════════════════════════
# §6 梦境循环执行器
# ════════════════════════════════════════════════════════════════════


class DreamCycle:
    """单次梦境循环执行器 — 后台 consolidation + 前台 surface.

    用法::

        cycle = DreamCycle(
            episode_store=my_store,
            method_card_sink=my_sink,
            config=DreamCycleConfig(),
        )
        snapshot = await cycle.run_once()
        print(snapshot.telemetry)  # 4 信号 telemetry
    """

    def __init__(
        self,
        *,
        episode_store: EpisodeStoreProtocol,
        method_card_sink: MethodCardSinkProtocol | None = None,
        config: DreamCycleConfig | None = None,
        similarity_calculator: SimilarityCalculator | None = None,
    ) -> None:
        self._episode_store = episode_store
        self._method_card_sink = method_card_sink
        self._config = config or DreamCycleConfig()
        self._similarity = similarity_calculator or SimilarityCalculator()
        self._cycle_id = self._gen_cycle_id()
        self._interrupt_event = asyncio.Event()  # I4: Magic Words 中断信号
        self._phase: DreamPhase = DreamPhase.IDLE

        logger.info(
            f"DreamCycle 初始化: cycle_id={self._cycle_id}, "
            f"interval={self._config.consolidation_interval_seconds}s, "
            f"top_k={self._config.surface_top_k}, "
            f"sim_threshold={self._config.cluster_similarity_threshold}"
        )

    @property
    def cycle_id(self) -> str:
        return self._cycle_id

    @property
    def phase(self) -> DreamPhase:
        return self._phase

    def interrupt(self) -> None:
        """I4: Magic Words 中断 — 立即停止当前循环."""
        self._interrupt_event.set()
        self._phase = DreamPhase.INTERRUPTED
        logger.warning(f"DreamCycle 被 Magic Words 中断: cycle_id={self._cycle_id}")

    # ── 主入口：单次梦境循环 ────────────────────────────────────────

    async def run_once(self) -> DreamSnapshot:
        """执行单次梦境循环（consolidation + surface）.

        Returns:
            DreamSnapshot（含 4 信号 telemetry）
        """
        snapshot = DreamSnapshot(snapshot_id=self._gen_snapshot_id(), cycle_id=self._cycle_id, phase=DreamPhase.SCANNING)

        logger.info(f"DreamCycle 开始: cycle_id={self._cycle_id}")
        try:
            # §1 扫描 EpisodeCard
            self._phase = DreamPhase.SCANNING
            episodes = await self._episode_store.list_episodes(
                unprocessed_only=True, limit=100
            )
            logger.info(
                f"DreamCycle 扫描完成: {len(episodes)} 个未处理 episode"
            )

            if not episodes:
                logger.info("DreamCycle 无可处理 episode，提前结束")
                snapshot.phase = DreamPhase.IDLE
                snapshot.telemetry = TelemetryCollector.compute(
                    total_episodes=0,
                    processed_episodes=0,
                    clusters=[],
                    distilled_cards=[],
                )
                snapshot.finished_at = datetime.now(timezone.utc)
                return snapshot

            # §2 聚类
            self._phase = DreamPhase.CLUSTERING
            if self._interrupt_event.is_set():
                snapshot.interrupted = True
                snapshot.phase = DreamPhase.INTERRUPTED
                snapshot.finished_at = datetime.now(timezone.utc)
                return snapshot

            clusters = self._cluster_episodes(episodes)
            snapshot.clusters = clusters
            logger.info(
                f"DreamCycle 聚类完成: {len(clusters)} 个簇"
            )

            # §3 蒸馏
            self._phase = DreamPhase.DISTILLING
            if self._interrupt_event.is_set():
                snapshot.interrupted = True
                snapshot.phase = DreamPhase.INTERRUPTED
                snapshot.finished_at = datetime.now(timezone.utc)
                return snapshot

            distilled_cards: list[MethodCard] = []
            for cluster in clusters[: self._config.max_clusters_per_cycle]:
                if self._interrupt_event.is_set():
                    break
                method_card = await self._distill_cluster(cluster, episodes)
                if method_card:
                    distilled_cards.append(method_card)
                    if self._method_card_sink:
                        await self._method_card_sink.save_draft(method_card)
                        logger.info(
                            f"DreamCycle 蒸馏保存: method_id={method_card.method_id}, "
                            f"cluster={cluster.cluster_id}"
                        )
            snapshot.distilled_method_cards = distilled_cards

            # §4 浮现到前台
            if self._config.enable_foreground_surface and not self._interrupt_event.is_set():
                self._phase = DreamPhase.SURFACING
                snapshot.surface_payload = self._surface_top_k(
                    clusters, distilled_cards, self._config.surface_top_k
                )
                logger.info(
                    f"DreamCycle 浮现完成: top_k={len(snapshot.surface_payload.get('items', []))}"
                )

            # §5 归档已处理 episodes
            if self._config.archive_processed_episodes and not self._interrupt_event.is_set():
                self._phase = DreamPhase.ARCHIVING
                # 标记所有被聚类到的 episode 为已处理
                clustered_ids: set[str] = set()
                for cluster in clusters:
                    clustered_ids.update(cluster.episode_ids)
                for episode_id in clustered_ids:
                    await self._episode_store.mark_processed(episode_id, self._cycle_id)
                logger.info(
                    f"DreamCycle 归档完成: {len(clustered_ids)} 个 episode 标记为已处理"
                )

            # §6 计算 telemetry
            snapshot.telemetry = TelemetryCollector.compute(
                total_episodes=len(episodes),
                processed_episodes=len(
                    {eid for c in clusters for eid in c.episode_ids}
                ),
                clusters=clusters,
                distilled_cards=distilled_cards,
            )

            snapshot.phase = DreamPhase.INTERRUPTED if self._interrupt_event.is_set() else DreamPhase.IDLE
            snapshot.interrupted = self._interrupt_event.is_set()

        except Exception as e:
            logger.error(
                f"DreamCycle 异常: cycle_id={self._cycle_id}, error={e}",
                exc_info=True,
            )
            snapshot.phase = DreamPhase.INTERRUPTED
            snapshot.interrupted = True
        finally:
            snapshot.finished_at = datetime.now(timezone.utc)
            self._phase = DreamPhase.IDLE
            logger.info(
                f"DreamCycle 结束: cycle_id={self._cycle_id}, "
                f"phase={snapshot.phase}, telemetry={snapshot.telemetry}"
            )

        return snapshot

    # ── 聚类算法 ────────────────────────────────────────────────────

    def _cluster_episodes(
        self, episodes: list[EpisodeCard]
    ) -> list[DreamCluster]:
        """对 episodes 进行聚类（贪心算法，O(n²)）.

        算法：
        1. 第一个 episode 自成一簇
        2. 后续 episode 与所有现有簇心计算相似度
        3. 若最高相似度 ≥ threshold → 加入该簇
        4. 否则自成一簇

        Returns:
            list[DreamCluster]（按簇大小降序）
        """
        if not episodes:
            return []

        clusters: list[DreamCluster] = []
        # 簇内 episodes 列表（用于计算簇心）
        cluster_episodes: list[list[EpisodeCard]] = []

        for episode in episodes:
            # 找最相似的簇
            best_cluster_idx = -1
            best_similarity = 0.0

            for idx, cluster_eps in enumerate(cluster_episodes):
                # 计算与簇内所有 episode 的平均相似度
                avg_sim = sum(
                    self._similarity.similarity(episode, other)
                    for other in cluster_eps
                ) / len(cluster_eps)

                if avg_sim > best_similarity:
                    best_similarity = avg_sim
                    best_cluster_idx = idx

            if (
                best_cluster_idx >= 0
                and best_similarity >= self._config.cluster_similarity_threshold
            ):
                # 加入现有簇
                cluster_episodes[best_cluster_idx].append(episode)
                clusters[best_cluster_idx].episode_ids.append(episode.episode_id)
                # 更新簇心签名和相似度
                clusters[best_cluster_idx].centroid_signature = (
                    self._compute_centroid_signature(cluster_episodes[best_cluster_idx])
                )
                clusters[best_cluster_idx].similarity_score = best_similarity
            else:
                # 自成一簇
                cluster_id = f"cluster-{self._cycle_id}-{len(clusters):03d}"
                new_cluster = DreamCluster(
                    cluster_id=cluster_id,
                    episode_ids=[episode.episode_id],
                    centroid_signature=self._compute_centroid_signature([episode]),
                    domain=_episode_domain(episode),
                    similarity_score=1.0,  # 单元素簇相似度为 1.0
                )
                clusters.append(new_cluster)
                cluster_episodes.append([episode])

        # 过滤掉小于 min_episodes_per_cluster 的簇（不蒸馏）
        valid_clusters = [
            (c, eps)
            for c, eps in zip(clusters, cluster_episodes)
            if len(c.episode_ids) >= self._config.min_episodes_per_cluster
        ]

        # 按簇大小降序
        valid_clusters.sort(key=lambda x: len(x[0].episode_ids), reverse=True)

        # 限制最多 max_clusters_per_cycle 个簇
        valid_clusters = valid_clusters[: self._config.max_clusters_per_cycle]

        # 保存 cluster_episodes 供蒸馏使用（通过 _cluster_episodes_cache）
        self._cluster_episodes_cache = {c.cluster_id: eps for c, eps in valid_clusters}

        return [c for c, _ in valid_clusters]

    def _compute_centroid_signature(self, episodes: list[EpisodeCard]) -> str:
        """计算簇心签名（I1: 幂等性校验）.

        签名 = SHA256(所有 episode 签名排序后拼接)[:16]
        """
        signatures = sorted(
            self._similarity.compute_signature(ep) for ep in episodes
        )
        payload = "|".join(signatures)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

    # ── 蒸馏算法 ────────────────────────────────────────────────────

    async def _distill_cluster(
        self,
        cluster: DreamCluster,
        all_episodes: list[EpisodeCard],
    ) -> MethodCard | None:
        """将簇蒸馏为 MethodCard 草稿（L2_DRAFT）.

        蒸馏规则（骨架）：
        - title = "Distilled from {n} episodes"
        - content = 拼接所有 episode 的 transferable_method
        - domain = 簇的 domain
        - knowledge_type = "procedural"（默认）
        - trust_level = "experimental"（草稿）
        - lifecycle = "draft"
        - maturity_level = "L2"

        生产环境应注入 LLM 蒸馏器（生成更精炼的 title/content）。
        """
        # 从缓存中获取簇内 episodes
        cluster_eps = getattr(self, "_cluster_episodes_cache", {}).get(
            cluster.cluster_id, []
        )
        if not cluster_eps:
            # 从 all_episodes 中查找
            id_set = set(cluster.episode_ids)
            cluster_eps = [ep for ep in all_episodes if ep.episode_id in id_set]

        if not cluster_eps:
            logger.warning(
                f"DreamCycle 蒸馏失败: cluster={cluster.cluster_id} 无 episodes"
            )
            return None

        # 蒸馏（骨架：拼接 transferable_method）
        method_content = "\n\n".join(
            f"## Episode {ep.episode_id}\n{ep.transferable_method}"
            for ep in cluster_eps
        )

        method_card = MethodCard(
            method_id=f"method-{cluster.cluster_id}",
            title=f"Distilled from {len(cluster_eps)} episodes (domain={cluster.domain})",
            domain=cluster.domain,
            knowledge_type="procedural",
            scope="team_shared",
            trust_level="experimental",
            lifecycle="draft",
            content=method_content,
            source_refs=[ep.episode_id for ep in cluster_eps],
            maturity_level=KnowledgeMaturityLevel.L2_DRAFT.value,
        )

        logger.info(
            f"DreamCycle 蒸馏完成: cluster={cluster.cluster_id}, "
            f"method_id={method_card.method_id}, episodes={len(cluster_eps)}"
        )
        return method_card

    # ── 前台浮现 ────────────────────────────────────────────────────

    def _surface_top_k(
        self,
        clusters: list[DreamCluster],
        distilled_cards: list[MethodCard],
        top_k: int,
    ) -> dict[str, Any]:
        """I2: 浮现 Top K 重要梦境到前台（不修改原数据）.

        重要性排序：
        1. surprise_index 高的簇（意外度高 = 值得关注）
        2. 簇大小大的（影响范围广）
        3. 蒸馏出的 MethodCard 多的（整合深度高）
        """
        # 计算每个簇的重要性分数
        cluster_scores: list[tuple[DreamCluster, float]] = []
        for cluster in clusters:
            # 重要性 = surprise_index * 0.5 + cluster_size_normalized * 0.3 + has_distilled * 0.2
            surprise = 1.0 - cluster.similarity_score
            size_score = min(1.0, len(cluster.episode_ids) / 10.0)
            has_distilled = 1.0 if any(
                c.method_id == f"method-{cluster.cluster_id}" for c in distilled_cards
            ) else 0.0
            importance = 0.5 * surprise + 0.3 * size_score + 0.2 * has_distilled
            cluster_scores.append((cluster, importance))

        # 按重要性降序，取 Top K
        cluster_scores.sort(key=lambda x: x[1], reverse=True)
        top_clusters = cluster_scores[:top_k]

        return {
            "items": [
                {
                    "cluster_id": c.cluster_id,
                    "domain": c.domain,
                    "episode_count": len(c.episode_ids),
                    "similarity_score": c.similarity_score,
                    "importance": round(score, 4),
                    "centroid_signature": c.centroid_signature,
                }
                for c, score in top_clusters
            ],
            "distilled_method_ids": [c.method_id for c in distilled_cards],
            "total_clusters": len(clusters),
            "total_distilled": len(distilled_cards),
        }

    # ── ID 生成 ─────────────────────────────────────────────────────

    @staticmethod
    def _gen_cycle_id() -> str:
        """生成 cycle_id: dream-cycle-{utc_timestamp}-{rand6}."""
        ts = int(datetime.now(timezone.utc).timestamp())
        rand = secrets.token_hex(3)
        return f"dream-cycle-{ts}-{rand}"

    @staticmethod
    def _gen_snapshot_id() -> str:
        """生成 snapshot_id: dream-snapshot-{utc_timestamp}-{rand6}."""
        ts = int(datetime.now(timezone.utc).timestamp())
        rand = secrets.token_hex(3)
        return f"dream-snapshot-{ts}-{rand}"


# ════════════════════════════════════════════════════════════════════
# §7 后台循环管理器
# ════════════════════════════════════════════════════════════════════


class BackgroundDreamLoop:
    """后台梦境循环管理器 — 定期触发 DreamCycle.run_once().

    特性：
    - 可配置间隔（默认 1 小时）
    - 支持 Magic Words 中断（I4）
    - 优雅退出（asyncio.Event）
    - 最近一次 snapshot 缓存

    用法::

        loop = BackgroundDreamLoop(
            episode_store=my_store,
            method_card_sink=my_sink,
            config=DreamCycleConfig(),
        )
        await loop.start()  # 后台启动
        # ... 主线程做其他事 ...
        await loop.stop()   # 优雅退出
    """

    def __init__(
        self,
        *,
        episode_store: EpisodeStoreProtocol,
        method_card_sink: MethodCardSinkProtocol | None = None,
        config: DreamCycleConfig | None = None,
    ) -> None:
        self._episode_store = episode_store
        self._method_card_sink = method_card_sink
        self._config = config or DreamCycleConfig()
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._current_cycle: DreamCycle | None = None
        self._last_snapshot: DreamSnapshot | None = None

        logger.info(
            f"BackgroundDreamLoop 初始化: interval={self._config.consolidation_interval_seconds}s"
        )

    @property
    def last_snapshot(self) -> DreamSnapshot | None:
        """最近一次梦境快照."""
        return self._last_snapshot

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        """启动后台梦境循环."""
        if self.is_running:
            logger.warning("BackgroundDreamLoop 已在运行，忽略 start()")
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        logger.info("BackgroundDreamLoop 已启动")

    async def stop(self, timeout: float = 30.0) -> None:
        """优雅停止后台梦境循环.

        Args:
            timeout: 等待当前 cycle 完成的超时秒数
        """
        if not self.is_running:
            return
        self._stop_event.set()
        # 中断当前 cycle
        if self._current_cycle:
            self._current_cycle.interrupt()
        # 等待任务结束
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning(
                    f"BackgroundDreamLoop 停止超时（{timeout}s），强制取消"
                )
                self._task.cancel()
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("BackgroundDreamLoop 已停止")

    def interrupt_current_cycle(self) -> None:
        """I4: Magic Words 中断当前 cycle（不影响后台循环本身）."""
        if self._current_cycle:
            self._current_cycle.interrupt()

    async def trigger_now(self) -> DreamSnapshot | None:
        """立即触发一次梦境循环（不等间隔）.

        Returns:
            DreamSnapshot（若正在执行则返回 None）
        """
        if self._current_cycle:
            logger.warning("BackgroundDreamLoop 当前已有 cycle 在执行，忽略 trigger_now()")
            return None
        return await self._run_once()

    async def _run_loop(self) -> None:
        """后台循环主逻辑."""
        logger.info("BackgroundDreamLoop 主循环开始")
        while not self._stop_event.is_set():
            try:
                await self._run_once()
            except Exception as e:
                logger.error(
                    f"BackgroundDreamLoop cycle 异常: {e}", exc_info=True
                )
            # 等待下一个间隔（或被 stop 中断）
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self._config.consolidation_interval_seconds,
                )
            except asyncio.TimeoutError:
                # 正常超时，继续下一轮
                pass
        logger.info("BackgroundDreamLoop 主循环退出")

    async def _run_once(self) -> DreamSnapshot:
        """执行单次 DreamCycle."""
        self._current_cycle = DreamCycle(
            episode_store=self._episode_store,
            method_card_sink=self._method_card_sink,
            config=self._config,
        )
        try:
            snapshot = await self._current_cycle.run_once()
            self._last_snapshot = snapshot
            return snapshot
        finally:
            self._current_cycle = None


# ════════════════════════════════════════════════════════════════════
# §8 顶层 API
# ════════════════════════════════════════════════════════════════════


async def run_dream_cycle(
    *,
    episode_store: EpisodeStoreProtocol,
    method_card_sink: MethodCardSinkProtocol | None = None,
    config: DreamCycleConfig | None = None,
) -> DreamSnapshot:
    """顶层 API：执行单次梦境循环.

    示例::

        from flowforge.evolution.auto_dream import run_dream_cycle, DreamCycleConfig

        snapshot = await run_dream_cycle(
            episode_store=my_store,
            method_card_sink=my_sink,
            config=DreamCycleConfig(cluster_similarity_threshold=0.7),
        )
        print(snapshot.telemetry)
        # {'consolidation_rate': 0.85, 'coherence_score': 0.72, ...}
    """
    cycle = DreamCycle(
        episode_store=episode_store,
        method_card_sink=method_card_sink,
        config=config,
    )
    return await cycle.run_once()


__all__ = [
    # 常量
    "DEFAULT_CONSOLIDATION_INTERVAL_SECONDS",
    "DEFAULT_SURFACE_TOP_K",
    "DEFAULT_CLUSTER_SIMILARITY_THRESHOLD",
    "DEFAULT_MIN_EPISODES_PER_CLUSTER",
    "DEFAULT_MAX_CLUSTERS_PER_CYCLE",
    # 枚举
    "DreamPhase",
    # 数据模型
    "DreamCluster",
    "DreamSnapshot",
    "DreamCycleConfig",
    # 协议
    "EpisodeStoreProtocol",
    "MethodCardSinkProtocol",
    # 工具
    "SimilarityCalculator",
    "TelemetryCollector",
    # 执行器
    "DreamCycle",
    "BackgroundDreamLoop",
    # 顶层 API
    "run_dream_cycle",
]
