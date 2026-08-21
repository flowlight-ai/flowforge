/**
 * @flowforge/forgekin-knowledge — 阶段7 T7.4 知识进化数据模型
 *
 * 本地化自 flowforge Python `evolution/models.py`（F100 Self-Evolution Data Models）：
 * - 五级知识成熟度阶梯 (KnowledgeMaturityLevel)
 * - 知识对象契约 (KnowledgeObject, CL-005 七字段)
 * - EpisodeCard / MethodCard / EvalLedger（蒸馏管线三产物）
 * - ScopeGuard 信号 + EvolutionProposal（后续 T7.20 引擎复用）
 *
 * @module @flowforge/forgekin-knowledge/models
 */

/** Scope Guard 偏离信号（T7.20 引擎复用） */
export const SCOPE_GUARD_SIGNALS = [
  'not_serving_vision',
  'new_journey',
  'new_dependency',
  'unclear_verification',
] as const;
export type ScopeGuardSignal = (typeof SCOPE_GUARD_SIGNALS)[number];

export interface ScopeGuardLog {
  date: string;
  featureId: string;
  signalType: string;
  actionTaken: string;
  outcome: string;
  agent: string;
}

export function makeScopeGuardLog(init: Omit<ScopeGuardLog, 'date'>): ScopeGuardLog {
  return { date: new Date().toISOString(), ...init };
}

export const PROPOSAL_TRIGGER_TYPES = ['repeated_error', 'user_correction', 'sop_gap', 'review_systemic'] as const;
export const PROPOSAL_TARGETS = ['sop', 'skill', 'rule', 'memory', 'system_prompt', 'l0'] as const;
export const PROPOSAL_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'] as const;

/** Process Evolution 提案 — 5 槽模板（Trigger/Evidence/Root Cause/Lever/Verify，证据 ≥2 源） */
export interface EvolutionProposal {
  proposalId: string;
  triggerType: (typeof PROPOSAL_TRIGGER_TYPES)[number];
  target: (typeof PROPOSAL_TARGETS)[number];
  status: (typeof PROPOSAL_STATUSES)[number];
  trigger: string;
  evidence: string[];
  rootCause: string;
  lever: string;
  verify: string;
  impactAssessment: string;
  createdAt: string;
  acceptedAt?: string;
  commitRef: string;
  replayCheckDue?: string;
}

export function makeEvolutionProposal(init: Pick<EvolutionProposal, 'proposalId' | 'triggerType' | 'target' | 'trigger' | 'rootCause' | 'lever' | 'verify'> & Partial<Omit<EvolutionProposal, 'proposalId' | 'triggerType' | 'target' | 'trigger' | 'rootCause' | 'lever' | 'verify'>>): EvolutionProposal {
  return {
    status: 'proposed',
    evidence: [],
    impactAssessment: '',
    createdAt: new Date().toISOString(),
    commitRef: '',
    ...init,
  };
}

/** Episode Card — 高价值协作后的结构化事件快照（L0 原始记录） */
export interface EpisodeCard {
  episodeId: string;
  /** 情境 + 风险等级 */
  taskSnapshot: string;
  /** 证据来源 + 可靠性 */
  evidenceMap: Record<string, unknown>;
  /** 推理转折点 */
  decisionTimeline: Record<string, unknown>[];
  /** human cue → AI interpretation → effect → lesson */
  collaborationPivots: Record<string, unknown>[];
  /** 蒸馏种子 */
  transferableMethod: string;
  nonTransferableFacts: string;
  safetyBoundary: string;
  /** method_card | skill_draft | memory */
  distillationDirection: string;
  createdAt: string;
}

export function makeEpisodeCard(init: Omit<EpisodeCard, 'createdAt'>): EpisodeCard {
  return { ...init, createdAt: new Date().toISOString() };
}

