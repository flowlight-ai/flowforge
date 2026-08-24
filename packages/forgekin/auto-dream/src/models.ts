/**
 * auto-dream models — L0/L2 知识卡片数据模型（对齐 Python evolution/models.py）。
 *
 * EpisodeCard（L0 原始记录）→ 蒸馏 → MethodCard（L2 草稿），
 * 五级成熟度阶梯 KnowledgeMaturityLevel（L0-L4）。
 *
 * @module @flowforge/forgekin-auto-dream
 */

import { randomBytes } from 'node:crypto';

/** 五级知识成熟度阶梯（对齐 Python KnowledgeMaturityLevel） */
export enum KnowledgeMaturityLevel {
  /** L0 Episode — 原始记录：模板完整，已分离可迁移/不可迁移 */
  L0_EPISODE = 'L0',
  /** L1 Pattern — 草稿：≥2 个相似 episode（180天内），或人类要求；5Q ≥ 7/10 */
  L1_PATTERN = 'L1',
  /** L2 Draft — Method Card / Skill Draft：smoke gate + promotion gate */
  L2_DRAFT = 'L2',
  /** L3 Validated — 正式 method/skill：≥6 uses，≥2 agents，≥80% */
  L3_VALIDATED = 'L3',
  /** L4 Standard — 团队标准：≥12 uses，最近 10 次 ≥90%，用户批准 */
  L4_STANDARD = 'L4',
}

/** 蒸馏方向（method_card / skill_draft / memory） */
export type DistillationDirection = 'method_card' | 'skill_draft' | 'memory';

/** EpisodeCard 构造参数（除必填外全可选） */
export interface EpisodeCardInit {
  readonly episode_id?: string | undefined;
  readonly task_snapshot: string;
  readonly evidence_map?: Record<string, unknown> | undefined;
  readonly decision_timeline?: Array<Record<string, unknown>> | undefined;
  readonly collaboration_pivots?: Array<Record<string, unknown>> | undefined;
  readonly transferable_method: string;
  readonly non_transferable_facts: string;
  readonly safety_boundary: string;
  readonly distillation_direction?: DistillationDirection | undefined;
  readonly created_at?: string | undefined;
}

/**
 * Episode Card — 高价值协作后的结构化事件快照（L0）。
 *
 * 可蒸馏为 Method Card / Skill Draft / Memory。
 */
export class EpisodeCard {
  episode_id: string;
  /** 情境 + 风险等级 */
  task_snapshot: string;
  /** 证据来源 + 可靠性 */
  evidence_map: Record<string, unknown>;
  /** 推理转折点 */
  decision_timeline: Array<Record<string, unknown>>;
  /** human cue → AI interpretation → effect → lesson */
  collaboration_pivots: Array<Record<string, unknown>>;
  /** 蒸馏种子 */
  transferable_method: string;
  non_transferable_facts: string;
  safety_boundary: string;
  distillation_direction: DistillationDirection;
  created_at: string;

  constructor(init: EpisodeCardInit) {
    this.episode_id = init.episode_id ?? genEpisodeId();
    this.task_snapshot = init.task_snapshot;
    this.evidence_map = init.evidence_map ?? {};
    this.decision_timeline = init.decision_timeline ?? [];
    this.collaboration_pivots = init.collaboration_pivots ?? [];
    this.transferable_method = init.transferable_method;
    this.non_transferable_facts = init.non_transferable_facts;
    this.safety_boundary = init.safety_boundary;
    this.distillation_direction = init.distillation_direction ?? 'method_card';
    this.created_at = init.created_at ?? new Date().toISOString();
  }
}

/** MethodCard 构造参数 */
export interface MethodCardInit {
  readonly method_id?: string | undefined;
  readonly title: string;
  readonly domain: string;
  readonly knowledge_type?: string | undefined;
  readonly scope?: string | undefined;
  readonly trust_level?: string | undefined;
  readonly lifecycle?: string | undefined;
  readonly content: string;
  readonly source_refs?: string[] | undefined;
  readonly maturity_level?: KnowledgeMaturityLevel | string | undefined;
  readonly created_at?: string | undefined;
}

/**
 * Method Card — 蒸馏后的可复用方法（L2 Draft / L3 Validated）。
 *
 * knowledge_type: declarative | procedural | analytical | metacognitive
 * trust_level: experimental | tested | validated | production
 * lifecycle: draft | active | deprecated
 */
export class MethodCard {
  method_id: string;
  title: string;
  /** development / medical / legal / ... */
  domain: string;
  knowledge_type: string;
  /** agent_local / team_shared */
  scope: string;
  trust_level: string;
  lifecycle: string;
  content: string;
  source_refs: string[];
  created_at: string;
  /** 关联五级阶梯（默认 L2） */
  maturity_level: string;

  constructor(init: MethodCardInit) {
    this.method_id = init.method_id ?? genMethodId();
    this.title = init.title;
    this.domain = init.domain;
    this.knowledge_type = init.knowledge_type ?? 'procedural';
    this.scope = init.scope ?? 'team_shared';
    this.trust_level = init.trust_level ?? 'experimental';
    this.lifecycle = init.lifecycle ?? 'draft';
    this.content = init.content;
    this.source_refs = init.source_refs ?? [];
    this.created_at = init.created_at ?? new Date().toISOString();
    this.maturity_level = init.maturity_level ?? KnowledgeMaturityLevel.L2_DRAFT;
  }
}

/** 生成 episode_id: episode-{ts}-{rand6hex} */
export function genEpisodeId(): string {
  const ts = Math.floor(Date.now() / 1000);
  return `episode-${ts}-${randomBytes(3).toString('hex')}`;
}

/** 生成 method_id: method-{ts}-{rand6hex} */
export function genMethodId(): string {
  const ts = Math.floor(Date.now() / 1000);
  return `method-${ts}-${randomBytes(3).toString('hex')}`;
}
