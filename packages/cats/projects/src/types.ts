/**
 * @flowforge/cats-projects — projects 域类型（F076 Intent Card 六件套 + F070 digest + F076 外部项目）。
 *
 * TS 移植自 clowder-ai `packages/shared/src/types/*`（intent-card / external-project /
 * capability / reflux / resolution / slice）+ `stores/redis-keys/community/external-project-keys`。
 *
 * @module @flowforge/cats-projects/types
 */

import { randomUUID } from 'node:crypto';

// ─── F076 Intent Card + Need Audit ───────────────────────────────────

/** 来源标签：Q=quote / O=observation / D=deduction / R=reference / A=AI-inferred。 */
export type SourceTag = 'Q' | 'O' | 'D' | 'R' | 'A';

/** Triage 五桶：立即构建 / 先澄清 / 先验证 / 挑战 / 延后。 */
export type TriageBucket = 'build_now' | 'clarify_first' | 'validate_first' | 'challenge' | 'later';

/** 规模档位。 */
export type SizeBand = 'S' | 'M' | 'L' | 'XL';

/** Stage 3 澄清路径。 */
export type ResolutionPath = 'confirmation' | 'evidence' | 'artifact' | 'prototype' | 'escalation' | null;

/** 风险信号（8 类自动检测）。 */
export type RiskSignal =
  | 'hollow_verbs'
  | 'missing_actors'
  | 'unknown_data_source'
  | 'missing_success_signal'
  | 'missing_edge_cases'
  | 'hidden_dependencies'
  | 'ai_fake_specificity'
  | 'scope_creep';

/** Stage 2 评分结果。 */
export interface TriageResult {
  readonly clarity: 1 | 2 | 3;
  readonly groundedness: 1 | 2 | 3;
  readonly necessity: 1 | 2 | 3;
  readonly coupling: 1 | 2 | 3;
  readonly sizeBand: SizeBand;
  readonly bucket: TriageBucket;
  readonly resolutionPath: ResolutionPath;
}

/** Intent Card v2 — 需求翻译官产物（6 核心槽位 + 元数据 + triage）。 */
export interface IntentCard {
  readonly id: string;
  readonly projectId: string;

  // Core slots (6)
  readonly actor: string;
  readonly contextTrigger: string;
  readonly goal: string;
  readonly objectState: string;
  readonly successSignal: string;
  readonly nonGoal: string;

  // Metadata
  readonly sourceTag: SourceTag;
  readonly sourceDetail: string;
  readonly decisionOwner: string;
  readonly confidence: 1 | 2 | 3;
  readonly dependencyTags: readonly string[];
  readonly riskSignals: readonly RiskSignal[];

  // Triage result (null before Stage 2)
  readonly triage: TriageResult | null;

