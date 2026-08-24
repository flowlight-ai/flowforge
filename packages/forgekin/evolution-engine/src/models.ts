/**
 * evolution-engine 数据模型 — TS 重写自 Python `evolution/models.py`（F100）。
 *
 * 三模式共享契约：
 * - ScopeGuardSignal / ScopeGuardLog（Mode A 偏离信号与触发日志）
 * - EvolutionProposal（Mode B 五槽提案模板）
 * - KnowledgeObject（CL-005 七字段契约 + 成熟度→置信度映射）
 *
 * EpisodeCard / MethodCard / EvalLedger 已由 `@flowforge/forgekin-knowledge`
 * 迁移（批次1），此处不再重复定义；MaturityLevel 复用
 * `@flowforge/forgekin-stage`（批次2）。
 */

import type { MaturityLevel } from '@flowforge/forgekin-stage';

// ── Mode A: Scope Guard ──────────────────────────────────────────

/** Scope Guard 偏离信号（对齐 Python ScopeGuardSignal）。 */
export const SCOPE_GUARD_SIGNALS = [
  'not_serving_vision',
  'new_journey',
  'new_dependency',
  'unclear_verification',
] as const;

export type ScopeGuardSignal = (typeof SCOPE_GUARD_SIGNALS)[number];

/** Scope Guard 触发日志（对齐 Python ScopeGuardLog）。 */
export interface ScopeGuardLog {
  readonly date: string;
  readonly featureId: string;
  readonly signalType: string;
  readonly actionTaken: string;
  readonly outcome: string;
  readonly agent: string;
}

export function makeScopeGuardLog(init: Omit<ScopeGuardLog, 'date'> & { date?: string }): ScopeGuardLog {
  return { date: init.date ?? new Date().toISOString(), ...init };
}

// ── Mode B: Process Evolution ────────────────────────────────────

/** 提案状态机：proposed → accepted（关联 commit）→ 30 天 replay check。 */
export const PROPOSAL_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** 触发类型（对齐 Python _VALID_TRIGGER_TYPES）。 */
export const TRIGGER_TYPES = [
  'repeated_error',
  'user_correction',
  'sop_gap',
  'review_systemic',
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];

/**
 * Process Evolution 提案 — 5 槽模板。
 *
 * 五槽：Trigger / Evidence / Root Cause / Lever / Verify。
 * 硬护栏：证据 ≥2 源、最小杠杆优先、先修当前再提改进、提案要短。
 */
export interface EvolutionProposal {
  readonly proposalId: string;
  readonly triggerType: string;
  /** "sop" | "skill" | "rule" | "memory" | "system_prompt" | "l0" */
  readonly target: string;
  readonly status: ProposalStatus;
  readonly trigger: string;
  /** 证据源（≥2 源硬护栏） */
  readonly evidence: string[];
  readonly rootCause: string;
  /** 最小杠杆（对齐 LEVERAGE_ORDER） */
  readonly lever: string;
  /** 验证方式 */
  readonly verify: string;
  readonly impactAssessment: string;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
  /** accepted → 必须关联 commit/PR（落地闭环硬护栏） */
  readonly commitRef: string;
  /** 30 天验证到期时间（UTC ISO） */
  readonly replayCheckDue: string | null;
}

export interface MakeEvolutionProposalInit {
  proposalId: string;
  triggerType: string;
  target: string;
  trigger: string;
  evidence: string[];
  rootCause: string;
  lever: string;
  verify: string;
  status?: ProposalStatus;
  impactAssessment?: string;
  createdAt?: string;
  acceptedAt?: string | null;
  commitRef?: string;
  replayCheckDue?: string | null;
}

export function makeEvolutionProposal(init: MakeEvolutionProposalInit): EvolutionProposal {
  return {
    proposalId: init.proposalId,
    triggerType: init.triggerType,
    target: init.target,
    status: init.status ?? 'proposed',
    trigger: init.trigger,
    evidence: [...init.evidence],
    rootCause: init.rootCause,
    lever: init.lever,
    verify: init.verify,
    impactAssessment: init.impactAssessment ?? '',
    createdAt: init.createdAt ?? new Date().toISOString(),
    acceptedAt: init.acceptedAt ?? null,
    commitRef: init.commitRef ?? '',
    replayCheckDue: init.replayCheckDue ?? null,
  };
}

