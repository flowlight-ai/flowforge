/**
 * @flowforge/forgekin-lineage — F038 数据模型
 *
 * TS 移植自 `docs/features/F038-forgemind-lineage.md` §3.1。
 * 编码"Forge Nurturing 的传承与演化"的工程规则：
 *   - LineageRelation：谱系关系类型（forged/split/fused/cloned/traded/layer）
 *   - LineageNode：谱系节点（一个 Forgekin，以 soul_imprint 为唯一标识）
 *   - LineageEdge：谱系边（一次分裂/融合/克隆/交易/迁移）
 *
 * @module @flowforge/forgekin-lineage/models
 */

/** 谱系关系类型 */
export type LineageRelation =
  | 'forged' // 原始锻造（无父）
  | 'split' // 分裂（一父多子）
  | 'fused' // 融合（多父一子）
  | 'cloned' // 克隆（订阅，F037）
  | 'traded' // 交易转移（F037）
  | 'layer'; // 跨层迁移（F036）

/** 谱系节点（一个 Forgekin） */
export interface LineageNode {
  readonly forgekin_id: string;
  /** SoulImprint（身份锚点，谱系追踪的唯一标识） */
  readonly soul_imprint: string;
  /** 形态（F027，如 bio/org/obj/virtual/hybrid） */
  readonly species: string;
  /** 承载层 ID（F036 ForgeLayer.layer_id，如 "forgemind"） */
  readonly layer_id: string;
  /** 创建时间（UTC ISO 8601） */
  readonly created_at: string;
  /** 与父节点关系类型 */
  readonly relation_to_parents: LineageRelation;
  /** 父 SoulImprint 列表（分裂=1 父，融合=多父，锻造=空） */
  readonly parent_soul_imprints: readonly string[];
  /** 子 SoulImprint 列表 */
  readonly child_soul_imprints: readonly string[];
  /** 能力画像快照（分裂从父复制 / 融合按多父加权合并的源数据） */
  readonly capability_profile: Readonly<Record<string, unknown>>;
  /** 价值锚点（后代继承；对齐 VISION §7 七条愿景锚点） */
  readonly value_anchors: readonly string[];
}

/** 谱系边（一次分裂/融合/克隆/交易/迁移） */
export interface LineageEdge {
  readonly edge_id: string;
  readonly relation: LineageRelation;
  /** 源 SoulImprint（分裂=1，融合=多） */
  readonly from_soul_imprints: readonly string[];
  /** 目标 SoulImprint */
  readonly to_soul_imprints: readonly string[];
  /** 时间（UTC ISO 8601） */
  readonly timestamp: string;
  /** 分裂/融合必须 operator 批准（防止谱系污染） */
  readonly operator_approved: boolean;
  /** 能力画像快照 */
  readonly capability_snapshot: Readonly<Record<string, unknown>>;
  /** 触发原因 */
  readonly trigger_reason: string;
}

/** 分裂清单（一个子 Forgekin 的定义） */
export interface SplitChildManifest {
  /** 子 Forgekin 名（生成 forgekin_id 用） */
  readonly name: string;
  /** 形态（F027） */
  readonly species: string;
  /** 命名空间（生成 SoulImprint 用，缺省 "forgemind"） */
  readonly namespace?: string | undefined;
  /** 能力调整（覆盖/新增到从父复制的能力画像） */
  readonly capability_adjust?: Readonly<Record<string, unknown>> | undefined;
  /** 价值锚点（缺省继承父的 value_anchors） */
  readonly value_anchors?: readonly string[] | undefined;
}

/** 分裂清单（split 入口） */
export interface SplitManifest {
  /** 每个子 Forgekin 的定义（≤ max_children_per_split） */
  readonly children: readonly SplitChildManifest[];
  /** operator 批准（分裂必须批准，防止擅自繁殖） */
  readonly operator_approved: boolean;
  /** 触发原因 */
  readonly reason: string;
}

/** 融合清单（fuse 入口） */
export interface FuseManifest {
  /** 融合出的子 Forgekin 名 */
  readonly name: string;
  /** 形态（F027） */
  readonly species: string;
  /** 命名空间（缺省 "forgemind"） */
  readonly namespace?: string | undefined;
  /** 价值锚点（缺省合并父的 value_anchors） */
  readonly value_anchors?: readonly string[] | undefined;
  /** 父性能权重（缺省等权；按历史表现加权合并能力画像） */
  readonly weights?: Readonly<Record<string, number>> | undefined;
  /** operator 批准（融合必须批准） */
  readonly operator_approved: boolean;
  /** 触发原因 */
  readonly reason: string;
}

/** 校验谱系关系类型合法性 */
export function validateLineageRelation(relation: string): LineageRelation {
  const allowed: LineageRelation[] = ['forged', 'split', 'fused', 'cloned', 'traded', 'layer'];
  if (!(allowed as string[]).includes(relation)) {
    throw new Error(`非法谱系关系类型: ${relation}（允许: ${allowed.join('/')}）。`);
  }
  return relation as LineageRelation;
}

/** 校验谱系节点（soul_imprint 锚点 + 关系一致性） */
export function validateLineageNode(node: LineageNode): void {
  if (!node.soul_imprint || !node.soul_imprint.trim()) {
    throw new Error('soul_imprint 不能为空——SoulImprint 是谱系追踪的唯一锚点（F038 AC-1）。');
  }
  validateLineageRelation(node.relation_to_parents);
  if (node.relation_to_parents === 'forged' && node.parent_soul_imprints.length !== 0) {
    throw new Error('forged 节点不应有父 SoulImprint（原始锻造无父）。');
  }
  if (node.relation_to_parents === 'split' && node.parent_soul_imprints.length !== 1) {
    throw new Error('split 节点必须有且仅有 1 个父 SoulImprint（分裂一父多子）。');
  }
  if (node.relation_to_parents === 'fused' && node.parent_soul_imprints.length < 2) {
    throw new Error('fused 节点必须至少有 2 个父 SoulImprint（融合多父一子）。');
  }
}

/** 校验谱系边（源/目标非空 + 分裂单源多目标 + 融合多源单目标） */
export function validateLineageEdge(edge: LineageEdge): void {
  validateLineageRelation(edge.relation);
  if (edge.from_soul_imprints.length === 0 || edge.to_soul_imprints.length === 0) {
    throw new Error('谱系边 from/to 不能为空。');
  }
  if (edge.relation === 'split' && edge.from_soul_imprints.length !== 1) {
    throw new Error('split 边必须恰好 1 个源 SoulImprint（一父多子）。');
  }
  if (edge.relation === 'fused' && edge.to_soul_imprints.length !== 1) {
    throw new Error('fused 边必须恰好 1 个目标 SoulImprint（多父一子）。');
  }
}