  // Original text from PRD
  readonly originalText: string;

  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 创建 Intent Card 输入。 */
export interface CreateIntentCardInput {
  readonly projectId: string;
  readonly actor: string;
  readonly contextTrigger: string;
  readonly goal: string;
  readonly objectState: string;
  readonly successSignal: string;
  readonly nonGoal: string;
  readonly sourceTag: SourceTag;
  readonly sourceDetail: string;
  readonly decisionOwner: string;
  readonly confidence: 1 | 2 | 3;
  readonly dependencyTags?: readonly string[];
  readonly riskSignals?: readonly RiskSignal[];
  readonly originalText: string;
}

/** Triage 评分输入（5 维）。 */
export interface TriageIntentCardInput {
  readonly clarity: 1 | 2 | 3;
  readonly groundedness: 1 | 2 | 3;
  readonly necessity: 1 | 2 | 3;
  readonly coupling: 1 | 2 | 3;
  readonly sizeBand: SizeBand;
}

/** Need Audit Frame — 每项目一帧。 */
export interface NeedAuditFrame {
  readonly id: string;
  readonly projectId: string;
  readonly sponsor: string;
  readonly motivation: string;
  readonly successMetric: string;
  readonly constraints: string;
  readonly currentWorkflow: string;
  readonly provenanceMap: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 创建 Need Audit Frame 输入。 */
export interface CreateNeedAuditFrameInput {
  readonly sponsor: string;
  readonly motivation: string;
  readonly successMetric: string;
  readonly constraints: string;
  readonly currentWorkflow: string;
  readonly provenanceMap: string;
}

/** 风险检测结果。 */
export interface RiskDetectionResult {
  readonly signal: RiskSignal;
  readonly severity: 'critical' | 'high' | 'medium';
  readonly evidence: string;
  readonly autoDetected: boolean;
}

// ─── F076 External Project ───────────────────────────────────────────

/** 外部项目（F076）— sourcePath + backlogPath，backlogPath 不得逃逸 sourcePath（P2-1）。 */
export interface ExternalProject {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly backlogPath: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 创建外部项目输入。 */
export interface CreateExternalProjectInput {
  readonly name: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly backlogPath?: string;
}

/** 外部项目 KV key 派生（对齐 clowder redis-keys/community/external-project-keys）。 */
export const ExternalProjectKeys = {
  detail: (id: string) => `external:project:${id}`,
  userList: (userId: string) => `external:projects:user:${userId}`,
} as const;

// ─── F070 Dispatch Execution Digest ──────────────────────────────────

/** F070 Phase 2: 结构化任务上下文。 */
export interface DispatchMissionPack {
  /** 1-3 句：本次 dispatch 目的。 */
  readonly mission: string;
  /** 外部项目自己的 work item ID（或 thread 标题兜底）。 */
  readonly workItem: string;
  /** 当前工作流阶段。 */
  readonly phase: string;
  /** 至多 3 条完成判据。 */
  readonly doneWhen: readonly string[];
  /** 关联入口链接。 */
  readonly links: readonly string[];
}

/** F070 Phase 3: 单条判据通过/失败结果。 */
export interface DoneWhenResult {
  readonly criterion: string;
  readonly met: boolean;
  readonly evidence: string;
}

/** F070 Phase 3: dispatch 完成后的结构化执行摘要。 */
export interface DispatchExecutionDigest {
  readonly id: string;
  readonly userId: string;
  readonly projectPath: string;
  readonly threadId: string;
  readonly catId: string;
  readonly missionPack: DispatchMissionPack;
  readonly completedAt: number;
  readonly summary: string;
  readonly filesChanged: readonly string[];
  readonly status: 'completed' | 'partial' | 'blocked';
  readonly doneWhenResults: readonly DoneWhenResult[];
  readonly nextSteps: readonly string[];
}

// ─── F076 Reflux Pattern ─────────────────────────────────────────────

/** 方法论经验类别。 */
export type RefluxCategory = 'methodology' | 'risk_pattern' | 'resolution_strategy';

/** 方法论经验沉淀。 */
export interface RefluxPattern {
  readonly id: string;
  readonly projectId: string;
  readonly category: RefluxCategory;
  readonly title: string;
  readonly insight: string;
  readonly evidence: string;
  readonly createdAt: number;
}

/** 创建 Reflux Pattern 输入。 */
export interface CreateRefluxPatternInput {
  readonly category: RefluxCategory;
  readonly title: string;
  readonly insight: string;
  readonly evidence: string;
}

// ─── F076 Resolution (Stage 3) ───────────────────────────────────────

/** 澄清条目状态。 */
export type ResolutionStatus = 'open' | 'answered' | 'escalated';

/** Stage 3 澄清队列条目。 */
export interface ResolutionItem {
  readonly id: string;
  readonly projectId: string;
  readonly cardId: string;
  readonly path: ResolutionPath;
  readonly question: string;
  readonly options: readonly string[];
  readonly recommendation: string;
  readonly status: ResolutionStatus;
  readonly answer: string;
  readonly answeredAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 创建澄清条目输入。 */
export interface CreateResolutionInput {
  readonly cardId: string;
  readonly path: ResolutionPath;
  readonly question: string;
  readonly options?: readonly string[];
  readonly recommendation?: string;
}

/** 回答澄清条目输入。 */
export interface AnswerResolutionInput {
  readonly answer: string;
}

// ─── F076 Slice (Stage 4) ────────────────────────────────────────────

/** Slice 类型。 */
export type SliceType = 'learning' | 'value' | 'hardening';

/** Slice 状态。 */
export type SliceStatus = 'planned' | 'in_progress' | 'delivered' | 'validated';

/** Stage 4 切片计划。 */
export interface Slice {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly sliceType: SliceType;
  readonly description: string;
  readonly cardIds: readonly string[];
  readonly actor: string;
  readonly workflow: string;
  readonly verifiableOutcome: string;
  readonly order: number;
  readonly status: SliceStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 创建 Slice 输入。 */
export interface CreateSliceInput {
  readonly name: string;
  readonly sliceType: SliceType;
  readonly description: string;
  readonly cardIds?: readonly string[];
  readonly actor: string;
  readonly workflow: string;
  readonly verifiableOutcome: string;
}

/** 更新 Slice 输入。 */
export interface UpdateSliceInput {
  readonly name?: string;
  readonly description?: string;
  readonly cardIds?: readonly string[];
  readonly actor?: string;
  readonly workflow?: string;
  readonly verifiableOutcome?: string;
}

// ─── ID 生成 ─────────────────────────────────────────────────────────

let seq = 0;

/**
 * 生成可排序 ID：16 位时间戳-6 位序号-8 位 uuid 后缀。
 * 对齐 clowder `generateSortableId`（MessageStore.ts）；仅保留时间戳合法性校验，
 * 不引入 message store 的额外约束。
 */
export function generateSortableId(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError(`timestamp must be a finite non-negative number (got: ${timestamp})`);
  }
  const ts = String(timestamp).padStart(16, '0');
  const seqPart = String(seq++ % 1_000_000).padStart(6, '0');
  const suffix = randomUUID().slice(0, 8);
  return `${ts}-${seqPart}-${suffix}`;
}
