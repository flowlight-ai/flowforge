/**
 * @flowforge/forgekin-relationship — F036 ForgeRelationshipManager
 *
 * TS 移植自 `docs/features/F036-forgemind-forge-relationship.md` §3.2/§3.3。
 * 编码"通用 ↔ 垂直"双向流通的工程规则：
 *   - 通用 → 垂直（进化）：Eval ≥ 0.85 + 5+ 任务 + operator 批准后，
 *     能力画像从通用层复制到垂直层，新增垂直领域 SkillPackage。
 *   - 垂直 → 通用（回炉）：仅蒸馏通用能力（非垂直特定）回通用层，
 *     垂直特定能力保留在垂直层，operator 批准。
 *   - 跨层血缘追踪：所有 LayerTransition 写入 F038 进化谱系。
 *
 * 一切皆插件：垂直承载层由 *Forge 业务项目通过 registerLayer 动态注册
 * （核心层不硬编码具体 *Forge 项目名）。
 *
 * @module @flowforge/forgekin-relationship/manager
 */

import type { CapabilitySnapshot, ForgeLayer, ForgeRelationship, LayerTransition, TransitionEvidence, TransitionType } from './models.js';
import { computeCapabilityDelta, validateLayer } from './models.js';

/** 跨层迁移规则（来自 YAML transition_rules，配置驱动） */
export interface TransitionRules {
  readonly min_eval_score: number;
  readonly min_task_count: number;
  readonly require_operator_approval: boolean;
  /** 回炉：仅蒸馏通用能力 */
  readonly distill_general_only: boolean;
  /** 回炉：垂直能力保留原层 */
  readonly preserve_vertical_in_original: boolean;
}

/** ForgeRelationshipManager 构造入参（store 可注入，跨插件共享） */
export interface ForgeRelationshipManagerOptions {
  /** 预创建的层注册表（缺省内置 forgemind 通用层） */
  readonly layers?: Map<string, ForgeLayer> | undefined;
  /** 预创建的关系表（缺省新建；测试可注入隔离） */
  readonly relationships?: Map<string, ForgeRelationship> | undefined;
  /** 跨层迁移规则（缺省从内置 forge-relationship.yaml 的 transition_rules 解析） */
  readonly rules?: Partial<TransitionRules> | undefined;
  /** 默认承载层 ID（缺省 "forgemind"） */
  readonly defaultLayerId?: string | undefined;
}

/** 从 YAML 配置字典解析 transition_rules（宽松解析，缺省回落内置默认） */
export function parseTransitionRules(raw: unknown): TransitionRules {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (key: string, fallback: number): number =>
    typeof src[key] === 'number' ? (src[key] as number) : fallback;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof src[key] === 'boolean' ? (src[key] as boolean) : fallback;
  return {
    min_eval_score: num('min_eval_score', 0.85),
    min_task_count: num('min_task_count', 5),
    require_operator_approval: bool('require_operator_approval', true),
    distill_general_only: bool('distill_general_only', true),
    preserve_vertical_in_original: bool('preserve_vertical_in_original', true),
  };
}

/** 从 YAML 配置字典解析 layers 段（key → ForgeLayer，宽松解析） */
export function parseLayers(raw: unknown): Map<string, ForgeLayer> {
  const layers = new Map<string, ForgeLayer>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return layers;
  }
  for (const [layerId, value] of Object.entries(raw as Record<string, unknown>)) {
    const src = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const strList = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
    const layer: ForgeLayer = {
      layer_id: layerId,
      role: src['role'] === 'vertical' ? 'vertical' : 'general',
      vertical_skills: strList(src['vertical_skills']),
      can_evolve_to: strList(src['can_evolve_to']),
      ...(typeof src['can_reclaim_to'] === 'string'
        ? { can_reclaim_to: src['can_reclaim_to'] }
        : {}),
    };
    layers.set(layerId, layer);
  }
  return layers;
}

