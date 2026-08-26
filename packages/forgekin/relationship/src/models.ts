/**
 * @flowforge/forgekin-relationship — F036 数据模型
 *
 * TS 移植自 `docs/features/F036-forgemind-forge-relationship.md` §3.1。
 * 编码"通用 ↔ 垂直"双向流通的工程规则：
 *   - ForgeLayer：承载层数据模型（动态注册，不硬编码具体 *Forge 项目名）
 *   - LayerTransition：跨层迁移记录（进化 or 回炉，operator 审批）
 *   - ForgeRelationship：Forgekin 与承载层的关系（血缘 + 能力快照）
 *
 * @module @flowforge/forgekin-relationship/models
 */

/** 承载层角色：通用承载层（forgemind）/ 垂直承载层（*Forge） */
export type ForgeLayerRole = 'general' | 'vertical';

/** 跨层迁移类型：进化（通用→垂直）/ 回炉（垂直→通用） */
export type TransitionType = 'evolve' | 'reclaim';

/**
 * Forgekin 承载层（动态注册，不硬编码具体 *Forge 项目名）。
 *
 * `layer_id` 由 *Forge 业务项目在插件注册时声明（如 "contentforge"），
 * forgemind 通用层固定存在（role: general）。
 */
export interface ForgeLayer {
  /** 层 ID（如 "forgemind" 或插件注册的 *Forge 项目名） */
  readonly layer_id: string;
  /** 通用承载层 / 垂直承载层 */
  readonly role: ForgeLayerRole;
  /** 垂直领域技能包（仅 vertical 层有） */
  readonly vertical_skills: readonly string[];
  /** 可进化到的目标层 ID 列表 */
  readonly can_evolve_to: readonly string[];
  /** 可回炉到的目标层 ID（仅 vertical 层有） */
  readonly can_reclaim_to?: string;
}

/** 能力画像快照（key 为 layer_id） */
export type CapabilitySnapshot = Readonly<Record<string, unknown>>;

/**
 * 跨层迁移记录（进化 or 回炉）。
 * 所有 LayerTransition 写入 F038 进化谱系，保持血缘可追溯。
 */
export interface LayerTransition {
  /** 迁移记录 ID（唯一） */
  readonly transition_id: string;
  /** 迁移的 Forgekin */
  readonly forgekin_id: string;
  readonly from_layer_id: string;
  readonly to_layer_id: string;
  /** 进化 / 回炉 */
  readonly transition_type: TransitionType;
  /** 触发原因（operator 可见，写入谱系） */
  readonly trigger_reason: string;
  /** 跨层迁移必须 operator 批准（防止能力丢失） */
  readonly operator_approved: boolean;
  /** 迁移时间（UTC ISO 8601） */
  readonly timestamp: string;
  /** 能力差异（如进化时新增的垂直技能；回炉时蒸馏出的通用能力） */
  readonly capability_delta: Readonly<Record<string, unknown>>;
}

/**
 * forgemind 与 *Forge 关系（一个 Forgekin 的跨层血缘与能力轨迹）。
 */
export interface ForgeRelationship {
  readonly forgekin_id: string;
  /** 当前承载层 ID */
  readonly current_layer_id: string;
  /** 原始承载层 ID（锻造时的出生层） */
  readonly origin_layer_id: string;
  /** 跨层迁移历史（按时间先后） */
  readonly evolution_history: readonly LayerTransition[];
  /** 每层能力画像快照（key 为 layer_id） */
  readonly capability_snapshot_per_layer: Readonly<Record<string, CapabilitySnapshot>>;
}

/** 进化/回炉的评估证据（F018 Eval Contract 三信号之一 + operator 审批） */
export interface TransitionEvidence {
  /** Eval 综合得分（0-1） */
  readonly eval_score: number;
  /** 在源层完成的任务数 */
  readonly task_count: number;
  /** operator 是否已批准本次跨层迁移 */
  readonly operator_approved: boolean;
  /** 源层能力画像快照（进化时复制到目标层；回炉时用于蒸馏） */
  readonly capability_profile: CapabilitySnapshot;
}

/** 校验承载层定义（role 合法 + vertical 层必须声明 vertical_skills 或 can_reclaim_to 至少其一） */
export function validateLayer(layer: ForgeLayer): void {
  if (!layer.layer_id || !layer.layer_id.trim()) {
    throw new Error('layer_id 不能为空——承载层必须有唯一 ID。');
  }
  if (layer.role !== 'general' && layer.role !== 'vertical') {
    throw new Error(`layer_id=${layer.layer_id} role 必须是 general|vertical，got: ${String(layer.role)}`);
  }
  if (layer.role === 'vertical' && layer.vertical_skills.length === 0 && layer.can_reclaim_to === undefined) {
    throw new Error(
      `垂直承载层 ${layer.layer_id} 必须声明 vertical_skills 或 can_reclaim_to（垂直层不能是空壳）。`,
    );
  }
  if (layer.role === 'general' && layer.can_reclaim_to !== undefined) {
    throw new Error(`通用承载层 ${layer.layer_id} 不能声明 can_reclaim_to（通用层是回炉终点）。`);
  }
}

/** 计算能力差异（to 层相对 from 层新增的键，值为新增技能列表的差集） */
export function computeCapabilityDelta(
  from: CapabilitySnapshot,
  to: CapabilitySnapshot,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(to)) {
    const fromValue = from[key];
    if (fromValue === undefined) {
      delta[key] = value;
      continue;
    }
    // 双方都是字符串数组时做差集（如 vertical_skills 的新增技能）
    if (Array.isArray(fromValue) && Array.isArray(value)) {
      const added = (value as unknown[]).filter(
        (item) => !(fromValue as unknown[]).includes(item),
      );
      if (added.length > 0) {
        delta[key] = added;
      }
    } else if (fromValue !== value) {
      delta[key] = value;
    }
  }
  return delta;
}
