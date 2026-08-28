/**
 * @flowforge/cats-feat-trajectory — feat 轨迹 Cordis 插件（C26 FeatTrajectory，F233）。
 *
 * TS 移植自 clowder-ai `domains/feat-trajectory`（C26 域）：
 *   - keys：stale bucket 阈值 + 三源 entry id / subjectKey 派生 + store key namespace
 *   - store：IFeatTrajectoryStore port + InMemoryFeatTrajectoryStore（持久实现由宿主注入）
 *   - projector：FeatTrajectoryProjector 三源投影（event-stream / git-ref-snapshot /
 *     thread_split+thread_merge），rebuild-safe upsert（INV-2）+ updatedAt monotonic max
 *   - git-ref-collector：GitRefSnapshotCollector（git/gh IO 接口化注入 + heuristic
 *     feat join + multi-candidate policy 'skip-low-confidence'）
 *   - cross-post-collector / thread-split-collector：F252 前置 emit 器（IO 接口注入）
 *   - scheduler：FeatTrajectoryCollectorScheduler.tick()（git 失败降级 + lastCollectorTickAt
 *     freshness 诚实记录）
 *   - backfill：runBackfill() 历史回填纯函数
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsFeatTrajectory from '@flowforge/cats-feat-trajectory'
 * ctx.plugin(CatsFeatTrajectory)
 * // ctx.catsFeatTrajectory.createStore() / .createProjector(store)
 * // ctx.catsFeatTrajectory.createGitRefCollector({ gitRunner, ghClient, featIndexLookup, threadSearch })
 * // ctx.catsFeatTrajectory.createScheduler({ collector, projector, store })
 * ```
 *
 * @module @flowforge/cats-feat-trajectory
 */

import { Context, Service } from '@flowforge/cordis';
import type { FeatThreadJoinProvenance } from '@flowforge/cats-shared';

// 本地导入（re-export 前需本地绑定，供本文件类/方法签名引用）。
import {
  FeatTrajectoryKeys,
  makeCrossPostEntryId,
  makeEventStreamEntryId,
  makeFeatSubjectKey,
  makeGitRefEntryId,
  makeGitRefSubjectKey,
  makeStitchedEntryId,
  makeThreadSplitEntryId,
  STALE_BUCKET_THRESHOLDS_MS,
  staleBucketForAge,
} from './keys.js';
import type { GitRefEntryIdParts } from './keys.js';
import { InMemoryFeatTrajectoryStore } from './store.js';
import type { IFeatTrajectoryStore } from './store.js';
import { FeatTrajectoryProjector, mapBallCustodyEventToTrajectory } from './projector.js';
import {
  GitRefSnapshotCollector,
  applyMultiCandidatePolicy,
  heuristicFeatJoin,
} from './git-ref-collector.js';
import type {
  FeatIndexLookup,
  GhClient,
  GitBranchRef,
  GitCommitMeta,
  GitRefSnapshotCollectorOpts,
  GitRunner,
  HeuristicJoinResult,
  IGitRefSnapshotCollector,
  MultiCandidateDecision,
  MultiCandidatePolicy,
  PrInfo,
  ThreadMatch,
  ThreadSearch,
} from './git-ref-collector.js';
import { CrossPostCollector } from './cross-post-collector.js';
import type {
  CrossPostCollectorOptions,
  CrossPostSnapshot,
  IFeatIndexForCrossPost,
  IMessageStoreForCrossPost,
} from './cross-post-collector.js';
import { ThreadSplitCollector } from './thread-split-collector.js';
import type {
  IFeatIndexForSplit,
  IProposalStoreForSplit,
  ThreadSplitCollectorOptions,
  ThreadSplitSnapshot,
} from './thread-split-collector.js';
import { FeatTrajectoryCollectorScheduler } from './scheduler.js';
import type {
  FeatTrajectoryCollectorSchedulerOptions,
  FeatTrajectoryCollectorTickResult,
} from './scheduler.js';
import { runBackfill } from './backfill.js';
import type { FeatTrajectoryBackfillDeps, FeatTrajectoryBackfillResult } from './backfill.js';

// Re-export 核心实现 + 类型。
export {
  STALE_BUCKET_THRESHOLDS_MS,
  staleBucketForAge,
  makeFeatSubjectKey,
  makeGitRefSubjectKey,
  makeEventStreamEntryId,
  makeStitchedEntryId,
  makeThreadSplitEntryId,
  makeCrossPostEntryId,
  FeatTrajectoryKeys,
  makeGitRefEntryId,
};
export type { GitRefEntryIdParts };
export { InMemoryFeatTrajectoryStore };
export type { IFeatTrajectoryStore };
export { FeatTrajectoryProjector, mapBallCustodyEventToTrajectory };
export {
  GitRefSnapshotCollector,
  applyMultiCandidatePolicy,
  heuristicFeatJoin,
};
export type {
  FeatIndexLookup,
  FeatThreadJoinProvenance,
  GhClient,
  GitBranchRef,
  GitCommitMeta,
  GitRefSnapshotCollectorOpts,
  GitRunner,
  HeuristicJoinResult,
  IGitRefSnapshotCollector,
  MultiCandidateDecision,
  MultiCandidatePolicy,
  PrInfo,
  ThreadMatch,
  ThreadSearch,
};
export { CrossPostCollector };
export type {
  CrossPostCollectorOptions,
  CrossPostSnapshot,
  IFeatIndexForCrossPost,
  IMessageStoreForCrossPost,
};
export { ThreadSplitCollector };
export type {
  IFeatIndexForSplit,
  IProposalStoreForSplit,
  ThreadSplitCollectorOptions,
  ThreadSplitSnapshot,
};
export { FeatTrajectoryCollectorScheduler };
export type {
  FeatTrajectoryCollectorSchedulerOptions,
  FeatTrajectoryCollectorTickResult,
};
export { runBackfill };
export type { FeatTrajectoryBackfillDeps, FeatTrajectoryBackfillResult };

