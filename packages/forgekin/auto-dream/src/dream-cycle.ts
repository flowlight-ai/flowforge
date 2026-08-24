/**
 * auto-dream cycle — CL-031 梦境循环执行器（对齐 Python DreamCycle）。
 *
 * 后台 consolidation：扫描 L0 EpisodeCard → 聚类相似 episodes →
 * 蒸馏为 L2 MethodCard 草稿；前台 surface：浮现高意外度梦境。
 *
 * 不变量：
 * - I1: consolidation 幂等（相同输入产生相同聚类，簇心签名校验）
 * - I2: surface 不修改原数据，只生成梦境快照
 * - I4: 可被 Magic Words 中断（F011 逃生舱）
 * - I5: 蒸馏出的 MethodCard 必须经 Eval Ledger 验证才能合入（CL-004，
 *   本模块仅产 L2_DRAFT 草稿）
 *
 * @module @flowforge/forgekin-auto-dream
 */

import { createHash, randomBytes } from 'node:crypto';
import { EpisodeCard, KnowledgeMaturityLevel, MethodCard } from './models.js';
import { SimilarityCalculator, episodeDomain } from './similarity.js';
import { DreamTelemetry, TelemetryCollector } from './telemetry.js';

// ──────────────────────────────────────────────────────────────────
// 常量与枚举
// ──────────────────────────────────────────────────────────────────

/** 默认 1 小时整合一次 */
export const DEFAULT_CONSOLIDATION_INTERVAL_SECONDS = 3600;
/** 前台浮现 Top 3 重要梦境 */
export const DEFAULT_SURFACE_TOP_K = 3;
/** 聚类相似度阈值 */
export const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.6;
/** 单簇最少 episode 数（≥2 才能蒸馏） */
export const DEFAULT_MIN_EPISODES_PER_CLUSTER = 2;
/** 单次梦境循环最多处理 5 个簇 */
export const DEFAULT_MAX_CLUSTERS_PER_CYCLE = 5;

/** 梦境循环的阶段 */
export enum DreamPhase {
  /** 空闲态，等待下一次 consolidation */
  IDLE = 'idle',
  /** 扫描 EpisodeCard */
  SCANNING = 'scanning',
  /** 聚类相似 episodes */
  CLUSTERING = 'clustering',
  /** 蒸馏为 MethodCard 草稿 */
  DISTILLING = 'distilling',
  /** 浮现到前台 */
  SURFACING = 'surfacing',
  /** 归档已处理的 episodes */
  ARCHIVING = 'archiving',
  /** 被 Magic Words 中断 */
  INTERRUPTED = 'interrupted',
}

// ──────────────────────────────────────────────────────────────────
// 数据模型
// ──────────────────────────────────────────────────────────────────

/** DreamCluster 构造参数 */
export interface DreamClusterInit {
  readonly cluster_id: string;
  readonly episode_ids: string[];
  readonly centroid_signature: string;
  readonly domain: string;
  readonly similarity_score?: number | undefined;
  readonly created_at?: string | undefined;
}

/** 梦境簇 — 相似 EpisodeCard 的聚类结果 */
export class DreamCluster {
  cluster_id: string;
  /** 簇内 EpisodeCard 的 episode_id 列表 */
  episode_ids: string[];
  /** 簇心签名（用于幂等性校验，I1） */
  centroid_signature: string;
  /** 簇所属领域（development/medical/legal/...） */
  domain: string;
  /** 簇内平均相似度 0.0~1.0 */
  similarity_score: number;
  created_at: string;

  constructor(init: DreamClusterInit) {
    this.cluster_id = init.cluster_id;
    this.episode_ids = [...init.episode_ids];
    this.centroid_signature = init.centroid_signature;
    this.domain = init.domain;
    this.similarity_score = init.similarity_score ?? 0.0;
    this.created_at = init.created_at ?? new Date().toISOString();
  }
}

/** 梦境循环前台浮现载荷（I2: 只读快照） */
export interface DreamSurfacePayload {
  readonly items: Array<{
    readonly cluster_id: string;
    readonly domain: string;
    readonly episode_count: number;
    readonly similarity_score: number;
    readonly importance: number;
    readonly centroid_signature: string;
  }>;
  readonly distilled_method_ids: string[];
  readonly total_clusters: number;
  readonly total_distilled: number;
}