/**
 * Forge Relationship 管理器 — forgemind 与 *Forge 关系的唯一入口。
 *
 * 状态内存驻留（Map 注入式存储，跨插件共享时预注入同一实例）。
 */
export class ForgeRelationshipManager {
  readonly layers: Map<string, ForgeLayer>;
  readonly rules: TransitionRules;
  readonly defaultLayerId: string;
  readonly relationships: Map<string, ForgeRelationship>;
  /** 待执行 / 已执行的跨层迁移（transition_id → 记录） */
  readonly transitions: Map<string, LayerTransition>;

  private transitionSeq = 0;

  constructor(options: ForgeRelationshipManagerOptions = {}) {
    this.layers = options.layers ?? new Map<string, ForgeLayer>();
    this.relationships = options.relationships ?? new Map<string, ForgeRelationship>();
    this.rules = {
      min_eval_score: 0.85,
      min_task_count: 5,
      require_operator_approval: true,
      distill_general_only: true,
      preserve_vertical_in_original: true,
      ...(options.rules ?? {}),
    };
    this.defaultLayerId = options.defaultLayerId ?? 'forgemind';
    this.transitions = new Map<string, LayerTransition>();
    if (!this.layers.has(this.defaultLayerId)) {
      this.layers.set(this.defaultLayerId, {
        layer_id: this.defaultLayerId,
        role: 'general',
        vertical_skills: [],
        can_evolve_to: [],
      });
    }
  }

  // ── 层注册表（插件扩展点）────────────────────────────────────────

  /** 注册承载层（*Forge 插件注册垂直层；自动把 layer_id 加入通用层 can_evolve_to） */
  registerLayer(layer: ForgeLayer): void {
    validateLayer(layer);
    if (this.layers.has(layer.layer_id)) {
      throw new Error(`承载层 ${layer.layer_id} 已注册——重复注册会破坏 can_evolve_to 拓扑。`);
    }
    this.layers.set(layer.layer_id, layer);
    if (layer.role === 'vertical') {
      const general = this.layers.get(this.defaultLayerId);
      if (general !== undefined) {
        const next: ForgeLayer = {
          ...general,
          can_evolve_to: [...general.can_evolve_to, layer.layer_id],
        };
        this.layers.set(this.defaultLayerId, next);
      }
    }
  }

  /** 按 ID 查询承载层（不存在抛错） */
  getLayer(layerId: string): ForgeLayer {
    const layer = this.layers.get(layerId);
    if (layer === undefined) {
      throw new Error(`承载层 ${layerId} 未注册——请先由插件 registerLayer。`);
    }
    return layer;
  }

  /** 列出全部承载层（注册顺序） */
  listLayers(): ForgeLayer[] {
    return [...this.layers.values()];
  }

  // ── 关系查询 ─────────────────────────────────────────────────────

  /** 查询 Forgekin 与承载层的关系（不存在抛错） */
  getRelationship(forgekinId: string): ForgeRelationship {
    const found = this.relationships.get(forgekinId);
    if (found === undefined) {
      throw new Error(`Forgekin ${forgekinId} 没有跨层关系记录——请先 initRelationship 建立出生记录。`);
    }
    return found;
  }

  /** 为新生 Forgekin 建立出生关系（锻造流水线联动；origin=current=默认承载层） */
  initRelationship(
    forgekinId: string,
    capabilityProfile: CapabilitySnapshot,
    originLayerId: string = this.defaultLayerId,
  ): ForgeRelationship {
    if (this.relationships.has(forgekinId)) {
      throw new Error(`Forgekin ${forgekinId} 已有关系记录——不可重复初始化。`);
    }
    const relation: ForgeRelationship = {
      forgekin_id: forgekinId,
      current_layer_id: originLayerId,
      origin_layer_id: originLayerId,
      evolution_history: [],
      capability_snapshot_per_layer: { [originLayerId]: { ...capabilityProfile } },
    };
    this.relationships.set(forgekinId, relation);
    return relation;
  }