/** FeatTrajectoryService 构造选项（对齐插件默认行为；铁律 5 参数外置）。 */
export interface FeatTrajectoryServiceOptions {
  /** 分支扫描 pattern（缺省 ['fix/*', 'feat/*']）。 */
  readonly branchPatterns?: string[] | undefined;
  /** Multi-candidate policy（缺省 'skip-low-confidence'，production-safe）。 */
  readonly multiCandidatePolicy?: 'skip-low-confidence' | undefined;
  /** 时间函数注入（测试快进确定性；缺省 Date.now）。 */
  readonly now?: (() => number) | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** feat 轨迹域：三源投影器工厂 + collector 工厂 + scheduler 工厂 + backfill */
    catsFeatTrajectory: FeatTrajectoryService;
  }
}

/**
 * feat 轨迹域服务 — 组装 C26 projector / collectors / scheduler / backfill 工厂。
 *
 * 挂载 `ctx.catsFeatTrajectory`，提供：
 *   - createStore()：InMemoryFeatTrajectoryStore（tests/dev；持久实现宿主注入）
 *   - createProjector(store)：FeatTrajectoryProjector（三源 apply / rebuild-safe）
 *   - createGitRefCollector(deps)：GitRefSnapshotCollector（git/gh IO 注入）
 *   - createThreadSplitCollector(deps) / createCrossPostCollector(deps)：emit 器工厂
 *   - createScheduler(opts)：collector tick 调度器
 *   - runBackfill(deps)：历史回填纯函数（静态 re-export）
 */
export class FeatTrajectoryService extends Service {
  /** 分支扫描 pattern（collector 工厂默认）。 */
  readonly branchPatterns: string[];
  /** Multi-candidate policy（collector 工厂默认）。 */
  readonly multiCandidatePolicy: 'skip-low-confidence';
  /** 时间函数（scheduler / backfill 缺省注入）。 */
  readonly now: () => number;

  constructor(ctx: Context, options: FeatTrajectoryServiceOptions = {}) {
    super(ctx, 'catsFeatTrajectory');
    this.branchPatterns = options.branchPatterns ?? ['fix/*', 'feat/*'];
    this.multiCandidatePolicy = options.multiCandidatePolicy ?? 'skip-low-confidence';
    this.now = options.now ?? Date.now;
  }

  /** 创建 projection store（InMemory；tests + dev，持久实现按 port 宿主注入）。 */
  createStore(): InMemoryFeatTrajectoryStore {
    return new InMemoryFeatTrajectoryStore();
  }

  /** 创建三源投影器（store 注入，可换持久实现）。 */
  createProjector(store: IFeatTrajectoryStore): FeatTrajectoryProjector {
    return new FeatTrajectoryProjector(store);
  }

  /** 创建 git ref collector（git/gh/featIndex/threadSearch IO 由宿主注入）。 */
  createGitRefCollector(deps: {
    gitRunner: GitRunner;
    ghClient: GhClient;
    featIndexLookup: FeatIndexLookup;
    threadSearch: ThreadSearch;
    logger?: GitRefSnapshotCollectorOpts['logger'];
  }): GitRefSnapshotCollector {
    return new GitRefSnapshotCollector({
      branchPatterns: this.branchPatterns,
      multiCandidatePolicy: this.multiCandidatePolicy,
      ...deps,
    });
  }

  /** 创建 thread split collector（proposalStore + featIndex 注入）。 */
  createThreadSplitCollector(deps: {
    proposalStore: IProposalStoreForSplit;
    featIndex: IFeatIndexForSplit;
  }): ThreadSplitCollector {
    return new ThreadSplitCollector(deps);
  }

  /** 创建 cross-post collector（messageStore + featIndex 注入）。 */
  createCrossPostCollector(deps: {
    messageStore: IMessageStoreForCrossPost;
    featIndex: IFeatIndexForCrossPost;
  }): CrossPostCollector {
    return new CrossPostCollector(deps);
  }

  /** 创建 collector tick 调度器（collector/projector/store 注入）。 */
  createScheduler(opts: Omit<FeatTrajectoryCollectorSchedulerOptions, 'now'>): FeatTrajectoryCollectorScheduler {
    return new FeatTrajectoryCollectorScheduler({ ...opts, now: this.now });
  }
}

export default FeatTrajectoryService;