// ── CL-005 知识对象七字段契约 ─────────────────────────────────────

/** 知识产物类型：episode | method | skill | proposal | eval | lesson | log */
export type ArtifactType =
  | 'episode'
  | 'method'
  | 'skill'
  | 'proposal'
  | 'eval'
  | 'lesson'
  | 'log';

/** 来源作者类型：agent | human | collaborative */
export type AuthorType = 'agent' | 'human' | 'collaborative';

/**
 * 知识对象契约 — 统一描述所有进化产物。
 *
 * CL-005 七字段契约（v2 扩展，向后兼容）：
 * trigger / procedure / precondition / postcondition / anti_pattern /
 * provenance / confidence（基于 L0~L4 成熟度阶梯映射）。
 */
export interface KnowledgeObject {
  readonly artifactType: ArtifactType;
  readonly domain: string;
  readonly knowledgeType: string;
  /** "agent_local" | "team_shared" */
  readonly scope: string;
  readonly trustLevel: string;
  /** "draft" | "active" | "deprecated" | "frozen" */
  readonly lifecycle: string;
  readonly provenance: Record<string, unknown>;
  readonly sourceRefs: string[];
  readonly maturityLevel: MaturityLevel;
  // ── CL-005 七字段契约 ──
  /** 触发条件：何时使用此知识 */
  readonly trigger: string;
  /** 执行步骤：如何使用此知识 */
  readonly procedure: string;
  /** 前置条件：使用前必须满足 */
  readonly precondition: string;
  /** 后置条件：使用后必须达到 */
  readonly postcondition: string;
  /** 反模式：不应使用的场景 */
  readonly antiPattern: string;
  /** 置信度 0.0~1.0（基于成熟度阶梯映射） */
  readonly confidence: number;
}

/** CL-005 成熟度 → 置信度映射：L0=0.2 / L1=0.4 / L2=0.6 / L3=0.8 / L4=1.0。 */
export const MATURITY_CONFIDENCE_MAPPING: Record<MaturityLevel, number> = {
  L0: 0.2,
  L1: 0.4,
  L2: 0.6,
  L3: 0.8,
  L4: 1.0,
};

/** 根据成熟度等级计算置信度（未识别等级回退 0.2）。 */
export function confidenceFromMaturity(level: MaturityLevel): number {
  return MATURITY_CONFIDENCE_MAPPING[level] ?? 0.2;
}

export interface MakeKnowledgeObjectInit {
  artifactType: ArtifactType;
  domain: string;
  knowledgeType: string;
  scope: string;
  trustLevel: string;
  lifecycle?: string;
  provenance?: Record<string, unknown>;
  sourceRefs?: string[];
  maturityLevel?: MaturityLevel;
  trigger?: string;
  procedure?: string;
  precondition?: string;
  postcondition?: string;
  antiPattern?: string;
}

export function makeKnowledgeObject(init: MakeKnowledgeObjectInit): KnowledgeObject {
  const maturityLevel = init.maturityLevel ?? 'L0';
  return {
    artifactType: init.artifactType,
    domain: init.domain,
    knowledgeType: init.knowledgeType,
    scope: init.scope,
    trustLevel: init.trustLevel,
    lifecycle: init.lifecycle ?? 'draft',
    provenance: { ...init.provenance },
    sourceRefs: [...(init.sourceRefs ?? [])],
    maturityLevel,
    trigger: init.trigger ?? '',
    procedure: init.procedure ?? '',
    precondition: init.precondition ?? '',
    postcondition: init.postcondition ?? '',
    antiPattern: init.antiPattern ?? '',
    confidence: confidenceFromMaturity(maturityLevel),
  };
}
