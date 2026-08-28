/**
 * @flowforge/forgekin-lineage — F038 LineageStore 谱系存储
 *
 * TS 移植自 `docs/features/F038-forgemind-lineage.md` §3.2。
 * 内存实现（Map 注入式存储，跨插件共享时预注入同一实例）：
 *   - addNode / addEdge：写入（addEdge 自动维护两端节点的父子索引）
 *   - getNode：按 soul_imprint 查询（唯一锚点）
 *   - getAncestry / getDescendants：谱系树双向遍历（审计与能力溯源）
 *
 * @module @flowforge/forgekin-lineage/store
 */

import type { LineageEdge, LineageNode } from './models.js';
import { validateLineageEdge, validateLineageNode } from './models.js';

/**
 * 谱系存储（接口 = 契约；内存实现为默认后端，
 * 持久化 backend（F008 durable_state_surfaces）可由上层注入替换）。
 */
export interface LineageStore {
  addNode(node: LineageNode): void;
  addEdge(edge: LineageEdge): void;
  getNode(soulImprint: string): LineageNode;
  /** 按 forgekin_id 反查节点（分裂/融合执行器定位父节点用） */
  findNodeByForgekinId(forgekinId: string): LineageNode | undefined;
  getAncestry(soulImprint: string, depth: number): LineageNode[];
  getDescendants(soulImprint: string, depth: number): LineageNode[];
  /** 全部边（审计：log_all_edges） */
  listEdges(): LineageEdge[];
  count(): number;
}

/** 内存谱系存储（默认实现；soul_imprint 唯一索引） */
export class InMemoryLineageStore implements LineageStore {
  private readonly nodesByImprint = new Map<string, LineageNode>();
  private readonly idsByForgekin = new Map<string, string>();
  private readonly edges: LineageEdge[] = [];

  addNode(node: LineageNode): void {
    validateLineageNode(node);
    if (this.nodesByImprint.has(node.soul_imprint)) {
      throw new Error(`谱系节点已存在 soul_imprint=${node.soul_imprint}——SoulImprint 必须唯一（F038 AC-1）。`);
    }
    if (this.idsByForgekin.has(node.forgekin_id)) {
      throw new Error(`谱系节点已存在 forgekin_id=${node.forgekin_id}——同一 Forgekin 不可重复入谱。`);
    }
    this.nodesByImprint.set(node.soul_imprint, node);
    this.idsByForgekin.set(node.forgekin_id, node.soul_imprint);
  }

  addEdge(edge: LineageEdge): void {
    validateLineageEdge(edge);
    if (this.edges.some((e) => e.edge_id === edge.edge_id)) {
      throw new Error(`谱系边已存在 edge_id=${edge.edge_id}——不可重复写入。`);
    }
    // 自动维护两端节点的父子索引（血缘一致性）
    for (const from of edge.from_soul_imprints) {
      const fromNode = this.nodesByImprint.get(from);
      if (fromNode !== undefined) {
        const merged = [...new Set([...fromNode.child_soul_imprints, ...edge.to_soul_imprints])];
        if (merged.length !== fromNode.child_soul_imprints.length) {
          this.nodesByImprint.set(from, { ...fromNode, child_soul_imprints: merged });
        }
      }
    }
    for (const to of edge.to_soul_imprints) {
      const toNode = this.nodesByImprint.get(to);
      if (toNode !== undefined) {
        const parents = [...edge.from_soul_imprints];
        const merged = [...new Set([...toNode.parent_soul_imprints, ...parents])];
        this.nodesByImprint.set(to, { ...toNode, parent_soul_imprints: merged });
      }
    }
    this.edges.push(edge);
  }

  getNode(soulImprint: string): LineageNode {
    const node = this.nodesByImprint.get(soulImprint);
    if (node === undefined) {
      throw new Error(`谱系节点不存在 soul_imprint=${soulImprint}。`);
    }
    return node;
  }

  findNodeByForgekinId(forgekinId: string): LineageNode | undefined {
    const imprint = this.idsByForgekin.get(forgekinId);
    if (imprint === undefined) {
      return undefined;
    }
    return this.nodesByImprint.get(imprint);
  }

  /** 向上查祖先（depth ≤ 0 表示不限制深度；结果按血缘层级从近到远） */
  getAncestry(soulImprint: string, depth: number): LineageNode[] {
    const seen = new Set<string>([soulImprint]);
    const result: LineageNode[] = [];
    const queue: Array<{ imprint: string; level: number }> = [{ imprint: soulImprint, level: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.level > 0) {
        const node = this.nodesByImprint.get(current.imprint);
        if (node !== undefined) {
          result.push(node);
        }
      }
      if (depth > 0 && current.level >= depth) {
        continue;
      }
      const node = this.nodesByImprint.get(current.imprint);
      if (node === undefined) {
        continue;
      }
      for (const parent of node.parent_soul_imprints) {
        if (!seen.has(parent)) {
          seen.add(parent);
          queue.push({ imprint: parent, level: current.level + 1 });
        }
      }
    }
    return result;
  }

  /** 向下查后代（depth ≤ 0 表示不限制深度；结果按血缘层级从近到远） */
  getDescendants(soulImprint: string, depth: number): LineageNode[] {
    const seen = new Set<string>([soulImprint]);
    const result: LineageNode[] = [];
    const queue: Array<{ imprint: string; level: number }> = [{ imprint: soulImprint, level: 0 }];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.level > 0) {
        const node = this.nodesByImprint.get(current.imprint);
        if (node !== undefined) {
          result.push(node);
        }
      }
      if (depth > 0 && current.level >= depth) {
        continue;
      }
      const node = this.nodesByImprint.get(current.imprint);
      if (node === undefined) {
        continue;
      }
      for (const child of node.child_soul_imprints) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push({ imprint: child, level: current.level + 1 });
        }
      }
    }
    return result;
  }

  listEdges(): LineageEdge[] {
    return this.edges.slice();
  }

  count(): number {
    return this.nodesByImprint.size;
  }
}