  // ── 跨层迁移请求（F036 核心协议）────────────────────────────────

  /**
   * 通用 → 垂直（进化请求）。
   * 校验：Eval ≥ min_eval_score + 任务数 ≥ min_task_count + operator 批准。
   * 通过后生成 pending transition（executeTransition 执行）。
   */
  requestEvolveToVertical(
    forgekinId: string,
    targetLayerId: string,
    reason: string,
    evidence: TransitionEvidence,
  ): string {
    const relation = this.getRelationship(forgekinId);
    const target = this.getLayer(targetLayerId);
    if (target.role !== 'vertical') {
      throw new Error(`进化目标 ${targetLayerId} 不是垂直承载层（role=vertical）。`);
    }
    const source = this.getLayer(relation.current_layer_id);
    if (!source.can_evolve_to.includes(targetLayerId)) {
      throw new Error(
        `承载层 ${source.layer_id} 未声明 can_evolve_to=${targetLayerId}——进化拓扑不允许该迁移。`,
      );
    }
    this.assertEligible(evidence);
    return this.createTransition(
      forgekinId,
      relation.current_layer_id,
      targetLayerId,
      'evolve',
      reason,
      evidence,
    );
  }

  /**
   * 垂直 → 通用（回炉请求）。
   * 校验：operator 批准 + 源层声明 can_reclaim_to=forgemind。
   * 仅蒸馏通用能力（distill_general_only），垂直特定能力保留原层。
   */
  requestReclaimToForgemind(
    forgekinId: string,
    reason: string,
    evidence: TransitionEvidence,
  ): string {
    const relation = this.getRelationship(forgekinId);
    const source = this.getLayer(relation.current_layer_id);
    if (source.role !== 'vertical') {
      throw new Error(`回炉源层 ${source.layer_id} 不是垂直承载层——通用层无需回炉。`);
    }
    const reclaimTarget = source.can_reclaim_to ?? this.defaultLayerId;
    if (reclaimTarget !== this.defaultLayerId) {
      throw new Error(
        `垂直层 ${source.layer_id} 声明 can_reclaim_to=${reclaimTarget}，与 forgemind 通用层不一致——回炉协议仅支持回通用层。`,
      );
    }
    if (this.rules.require_operator_approval && !evidence.operator_approved) {
      throw new Error(
        `回炉必须 operator 批准——防止Forgekin擅自迁移导致能力丢失（F036 AC-4）。`,
      );
    }
    return this.createTransition(
      forgekinId,
      relation.current_layer_id,
      this.defaultLayerId,
      'reclaim',
      reason,
      evidence,
    );
  }

  /** 执行 pending 迁移（幂等：已执行返回既有记录） */
  executeTransition(transitionId: string): LayerTransition {
    const transition = this.transitions.get(transitionId);
    if (transition === undefined) {
      throw new Error(`迁移记录 ${transitionId} 不存在——请先 requestEvolveToVertical/requestReclaimToForgemind。`);
    }
    const relation = this.relationships.get(transition.forgekin_id);
    if (relation === undefined) {
      throw new Error(`迁移记录 ${transitionId} 的 Forgekin 关系丢失——数据不一致。`);
    }
    // 幂等：已执行的记录若仍是最近一次迁移则返回既有结果；
    // 若其后已有其他迁移发生，则该记录描述的状态已过时，拒绝再次执行。
    const historyIndex = relation.evolution_history.findIndex((t) => t.transition_id === transitionId);
    if (historyIndex >= 0) {
      const executed = relation.evolution_history[historyIndex]!;
      const last = relation.evolution_history[relation.evolution_history.length - 1]!;
      if (last.transition_id === transitionId) {
        return executed;
      }
      throw new Error(`迁移记录 ${transitionId} 已过期：其后已有迁移发生（当前状态不再适用该记录）。`);
    }
    if (relation.current_layer_id !== transition.from_layer_id) {
      throw new Error(
        `迁移记录 ${transitionId} 已过期：当前层 ${relation.current_layer_id} ≠ 记录源层 ${transition.from_layer_id}。`,
      );
    }
    // 能力快照迁移 + 差异计算
    const sourceSnapshot = relation.capability_snapshot_per_layer[transition.from_layer_id];
    const toSnapshot = this.buildTargetSnapshot(transition, sourceSnapshot);
    const delta = computeCapabilityDelta(sourceSnapshot ?? {}, toSnapshot);
    const executed: LayerTransition = { ...transition, capability_delta: delta };
    this.transitions.set(transitionId, executed);
    this.relationships.set(transition.forgekin_id, {
      ...relation,
      current_layer_id: transition.to_layer_id,
      evolution_history: [...relation.evolution_history, executed],
      capability_snapshot_per_layer: {
        ...relation.capability_snapshot_per_layer,
        [transition.to_layer_id]: toSnapshot,
      },
    });
    return executed;
  }

