/**
 * @flowforge/graph-ui — MemoryGraphDataPort（内存数据 seam 实现, EP-CB6 T6.2）。
 *
 * 实现 GraphDataPort，消费注入的 GraphDataInjector（真实 codebase 适配器或内存桩），
 * 内部做纯变换：
 * - structure → 树：按 CONTAINS_FOLDER/CONTAINS_FILE/IMPORTS 结构边派生层级深度并产生 edges。
 * - symbol   → 图：nodes+edges 归一化，labelFilter 过滤、limit 截断。
 * - loadAnchors 透传 resolveAnchor。
 * - meta.totalNodes/totalEdges 由注入数据计算。
 *
 * 中文对照：内存数据端口 / 注入式只读消费
 * @module @flowforge/graph-ui/data/memory
 */

import type { EdgeKind, GraphAnchor, GraphData, GraphNodeLabel } from '../contacts/graph-data.ts'
import type { GraphDataInjector, GraphDataPort, LoadStructureOptions, LoadSymbolOptions } from './ports.ts'

/** 结构容器边：决定树层级父子关系的边类型集合。 */
const CONTAINMENT_EDGE_TYPES = new Set(['CONTAINS_FOLDER', 'CONTAINS_FILE'])

/** graph-ui 自身对一条边的结构/符号归类（与 classifyEdgeKind 对齐的本地映射）。 */
function kindOf(type: string): EdgeKind | undefined {
  if (type === 'CONTAINS_FOLDER' || type === 'CONTAINS_FILE' || type === 'IMPORTS') return 'structure'
  if (type === 'CALLS' || type === 'CALL_REFERENCE' || type === 'USAGE' || type === 'INHERITS' || type === 'IMPLEMENTS' || type === 'DEFINES' || type === 'DEFINES_METHOD') {
    return 'symbol'
  }
  return undefined
}

/** GraphDataPort 的内存实现：API 全 async，纯内存数据变换。 */
export class MemoryGraphDataPort implements GraphDataPort {
  constructor(private readonly injector: GraphDataInjector) {}

  async loadStructureTree(projectId: string, opts?: LoadStructureOptions): Promise<GraphData> {
    const nodes = this.injector.loadStructureNodes(projectId)
    const edges = this.injector.loadEdges(projectId)
    const nodeIds = new Set(nodes.map((n) => n.id))

    // 只保留结构边，且两端都在注入的结构节点内。
    const structural = edges.filter(
      (e) => kindOf(e.type) === 'structure' && nodeIds.has(e.source) && nodeIds.has(e.target),
    )

    // 按容器边（CONTAINS_FOLDER/CONTAINS_FILE）计算层级深度：depth[child]=max(parent)+1。
    const depth = new Map(nodes.map((n) => [n.id, 0]))
    for (let pass = 0; pass < nodes.length; pass += 1) {
      let changed = false
      for (const e of structural) {
        if (!CONTAINMENT_EDGE_TYPES.has(e.type)) continue
        const parentDepth = depth.get(e.source) ?? 0
        const childDepth = depth.get(e.target) ?? 0
        if (childDepth <= parentDepth) {
          depth.set(e.target, parentDepth + 1)
          changed = true
        }
      }
      if (!changed) break
    }

    const maxDepth = opts?.maxDepth
    const kept = nodes.filter((n) => maxDepth === undefined || (depth.get(n.id) ?? 0) <= maxDepth)
    const keptIds = new Set(kept.map((n) => n.id))

    // 保留两端都在存活节点内的结构边。
    const keptEdges = structural.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))

    return {
      nodes: kept,
      edges: keptEdges,
      meta: { totalNodes: kept.length, totalEdges: keptEdges.length, projectId },
    }
  }

  async loadSymbolGraph(projectId: string, opts?: LoadSymbolOptions): Promise<GraphData> {
    let nodes = this.injector.loadSymbolNodes(projectId)
    const filter = opts?.labelFilter
    if (filter && filter.length > 0) {
      const wanted = new Set<GraphNodeLabel>(filter)
      nodes = nodes.filter((n) => wanted.has(n.label))
    }
    if (opts?.limit !== undefined && opts.limit >= 0) {
      nodes = nodes.slice(0, opts.limit)
    }

    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = this.injector.loadEdges(projectId).filter(
      (e) => kindOf(e.type) === 'symbol' && nodeIds.has(e.source) && nodeIds.has(e.target),
    )

    return {
      nodes,
      edges,
      meta: { totalNodes: nodes.length, totalEdges: edges.length, projectId },
    }
  }

  async loadAnchors(nodeId: string): Promise<GraphAnchor | null> {
    return this.injector.resolveAnchor(nodeId)
  }
}