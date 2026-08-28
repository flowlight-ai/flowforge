/**
 * @flowforge/forgekin-lineage — F038 分裂/融合执行器
 *
 * TS 移植自 `docs/features/F038-forgemind-lineage.md` §3.2/§3.3。
 * 关键算法：
 *   - 分裂保留父血缘：子 Forgekin 生成新 SoulImprint，parent_soul_imprints
 *     记录父 SoulImprint，能力画像从父复制后按 split_manifest 调整。
 *   - 融合保留多父血缘：子 Forgekin 生成新 SoulImprint，
 *     parent_soul_imprints 记录所有父 SoulImprint，能力画像按
 *     fuse_manifest.weights 加权合并（缺省等权，weighted_by_performance）。
 *   - operator 审批：分裂/融合必须 operator 批准（防止谱系污染）。
 *
 * @module @flowforge/forgekin-lineage/executors
 */

import { forgeSoulImprint } from '@flowforge/forgekin-soul';
import type { FuseManifest, LineageEdge, LineageNode, SplitManifest } from './models.js';
import type { LineageStore } from './store.js';

/** 分裂/融合配置（来自 YAML split/fuse 段，配置驱动） */
export interface LineageExecutorsConfig {
  /** 分裂必须 operator 批准 */
  readonly splitRequireApproval: boolean;
  /** 单次分裂最大子数 */
  readonly maxChildrenPerSplit: number;
  /** 分裂从父复制能力画像 */
  readonly copyCapabilityFromParent: boolean;
  /** 融合必须 operator 批准 */
  readonly fuseRequireApproval: boolean;
  /** 单次融合最大父数 */
  readonly maxParentsPerFuse: number;
  /** 融合合并策略（当前仅 weighted_by_performance） */
  readonly mergeStrategy: string;
}

/** 从 YAML 配置字典解析分裂/融合规则（宽松解析，缺省回落内置默认） */
export function parseLineageExecutorsConfig(raw: unknown): LineageExecutorsConfig {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const split = (typeof src['split'] === 'object' && src['split'] !== null ? src['split'] : {}) as Record<string, unknown>;
  const fuse = (typeof src['fuse'] === 'object' && src['fuse'] !== null ? src['fuse'] : {}) as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  return {
    splitRequireApproval: bool(split['require_operator_approval'], true),
    maxChildrenPerSplit: num(split['max_children_per_split'], 5),
    copyCapabilityFromParent: bool(split['copy_capability_from_parent'], true),
    fuseRequireApproval: bool(fuse['require_operator_approval'], true),
    maxParentsPerFuse: num(fuse['max_parents_per_fuse'], 3),
    mergeStrategy: str(fuse['merge_strategy'], 'weighted_by_performance'),
  };
}

/**
 * 分裂执行器 — 一个父 Forgekin 分裂出多个子 Forgekin。
 * 子 Forgekin 保留父血缘（parent_soul_imprints=[父]），生成新 SoulImprint。
 */
export class LineageSplitExecutor {
  private seq = 0;

  constructor(
    private readonly store: LineageStore,
    private readonly config: LineageExecutorsConfig,
  ) {}