  /** 列出某 Forgekin 的全部跨层迁移历史（血缘追踪，F036 AC-5） */
  listTransitions(forgekinId: string): LayerTransition[] {
    return this.getRelationship(forgekinId).evolution_history.slice();
  }

  // ── 内部辅助 ─────────────────────────────────────────────────────

  private assertEligible(evidence: TransitionEvidence): void {
    if (evidence.eval_score < this.rules.min_eval_score) {
      throw new Error(
        `进化条件不满足：Eval ${evidence.eval_score} < min_eval_score ${this.rules.min_eval_score}（F036 AC-2）。`,
      );
    }
    if (evidence.task_count < this.rules.min_task_count) {
      throw new Error(
        `进化条件不满足：任务数 ${evidence.task_count} < min_task_count ${this.rules.min_task_count}（F036 AC-2）。`,
      );
    }
    if (this.rules.require_operator_approval && !evidence.operator_approved) {
      throw new Error(
        `跨层迁移必须 operator 批准——防止Forgekin擅自迁移导致能力丢失（F036 AC-4）。`,
      );
    }
  }

  private createTransition(
    forgekinId: string,
    fromLayerId: string,
    toLayerId: string,
    transitionType: TransitionType,
    reason: string,
    evidence: TransitionEvidence,
  ): string {
    this.transitionSeq += 1;
    const transitionId = `transition_${Date.now().toString(36)}_${this.transitionSeq}`;
    const transition: LayerTransition = {
      transition_id: transitionId,
      forgekin_id: forgekinId,
      from_layer_id: fromLayerId,
      to_layer_id: toLayerId,
      transition_type: transitionType,
      trigger_reason: reason,
      operator_approved: evidence.operator_approved,
      timestamp: new Date().toISOString(),
      capability_delta: {},
    };
    this.transitions.set(transitionId, transition);
    return transitionId;
  }

  /** 构造目标层能力快照（进化：复制 + 垂直技能；回炉：仅蒸馏通用能力） */
  private buildTargetSnapshot(
    transition: LayerTransition,
    sourceSnapshot: CapabilitySnapshot | undefined,
  ): CapabilitySnapshot {
    const base = { ...(sourceSnapshot ?? {}) };
    if (transition.transition_type === 'evolve') {
      const target = this.getLayer(transition.to_layer_id);
      const skills = target.vertical_skills;
      const baseSkills = Array.isArray(base['vertical_skills'])
        ? [...(base['vertical_skills'] as unknown[])]
        : [];
      return {
        ...base,
        ...(skills.length > 0 ? { vertical_skills: [...baseSkills, ...skills] } : {}),
      };
    }
    // 回炉：仅蒸馏通用能力（移除垂直特定字段），垂直能力保留原层
    if (this.rules.distill_general_only) {
      const distilled: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(base)) {
        if (key === 'vertical_skills' || key.startsWith('vertical_')) {
          continue;
        }
        distilled[key] = value;
      }
      distilled['distilled_general_only'] = true;
      return distilled;
    }
    return base;
  }
}