/** DreamSnapshot 构造参数 */
export interface DreamSnapshotInit {
  readonly snapshot_id?: string | undefined;
  readonly cycle_id: string;
  readonly phase?: DreamPhase | undefined;
  readonly clusters?: DreamCluster[] | undefined;
  readonly distilled_method_cards?: MethodCard[] | undefined;
  readonly surface_payload?: DreamSurfacePayload | undefined;
  readonly telemetry?: DreamTelemetry | undefined;
  readonly started_at?: string | undefined;
}

/** 梦境快照 — 单次梦境循环的完整记录（前台 surface 的载体） */
export class DreamSnapshot {
  snapshot_id: string;
  /** 关联 DreamCycle.cycleId */
  cycle_id: string;
  phase: DreamPhase;
  clusters: DreamCluster[];
  distilled_method_cards: MethodCard[];
  /** 浮现到前台的内容 */
  surface_payload: DreamSurfacePayload | null;
  /** 4 信号 telemetry */
  telemetry: DreamTelemetry | null;
  started_at: string;
  finished_at: string | null;
  /** 是否被 Magic Words 中断 */
  interrupted: boolean;

  constructor(init: DreamSnapshotInit) {
    this.snapshot_id = init.snapshot_id ?? genSnapshotId();
    this.cycle_id = init.cycle_id;
    this.phase = init.phase ?? DreamPhase.SCANNING;
    this.clusters = init.clusters ?? [];
    this.distilled_method_cards = init.distilled_method_cards ?? [];
    this.surface_payload = init.surface_payload ?? null;
    this.telemetry = init.telemetry ?? null;
    this.started_at = init.started_at ?? new Date().toISOString();
    this.finished_at = null;
    this.interrupted = false;
  }
}

/** 梦境循环配置（YAML 外置，铁律 5） */
export interface DreamCycleConfig {
  readonly consolidation_interval_seconds: number;
  readonly surface_top_k: number;
  readonly cluster_similarity_threshold: number;
  readonly min_episodes_per_cluster: number;
  readonly max_clusters_per_cycle: number;
  /** 是否启用后台 consolidation 循环 */
  readonly enable_background_loop: boolean;
  /** 是否启用前台 surface */
  readonly enable_foreground_surface: boolean;
  /** 是否归档已处理的 episodes */
  readonly archive_processed_episodes: boolean;
}