  /**
   * 分裂出多个子 Forgekin（保留父血缘，生成新 SoulImprint）。
   *
   * @param parentForgekinId - 父 Forgekin ID（按 forgekin_id 反查节点）
   * @param manifest - 分裂清单（子定义 + operator 批准）
   * @returns 子 Forgekin ID 列表
   */
  async split(parentForgekinId: string, manifest: SplitManifest): Promise<string[]> {
    const parent = this.requireParent(parentForgekinId);
    if (this.config.splitRequireApproval && !manifest.operator_approved) {
      throw new Error('分裂必须 operator 批准——防止Forgekin擅自繁殖导致谱系污染（F038 AC-5）。');
    }
    if (manifest.children.length === 0) {
      throw new Error('分裂清单不能为空——至少分裂出 1 个子 Forgekin。');
    }
    if (manifest.children.length > this.config.maxChildrenPerSplit) {
      throw new Error(
        `单次分裂最多 ${this.config.maxChildrenPerSplit} 个子 Forgekin，got: ${manifest.children.length}。`,
      );
    }
    const results: string[] = [];
    const toImprints: string[] = [];
    for (const child of manifest.children) {
      this.seq += 1;
      // 新 SoulImprint（seed_params 携带父血缘锚点 + 子名）
      const imprint = forgeSoulImprint(
        {
          parent_soul_imprint: parent.soul_imprint,
          name: child.name,
          species: child.species,
        },
        child.value_anchors ?? parent.value_anchors,
        child.namespace ?? 'forgemind',
      );
      // 能力画像：从父复制 + manifest 调整（覆盖/新增）
      const capability = this.config.copyCapabilityFromParent
        ? { ...parent.capability_profile, ...(child.capability_adjust ?? {}) }
        : { ...(child.capability_adjust ?? {}) };
      const childId = `${child.name}_${this.seq}`;
      const node: LineageNode = {
        forgekin_id: childId,
        soul_imprint: imprint.imprintHash,
        species: child.species,
        layer_id: parent.layer_id,
        created_at: new Date().toISOString(),
        relation_to_parents: 'split',
        parent_soul_imprints: [parent.soul_imprint],
        child_soul_imprints: [],
        capability_profile: capability,
        value_anchors: [...(child.value_anchors ?? parent.value_anchors)],
      };
      this.store.addNode(node);
      toImprints.push(imprint.imprintHash);
      results.push(childId);
    }
    // 谱系边（一父多子）
    const edge: LineageEdge = {
      edge_id: `edge_split_${Date.now().toString(36)}_${this.seq}`,
      relation: 'split',
      from_soul_imprints: [parent.soul_imprint],
      to_soul_imprints: toImprints,
      timestamp: new Date().toISOString(),
      operator_approved: manifest.operator_approved,
      capability_snapshot: { ...parent.capability_profile },
      trigger_reason: manifest.reason,
    };
    this.store.addEdge(edge);
    return results;
  }

  private requireParent(parentForgekinId: string): LineageNode {
    const parent = this.store.findNodeByForgekinId(parentForgekinId);
    if (parent === undefined) {
      throw new Error(`谱系中不存在 forgekin_id=${parentForgekinId}——无法分裂（请先 addNode 入谱）。`);
    }
    return parent;
  }
}

/**
 * 融合执行器 — 多个父 Forgekin 融合为一个子 Forgekin。
 * 子 Forgekin 保留多父血缘（parent_soul_imprints=所有父），生成新 SoulImprint。
 * 能力画像按 weights 加权合并（缺省等权；数值取加权平均、数组取并集、其余取首个非空）。
 */
export class LineageFuseExecutor {
  private seq = 0;

  constructor(
    private readonly store: LineageStore,
    private readonly config: LineageExecutorsConfig,
  ) {}