export const KNOWLEDGE_TYPES = ['declarative', 'procedural', 'analytical', 'metacognitive'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const TRUST_LEVELS = ['experimental', 'tested', 'validated', 'production'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const LIFECYCLES = ['draft', 'active', 'deprecated', 'frozen'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** Method Card — 蒸馏后的可复用方法（L2 Draft / L3 Validated） */
export interface MethodCard {
  methodId: string;
  title: string;
  domain: string;
  knowledgeType: KnowledgeType;
  /** agent_local | team_shared */
  scope: string;
  trustLevel: TrustLevel;
  lifecycle: Lifecycle;
  content: string;
  sourceRefs: string[];
  createdAt: string;
  maturityLevel: string;
}

export function makeMethodCard(init: Pick<MethodCard, 'methodId' | 'title' | 'content'> & Partial<Omit<MethodCard, 'methodId' | 'title' | 'content'>>): MethodCard {
  return {
    domain: 'general',
    knowledgeType: 'procedural',
    scope: 'agent_local',
    trustLevel: 'experimental',
    lifecycle: 'draft',
    sourceRefs: [],
    maturityLevel: 'L2',
    createdAt: new Date().toISOString(),
    ...init,
  };
}

/** Eval case（A/B paired，含 case_id/category/passed） */
export interface EvalCase {
  caseId: string;
  /** standard_success | boundary_escalation | conflict_counterexample */
  category: string;
  passed: boolean;
}

/** Eval Ledger — Replay A/B 验证知识净增益（进化级 Eval，CL-004） */
export interface EvalLedger {
  evalId: string;
  methodId: string;
  proposalId: string;
  /** 前测分数（A 组）0.0-1.0 */
  preScore: number;
  /** 后测分数（B 组）0.0-1.0 */
  postScore: number;
  /** 净增益 = post - pre，必须 > 0 才允许合入 */
  netGain: number;
  cases: EvalCase[];
  /** 四维评审：boundary_compliance/evidence_handling/knowledge_application/human_edit_volume */
  judgeRubric: Record<string, number>;
  /** Smoke gate: 3 cases, ≥2/3 pass */
  smokeGatePassed: boolean;
  /** Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类 */
  promotionGatePassed: boolean;
  merged: boolean;
  rejectReason: string;
  createdAt: string;
}

export function makeEvalLedger(init: Pick<EvalLedger, 'evalId' | 'methodId'> & Partial<Omit<EvalLedger, 'evalId' | 'methodId'>>): EvalLedger {
  return {
    proposalId: '',
    preScore: 0,
    postScore: 0,
    netGain: 0,
    cases: [],
    judgeRubric: { boundary_compliance: 0, evidence_handling: 0, knowledge_application: 0, human_edit_volume: 0 },
    smokeGatePassed: false,
    promotionGatePassed: false,
    merged: false,
    rejectReason: '',
    createdAt: new Date().toISOString(),
    ...init,
  };
}

/** 五级知识成熟度阶梯（L0 Episode → L4 Standard） */
export const KNOWLEDGE_MATURITY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type KnowledgeMaturityLevel = (typeof KNOWLEDGE_MATURITY_LEVELS)[number];

/** 成熟度 → 置信度映射（CL-005：L0=0.2, L1=0.4, L2=0.6, L3=0.8, L4=1.0） */
export const MATURITY_CONFIDENCE: Record<KnowledgeMaturityLevel, number> = {
  L0: 0.2,
  L1: 0.4,
  L2: 0.6,
  L3: 0.8,
  L4: 1.0,
};

export const ARTIFACT_TYPES = ['episode', 'method', 'skill', 'proposal', 'eval', 'lesson', 'log'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** KnowledgeObject — 知识对象契约（CL-005 七字段 v2 扩展） */
export interface KnowledgeObject {
  artifactType: ArtifactType;
  domain: string;
  knowledgeType: string;
  /** agent_local | team_shared */
  scope: string;
  trustLevel: string;
  lifecycle: string;
  /** author_type: agent | human | collaborative */
  provenance: Record<string, unknown>;
  sourceRefs: string[];
  maturityLevel: KnowledgeMaturityLevel;
  /** CL-005 七字段契约 */
  trigger: string;
  procedure: string;
  precondition: string;
  postcondition: string;
  antiPattern: string;
  confidence: number;
}

export function makeKnowledgeObject(init: Pick<KnowledgeObject, 'artifactType' | 'domain' | 'knowledgeType' | 'scope' | 'trustLevel' | 'lifecycle'> & Partial<Omit<KnowledgeObject, 'artifactType' | 'domain' | 'knowledgeType' | 'scope' | 'trustLevel' | 'lifecycle'>>): KnowledgeObject {
  const { confidence: explicitConfidence, ...rest } = init;
  return {
    provenance: {},
    sourceRefs: [],
    maturityLevel: 'L0',
    trigger: '',
    procedure: '',
    precondition: '',
    postcondition: '',
    antiPattern: '',
    ...rest,
    // CL-005：未显式给定 confidence 时按成熟度阶梯计算（L0=0.2 … L4=1.0）
    confidence: explicitConfidence ?? computeConfidenceFromMaturity(rest.maturityLevel ?? 'L0'),
  };
}

/** 根据成熟度阶梯计算置信度（CL-005 映射规则） */
export function computeConfidenceFromMaturity(maturityLevel: KnowledgeMaturityLevel): number {
  return MATURITY_CONFIDENCE[maturityLevel] ?? 0.2;
}
