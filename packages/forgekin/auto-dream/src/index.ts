/**
 * @flowforge/forgekin-auto-dream — 阶段7 T7.19 Auto Dream 梦境整合域 Cordis 插件
 *
 * 挂载 `ctx.forgeAutoDream`：CL-031 双层架构 — 后台 consolidation
 * （扫描 L0 EpisodeCard → 聚类 → 蒸馏 L2 MethodCard 草稿）+ 前台 surface
 * + 4 信号 telemetry，对齐 Python `evolution/auto_dream.py`（F20）。
 *
 * I5: 蒸馏产物仅为 L2_DRAFT 草稿，须经 Eval Ledger 验证（T7.18）才能合入。
 */
import { Context, Service } from '@flowforge/cordis';
import { BackgroundDreamLoop } from './background-loop.js';
import {
  DreamCycle,
  DreamCycleConfig,
  DreamSnapshot,
  EpisodeStore,
  InMemoryEpisodeStore,
  InMemoryMethodCardSink,
  MethodCardSink,
  makeDreamCycleConfig,
} from './dream-cycle.js';
import { SimilarityCalculator } from './similarity.js';

export * from './background-loop.js';
export * from './dream-cycle.js';
export * from './models.js';
export * from './similarity.js';
export * from './telemetry.js';

export interface AutoDreamServiceOptions {
  /** 经验记忆存储（默认内存实现） */
  readonly episodeStore?: EpisodeStore | undefined;
  /** MethodCard 草稿输出（默认内存实现） */
  readonly methodCardSink?: MethodCardSink | undefined;
  /** 梦境循环配置（默认值见 makeDreamCycleConfig） */
  readonly config?: Partial<DreamCycleConfig> | undefined;
  /** 相似度计算器注入（默认关键词重叠实现） */
  readonly similarityCalculator?: SimilarityCalculator | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Auto Dream 域：梦境整合（聚类 + 蒸馏 + 浮现） */
    forgeAutoDream: AutoDreamService;
  }
}

export class AutoDreamService extends Service {
  /** 经验记忆存储（Auto Dream 输入源） */
  readonly episodeStore: EpisodeStore;
  /** MethodCard 草稿输出 */
  readonly methodCardSink: MethodCardSink;
  /** 梦境循环配置 */
  readonly config: DreamCycleConfig;
  /** 后台梦境循环管理器 */
  readonly loop: BackgroundDreamLoop;

  constructor(ctx: Context, options: AutoDreamServiceOptions = {}) {
    super(ctx, 'forgeAutoDream');
    this.episodeStore = options.episodeStore ?? new InMemoryEpisodeStore();
    this.methodCardSink = options.methodCardSink ?? new InMemoryMethodCardSink();
    this.config = makeDreamCycleConfig(options.config);
    this.loop = new BackgroundDreamLoop({
      episodeStore: this.episodeStore,
      methodCardSink: this.methodCardSink,
      config: this.config,
      similarityCalculator: options.similarityCalculator,
    });
  }

  // ── 门面 ────────────────────────────────────────────────────

  /** 执行单次梦境循环（不等后台间隔） */
  async runDreamCycle(): Promise<DreamSnapshot> {
    const cycle = new DreamCycle({
      episodeStore: this.episodeStore,
      methodCardSink: this.methodCardSink,
      config: this.config,
    });
    return cycle.runOnce();
  }

  /** 立即触发后台循环的一次梦境（正在执行时返回 null） */
  triggerNow(): Promise<DreamSnapshot | null> {
    return this.loop.triggerNow();
  }

  /** I4: Magic Words 中断当前梦境循环 */
  interrupt(): void {
    this.loop.interruptCurrentCycle();
  }

  /** 启动后台梦境循环（enable_background_loop 关闭时为 no-op） */
  startLoop(): void {
    if (!this.config.enable_background_loop) {
      return;
    }
    this.loop.start();
  }

  /** 优雅停止后台梦境循环 */
  stopLoop(timeoutMs = 30_000): Promise<void> {
    return this.loop.stop(timeoutMs);
  }

  /** 最近一次梦境快照 */
  get lastSnapshot(): DreamSnapshot | null {
    return this.loop.lastSnapshot;
  }

  /** 服务状态快照（供可观测性查询） */
  getStatus(): Record<string, unknown> {
    return {
      running: this.loop.isRunning,
      consolidation_interval_seconds: this.config.consolidation_interval_seconds,
      surface_top_k: this.config.surface_top_k,
      cluster_similarity_threshold: this.config.cluster_similarity_threshold,
      last_snapshot: this.loop.lastSnapshot
        ? {
            snapshot_id: this.loop.lastSnapshot.snapshot_id,
            cycle_id: this.loop.lastSnapshot.cycle_id,
            phase: this.loop.lastSnapshot.phase,
            interrupted: this.loop.lastSnapshot.interrupted,
            telemetry: this.loop.lastSnapshot.telemetry,
          }
        : null,
    };
  }
}

export default function Plugin(ctx: Context, options?: AutoDreamServiceOptions) {
  return ctx.plugin(AutoDreamService, options);
}