  /**
   * 融合多个父 Forgekin 为一个子 Forgekin（保留多父血缘）。
   *
   * @param parentForgekinIds - 父 Forgekin ID 列表
   * @param manifest - 融合清单（子定义 + 权重 + operator 批准）
   * @returns 子 Forgekin ID
   */
  async fuse(parentForgekinIds: string[], manifest: FuseManifest): Promise<string> {
    if (this.config.fuseRequireApproval && !manifest.operator_approved) {
      throw new Error('融合必须 operator 批准——防止Forgekin擅自繁殖导致谱系污染（F038 AC-5）。');
    }
    if (parentForgekinIds.length < 2) {
      throw new Error(`融合至少需要 2 个父 Forgekin，got: ${parentForgekinIds.length}。`);
    }
    if (parentForgekinIds.length > this.config.maxParentsPerFuse) {
      throw new Error(
        `单次融合最多 ${this.config.maxParentsPerFuse} 个父 Forgekin，got: ${parentForgekinIds.length}。`,
      );
    }
    const parents = parentForgekinIds.map((id) => this.requireParent(id));
    this.seq += 1;
    const parentImprints = parents.map((p) => p.soul_imprint);
    // 新 SoulImprint（seed_params 携带多父血缘锚点 + 子名）
    const imprint = forgeSoulImprint(
      {
        parent_soul_imprints: parentImprints,
        name: manifest.name,
        species: manifest.species,
      },
      manifest.value_anchors ?? this.mergeValueAnchors(parents),
      manifest.namespace ?? 'forgemind',
    );
    // 能力画像：按权重加权合并（weighted_by_performance）
    const capability = this.mergeCapabilities(parents, manifest.weights);
    const childId = `${manifest.name}_${this.seq}`;
    const node: LineageNode = {
      forgekin_id: childId,
      soul_imprint: imprint.imprintHash,
      species: manifest.species,
      layer_id: parents[0]!.layer_id,
      created_at: new Date().toISOString(),
      relation_to_parents: 'fused',
      parent_soul_imprints: parentImprints,
      child_soul_imprints: [],
      capability_profile: capability,
      value_anchors: [...(manifest.value_anchors ?? this.mergeValueAnchors(parents))],
    };
    this.store.addNode(node);
    // 谱系边（多父一子）
    const edge: LineageEdge = {
      edge_id: `edge_fuse_${Date.now().toString(36)}_${this.seq}`,
      relation: 'fused',
      from_soul_imprints: parentImprints,
      to_soul_imprints: [imprint.imprintHash],
      timestamp: new Date().toISOString(),
      operator_approved: manifest.operator_approved,
      capability_snapshot: capability,
      trigger_reason: manifest.reason,
    };
    this.store.addEdge(edge);
    return childId;
  }

  private requireParent(parentForgekinId: string): LineageNode {
    const parent = this.store.findNodeByForgekinId(parentForgekinId);
    if (parent === undefined) {
      throw new Error(`谱系中不存在 forgekin_id=${parentForgekinId}——无法融合（请先 addNode 入谱）。`);
    }
    return parent;
  }

  /** 合并多父价值锚点（保序去重） */
  private mergeValueAnchors(parents: LineageNode[]): string[] {
    const merged: string[] = [];
    for (const parent of parents) {
      for (const anchor of parent.value_anchors) {
        if (!merged.includes(anchor)) {
          merged.push(anchor);
        }
      }
    }
    return merged;
  }

  /**
   * 按权重加权合并能力画像（weighted_by_performance）：
   *   - 数值：加权平均
   *   - 数组：并集
   *   - 其余：取首个父的非空值
   * weights 以 forgekin_id 为 key；缺省等权。
   */
  private mergeCapabilities(
    parents: LineageNode[],
    weights: Readonly<Record<string, number>> | undefined,
  ): Record<string, unknown> {
    const totalWeight = parents.reduce(
      (sum, p) => sum + Math.max(0, weights?.[p.forgekin_id] ?? 1),
      0,
    );
    const merged: Record<string, unknown> = {};
    const keys = new Set<string>();
    for (const parent of parents) {
      for (const key of Object.keys(parent.capability_profile)) {
        keys.add(key);
      }
    }
    for (const key of keys) {
      const entries = parents
        .map((p) => ({ weight: Math.max(0, weights?.[p.forgekin_id] ?? 1), value: p.capability_profile[key] }))
        .filter((e) => e.value !== undefined);
      if (entries.length === 0) {
        continue;
      }
      const first = entries[0]!.value;
      if (typeof first === 'number') {
        // 数值：加权平均
        merged[key] =
          entries.reduce((sum, e) => sum + (e.weight * (e.value as number)) / totalWeight, 0);
      } else if (Array.isArray(first)) {
        // 数组：并集（保序去重）
        const union: unknown[] = [];
        for (const e of entries) {
          for (const item of e.value as unknown[]) {
            if (!union.includes(item)) {
              union.push(item);
            }
          }
        }
        merged[key] = union;
      } else {
        // 其余：取权重最大的父的值
        const best = entries.reduce((a, b) => (a.weight >= b.weight ? a : b));
        merged[key] = best.value;
      }
    }
    return merged;
  }
}
