/**
 * @flowforge/cats-projects — projects 域 Cordis 插件（C28 Projects，F076/F070）。
 *
 * TS 移植自 clowder-ai `domains/projects`（C28 域）：
 *   - triage：computeBucket 纯函数（A-tag 硬门控 + 5 维评分 → 五桶）
 *   - risk-detection：detectRisks 8 信号自动检测（纯函数）
 *   - intent-card-store：Intent Card Stage 1-2（创建/triage/查询）
 *   - need-audit-frame-store：需求审计帧（每项目一帧 upsert）
 *   - resolution-store：Stage 3 澄清队列（open→answered/escalated）
 *   - slice-store：Stage 4 切片规划（per-project order 计数器）
 *   - reflux-pattern-store：方法论经验沉淀
 *   - external-project-store：外部项目（KV 注入接口 + P2-1 路径逃逸防护）
 *   - execution-digest-store：F070 dispatch 执行摘要
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsProjects from '@flowforge/cats-projects'
 * ctx.plugin(CatsProjects)
 * // ctx.catsProjects.createIntentCardStore() / .createExternalProjectStore(kv) / ...
 * ```
 *
 * @module @flowforge/cats-projects
 */

import { Context, Service } from '@flowforge/cordis';

import { computeBucket } from './triage.js';
import type { TriageBucketDecision } from './triage.js';
import { detectRisks } from './risk-detection.js';
import { ExecutionDigestStore } from './execution-digest-store.js';
import { ExternalProjectStore, MemoryExternalProjectKV } from './external-project-store.js';
import type { ExternalProjectKV } from './external-project-store.js';
import { IntentCardStore } from './intent-card-store.js';
import { NeedAuditFrameStore } from './need-audit-frame-store.js';
import { RefluxPatternStore } from './reflux-pattern-store.js';
import { ResolutionStore } from './resolution-store.js';
import { SliceStore } from './slice-store.js';

// Re-export 核心实现 + 类型。
export { computeBucket };
export type { TriageBucketDecision };
export { detectRisks };
export { ExecutionDigestStore };
export { ExternalProjectStore, MemoryExternalProjectKV };
export type { ExternalProjectKV };
export { IntentCardStore };
export { NeedAuditFrameStore };
export { RefluxPatternStore };
export { ResolutionStore };
export { SliceStore };
export {
  ExternalProjectKeys,
  generateSortableId,
} from './types.js';
export type {
  AnswerResolutionInput,
  CreateExternalProjectInput,
  CreateIntentCardInput,
  CreateNeedAuditFrameInput,
  CreateRefluxPatternInput,
  CreateResolutionInput,
  CreateSliceInput,
  DispatchExecutionDigest,
  DispatchMissionPack,
  DoneWhenResult,
  ExternalProject,
  IntentCard,
  NeedAuditFrame,
  RefluxCategory,
  RefluxPattern,
  ResolutionItem,
  ResolutionPath,
  ResolutionStatus,
  RiskDetectionResult,
  RiskSignal,
  SizeBand,
  Slice,
  SliceStatus,
  SliceType,
  SourceTag,
  TriageBucket,
  TriageIntentCardInput,
  TriageResult,
  UpdateSliceInput,
} from './types.js';
export type { CreateDigestInput } from './execution-digest-store.js';

/** ProjectsService 构造选项（对齐插件默认行为；铁律 5 参数外置）。 */
export interface ProjectsServiceOptions {
  /** 时间函数注入（测试快进确定性；缺省 Date.now）。 */
  readonly now?: (() => number) | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** projects 域：Intent Card / triage / slice / external project / digest 工厂 */
    catsProjects: ProjectsService;
  }
}

/**
 * projects 域服务 — 组装 C28 stores / 纯函数工厂。
 *
 * 挂载 `ctx.catsProjects`，提供：
 *   - createIntentCardStore() / createNeedAuditFrameStore() / createResolutionStore() /
 *     createSliceStore() / createRefluxPatternStore() / createExecutionDigestStore()
 *   - createExternalProjectStore(kv?)：KV 缺省 Memory 实现（持久实现宿主注入）
 *   - computeBucket / detectRisks：纯函数静态 re-export
 */
export class ProjectsService extends Service {
  /** 时间函数（id 生成缺省注入）。 */
  readonly now: () => number;

  constructor(ctx: Context, options: ProjectsServiceOptions = {}) {
    super(ctx, 'catsProjects');
    this.now = options.now ?? Date.now;
  }

  /** 创建 Intent Card store（Stage 1-2）。 */
  createIntentCardStore(): IntentCardStore {
    return new IntentCardStore();
  }

  /** 创建 Need Audit Frame store（每项目一帧）。 */
  createNeedAuditFrameStore(): NeedAuditFrameStore {
    return new NeedAuditFrameStore();
  }

  /** 创建 Stage 3 澄清队列 store。 */
  createResolutionStore(): ResolutionStore {
    return new ResolutionStore();
  }

  /** 创建 Stage 4 切片规划 store。 */
  createSliceStore(): SliceStore {
    return new SliceStore();
  }

  /** 创建方法论经验 store。 */
  createRefluxPatternStore(): RefluxPatternStore {
    return new RefluxPatternStore();
  }

  /** 创建 F070 执行摘要 store。 */
  createExecutionDigestStore(): ExecutionDigestStore {
    return new ExecutionDigestStore();
  }

  /** 创建外部项目 store（KV 注入，缺省 Memory 实现）。 */
  createExternalProjectStore(kv: ExternalProjectKV = new MemoryExternalProjectKV()): ExternalProjectStore {
    return new ExternalProjectStore(kv);
  }
}

export default ProjectsService;