/** 构造默认梦境循环配置（支持部分覆盖） */
export function makeDreamCycleConfig(
  overrides: Partial<DreamCycleConfig> = {},
): DreamCycleConfig {
  return {
    consolidation_interval_seconds: DEFAULT_CONSOLIDATION_INTERVAL_SECONDS,
    surface_top_k: DEFAULT_SURFACE_TOP_K,
    cluster_similarity_threshold: DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
    min_episodes_per_cluster: DEFAULT_MIN_EPISODES_PER_CLUSTER,
    max_clusters_per_cycle: DEFAULT_MAX_CLUSTERS_PER_CYCLE,
    enable_background_loop: true,
    enable_foreground_surface: true,
    archive_processed_episodes: true,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────
// 存储协议（接口注入，红线 12）
// ──────────────────────────────────────────────────────────────────

/** 经验记忆存储协议 — Auto Dream 的输入源 */
export interface EpisodeStore {
  /** 列出 EpisodeCard（支持按领域过滤 + 只看未处理） */
  listEpisodes(options?: {
    domain?: string | undefined;
    limit?: number | undefined;
    unprocessedOnly?: boolean | undefined;
  }): Promise<EpisodeCard[]>;
  /** 标记 episode 为已处理（I5: 避免重复蒸馏） */
  markProcessed(episodeId: string, cycleId: string): Promise<void>;
}

/** MethodCard 输出协议 — 蒸馏产物的去向（通常是 MindCodex） */
export interface MethodCardSink {
  /**
   * 保存 MethodCard 草稿（L2_DRAFT），返回 method_id。
   *
   * 注意：保存的草稿必须经过 Eval Ledger 验证（CL-004）才能晋升 L3_VALIDATED。
   */
  saveDraft(methodCard: MethodCard): Promise<string>;
}

/**
 * 内存版 EpisodeStore（插件默认实现 / 测试用）。
 *
 * 已处理状态由独立 Map 跟踪（对齐 Python：EpisodeCard 无 processed 字段）。
 */
export class InMemoryEpisodeStore implements EpisodeStore {
  private readonly episodes: EpisodeCard[] = [];
  private readonly processed = new Map<string, string>();

  /** 追加 episode（测试/采集入口） */
  addEpisode(episode: EpisodeCard): void {
    this.episodes.push(episode);
  }

  async listEpisodes(
    options: { domain?: string; limit?: number; unprocessedOnly?: boolean } = {},
  ): Promise<EpisodeCard[]> {
    const { domain, limit = 100, unprocessedOnly = true } = options;
    let result = this.episodes.slice();
    if (unprocessedOnly) {
      result = result.filter((ep) => !this.processed.has(ep.episode_id));
    }
    if (domain) {
      result = result.filter((ep) => episodeDomain(ep) === domain);
    }
    return result.slice(0, limit);
  }

  async markProcessed(episodeId: string, cycleId: string): Promise<void> {
    this.processed.set(episodeId, cycleId);
  }

  /** 查询处理标记（测试用） */
  getProcessedCycle(episodeId: string): string | undefined {
    return this.processed.get(episodeId);
  }
}

/** 内存版 MethodCardSink（插件默认实现 / 测试用） */
export class InMemoryMethodCardSink implements MethodCardSink {
  readonly drafts: MethodCard[] = [];

  async saveDraft(methodCard: MethodCard): Promise<string> {
    this.drafts.push(methodCard);
    return methodCard.method_id;
  }
}

// ──────────────────────────────────────────────────────────────────
// 梦境循环执行器
// ──────────────────────────────────────────────────────────────────

/** DreamCycle 构造参数 */
export interface DreamCycleOptions {
  readonly episodeStore: EpisodeStore;
  readonly methodCardSink?: MethodCardSink | undefined;
  readonly config?: DreamCycleConfig | undefined;
  readonly similarityCalculator?: SimilarityCalculator | undefined;
}

/**
 * 单次梦境循环执行器 — 后台 consolidation + 前台 surface。
 */
export class DreamCycle {
  readonly cycleId: string;
  private readonly episodeStore: EpisodeStore;
  private readonly methodCardSink: MethodCardSink | null;
  private readonly config: DreamCycleConfig;
  private readonly similarity: SimilarityCalculator;
  /** I4: Magic Words 中断信号 */
  private interrupted = false;
  private _phase: DreamPhase = DreamPhase.IDLE;
  /** 簇内 episodes 缓存（蒸馏时复用，对齐 Python _cluster_episodes_cache） */
  private clusterEpisodesCache = new Map<string, EpisodeCard[]>();

  constructor(options: DreamCycleOptions) {
    this.episodeStore = options.episodeStore;
    this.methodCardSink = options.methodCardSink ?? null;
    this.config = options.config ?? makeDreamCycleConfig();
    this.similarity = options.similarityCalculator ?? new SimilarityCalculator();
    this.cycleId = genCycleId();
  }

  get phase(): DreamPhase {
    return this._phase;
  }

  /** I4: Magic Words 中断 — 立即停止当前循环 */
  interrupt(): void {
    this.interrupted = true;
    this._phase = DreamPhase.INTERRUPTED;
  }

  /** 执行单次梦境循环（consolidation + surface），返回 DreamSnapshot */
  async runOnce(): Promise<DreamSnapshot> {
    const snapshot = new DreamSnapshot({ cycle_id: this.cycleId });
    try {
      // §1 扫描 EpisodeCard
      this._phase = DreamPhase.SCANNING;
      const episodes = await this.episodeStore.listEpisodes({
        unprocessedOnly: true,
        limit: 100,
      });

      if (episodes.length === 0) {
        snapshot.phase = DreamPhase.IDLE;
        snapshot.telemetry = TelemetryCollector.compute({
          totalEpisodes: 0,
          processedEpisodes: 0,
          clusters: [],
          distilledCards: [],
        });
        return snapshot;
      }

      // §2 聚类
      this._phase = DreamPhase.CLUSTERING;
      if (this.interrupted) {
        snapshot.interrupted = true;
        snapshot.phase = DreamPhase.INTERRUPTED;
        return snapshot;
      }
      const clusters = this.clusterEpisodes(episodes);
      snapshot.clusters = clusters;

      // §3 蒸馏
      this._phase = DreamPhase.DISTILLING;
      if (this.interrupted) {
        snapshot.interrupted = true;
        snapshot.phase = DreamPhase.INTERRUPTED;
        return snapshot;
      }
      const distilledCards: MethodCard[] = [];
      for (const cluster of clusters.slice(0, this.config.max_clusters_per_cycle)) {
        if (this.interrupted) {
          break;
        }
        const methodCard = await this.distillCluster(cluster, episodes);
        if (methodCard !== null) {
          distilledCards.push(methodCard);
          if (this.methodCardSink) {
            await this.methodCardSink.saveDraft(methodCard);
          }
        }
      }
      snapshot.distilled_method_cards = distilledCards;

      // §4 浮现到前台
      if (this.config.enable_foreground_surface && !this.interrupted) {
        this._phase = DreamPhase.SURFACING;
        snapshot.surface_payload = this.surfaceTopK(
          clusters,
          distilledCards,
          this.config.surface_top_k,
        );
      }

      // §5 归档已处理 episodes
      if (this.config.archive_processed_episodes && !this.interrupted) {
        this._phase = DreamPhase.ARCHIVING;
        const clusteredIds = new Set<string>();
        for (const cluster of clusters) {
          for (const episodeId of cluster.episode_ids) {
            clusteredIds.add(episodeId);
          }
        }
        for (const episodeId of clusteredIds) {
          await this.episodeStore.markProcessed(episodeId, this.cycleId);
        }
      }

      // §6 计算 telemetry
      const processedIds = new Set<string>();
      for (const cluster of clusters) {
        for (const episodeId of cluster.episode_ids) {
          processedIds.add(episodeId);
        }
      }
      snapshot.telemetry = TelemetryCollector.compute({
        totalEpisodes: episodes.length,
        processedEpisodes: processedIds.size,
        clusters,
        distilledCards,
      });

      snapshot.phase = this.interrupted ? DreamPhase.INTERRUPTED : DreamPhase.IDLE;
      snapshot.interrupted = this.interrupted;
    } catch {
      snapshot.phase = DreamPhase.INTERRUPTED;
      snapshot.interrupted = true;
    } finally {
      snapshot.finished_at = new Date().toISOString();
      this._phase = DreamPhase.IDLE;
    }
    return snapshot;
  }

  // ── 聚类算法 ────────────────────────────────────────────────────

  /**
   * 对 episodes 进行聚类（贪心算法，O(n²)）。
   *
   * 1. 第一个 episode 自成一簇；2. 后续与所有现有簇计算平均相似度；
   * 3. 最高相似度 ≥ threshold → 加入；4. 否则自成一簇。
   * 过滤小于 min_episodes_per_cluster 的簇后按簇大小降序。
   */
  private clusterEpisodes(episodes: EpisodeCard[]): DreamCluster[] {
    if (episodes.length === 0) {
      return [];
    }

    const clusters: DreamCluster[] = [];
    const clusterEpisodesList: EpisodeCard[][] = [];

    for (const episode of episodes) {
      // 找最相似的簇
      let bestClusterIdx = -1;
      let bestSimilarity = 0.0;

      for (let idx = 0; idx < clusterEpisodesList.length; idx += 1) {
        const members = clusterEpisodesList[idx] as EpisodeCard[];
        let sum = 0;
        for (const other of members) {
          sum += this.similarity.computeSimilarity(episode, other);
        }
        const avgSim = sum / members.length;
        if (avgSim > bestSimilarity) {
          bestSimilarity = avgSim;
          bestClusterIdx = idx;
        }
      }

      if (
        bestClusterIdx >= 0 &&
        bestSimilarity >= this.config.cluster_similarity_threshold
      ) {
        // 加入现有簇
        const members = clusterEpisodesList[bestClusterIdx] as EpisodeCard[];
        members.push(episode);
        const cluster = clusters[bestClusterIdx] as DreamCluster;
        cluster.episode_ids.push(episode.episode_id);
        cluster.centroid_signature = this.computeCentroidSignature(members);
        cluster.similarity_score = bestSimilarity;
      } else {
        // 自成一簇
        const clusterId = `cluster-${this.cycleId}-${String(clusters.length).padStart(3, '0')}`;
        clusters.push(
          new DreamCluster({
            cluster_id: clusterId,
            episode_ids: [episode.episode_id],
            centroid_signature: this.computeCentroidSignature([episode]),
            domain: episodeDomain(episode),
            similarity_score: 1.0, // 单元素簇相似度为 1.0
          }),
        );
        clusterEpisodesList.push([episode]);
      }
    }

    // 过滤掉小于 min_episodes_per_cluster 的簇（不蒸馏）
    const valid: Array<{ cluster: DreamCluster; members: EpisodeCard[] }> = [];
    for (let i = 0; i < clusters.length; i += 1) {
      const cluster = clusters[i] as DreamCluster;
      const members = clusterEpisodesList[i] as EpisodeCard[];
      if (cluster.episode_ids.length >= this.config.min_episodes_per_cluster) {
        valid.push({ cluster, members });
      }
    }

    // 按簇大小降序 + 限制最多 max_clusters_per_cycle 个
    valid.sort((a, b) => b.cluster.episode_ids.length - a.cluster.episode_ids.length);
    const limited = valid.slice(0, this.config.max_clusters_per_cycle);

    // 缓存簇内 episodes 供蒸馏使用
    this.clusterEpisodesCache = new Map(
      limited.map((entry) => [entry.cluster.cluster_id, entry.members]),
    );

    return limited.map((entry) => entry.cluster);
  }

  /** 计算簇心签名（I1: 幂等性校验）— SHA256(所有 episode 签名排序拼接)[:16] */
  private computeCentroidSignature(members: EpisodeCard[]): string {
    const signatures = members
      .map((ep) => this.similarity.computeSignature(ep))
      .sort();
    return createHash('sha256')
      .update(signatures.join('|'), 'utf-8')
      .digest('hex')
      .slice(0, 16);
  }

  // ── 蒸馏算法 ────────────────────────────────────────────────────

  /**
   * 将簇蒸馏为 MethodCard 草稿（L2_DRAFT）。
   *
   * 骨架：拼接所有 episode 的 transferable_method；生产环境应注入
   * LLM 蒸馏器生成更精炼的 title/content。
   */
  private async distillCluster(
    cluster: DreamCluster,
    allEpisodes: EpisodeCard[],
  ): Promise<MethodCard | null> {
    let members = this.clusterEpisodesCache.get(cluster.cluster_id) ?? [];
    if (members.length === 0) {
      const idSet = new Set(cluster.episode_ids);
      members = allEpisodes.filter((ep) => idSet.has(ep.episode_id));
    }
    if (members.length === 0) {
      return null;
    }

    const methodContent = members
      .map((ep) => `## Episode ${ep.episode_id}\n${ep.transferable_method}`)
      .join('\n\n');

    return new MethodCard({
      method_id: `method-${cluster.cluster_id}`,
      title: `Distilled from ${members.length} episodes (domain=${cluster.domain})`,
      domain: cluster.domain,
      knowledge_type: 'procedural',
      scope: 'team_shared',
      trust_level: 'experimental',
      lifecycle: 'draft',
      content: methodContent,
      source_refs: members.map((ep) => ep.episode_id),
      maturity_level: KnowledgeMaturityLevel.L2_DRAFT,
    });
  }

  // ── 前台浮现 ────────────────────────────────────────────────────

  /**
   * I2: 浮现 Top K 重要梦境到前台（不修改原数据）。
   *
   * 重要性 = surprise * 0.5 + size_score * 0.3 + has_distilled * 0.2
   */
  private surfaceTopK(
    clusters: DreamCluster[],
    distilledCards: MethodCard[],
    topK: number,
  ): DreamSurfacePayload {
    const scored = clusters.map((cluster) => {
      const surprise = 1.0 - cluster.similarity_score;
      const sizeScore = Math.min(1.0, cluster.episode_ids.length / 10.0);
      const hasDistilled = distilledCards.some(
        (card) => card.method_id === `method-${cluster.cluster_id}`,
      )
        ? 1.0
        : 0.0;
      const importance = 0.5 * surprise + 0.3 * sizeScore + 0.2 * hasDistilled;
      return { cluster, importance };
    });

    scored.sort((a, b) => b.importance - a.importance);
    const topClusters = scored.slice(0, topK);

    return {
      items: topClusters.map(({ cluster, importance }) => ({
        cluster_id: cluster.cluster_id,
        domain: cluster.domain,
        episode_count: cluster.episode_ids.length,
        similarity_score: cluster.similarity_score,
        importance: Math.round(importance * 10000) / 10000,
        centroid_signature: cluster.centroid_signature,
      })),
      distilled_method_ids: distilledCards.map((card) => card.method_id),
      total_clusters: clusters.length,
      total_distilled: distilledCards.length,
    };
  }
}

// ──────────────────────────────────────────────────────────────────
// ID 生成
// ──────────────────────────────────────────────────────────────────

/** 生成 cycle_id: dream-cycle-{utc_timestamp}-{rand6hex} */
export function genCycleId(): string {
  const ts = Math.floor(Date.now() / 1000);
  return `dream-cycle-${ts}-${randomBytes(3).toString('hex')}`;
}

/** 生成 snapshot_id: dream-snapshot-{utc_timestamp}-{rand6hex} */
export function genSnapshotId(): string {
  const ts = Math.floor(Date.now() / 1000);
  return `dream-snapshot-${ts}-${randomBytes(3).toString('hex')}`;
}
