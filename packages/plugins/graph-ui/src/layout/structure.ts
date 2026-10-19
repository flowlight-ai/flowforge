/**
 * @flowforge/graph-ui — 结构层树层次布局纯函数（layoutStructureTree, EP-CB6 T6.3）。
 *
 * 契约定点、无随机：y = depth * verticalGap，x 同级横向排布。深度由结构边
 * CONTAINS_FOLDER/CONTAINS_FILE 的 source→target 父子链决定；无结构边则 depth=0。
 * IMPORTS 边不参与层级（不具容器父子关系）。
 *
 * 中文对照：结构树层次布局 / 层次坐标
 * @module @flowforge/graph-ui/layout/structure
 */

import type { GraphData } from '../contacts/graph-data.ts'
import type { LayoutResult, NodePosition } from './types.ts'

/** 容器父子关系由 CONTAINS_FOLDER/CONTAINS_FILE 边表达。 */
const CONTAINMENT_EDGE_TYPES = new Set(['CONTAINS_FOLDER', 'CONTAINS_FILE'])

/** layoutStructureTree 选项。 */
export interface LayoutStructureOptions {
  /** 同级节点水平间距。 */
  readonly horizontalGap?: number
  /** 层级间距（y 方向）。 */
  readonly verticalGap?: number
  /** 参与布局的最大深度（depth > maxDepth 的节点被剔除）。 */
  readonly maxDepth?: number
}

/**
 * 计算每个节点的树深度：沿容器边 source→target 的链取最长。
 * IMPORTS 边不计算深度。
 */
function computeDepths(data: GraphData): Map<string, number> {
  const depth = new Map<string, number>(data.nodes.map((n) => [n.id, 0]))
  const containments = data.edges.filter((e) => CONTAINMENT_EDGE_TYPES.has(e.type))
  for (let pass = 0; pass < data.nodes.length; pass += 1) {
    let changed = false
    for (const e of containments) {
      const parentDepth = depth.get(e.source) ?? 0
      const childDepth = depth.get(e.target) ?? 0
      if (childDepth <= parentDepth) {
        depth.set(e.target, parentDepth + 1)
        changed = true
      }
    }
    if (!changed) break
  }
  return depth
}

/** 结构层树层次布局。 */
export function layoutStructureTree(data: GraphData, opts?: LayoutStructureOptions): LayoutResult {
  const horizontalGap = opts?.horizontalGap ?? 160
  const verticalGap = opts?.verticalGap ?? 200
  const maxDepth = opts?.maxDepth

  const depth = computeDepths(data)
  const positions: NodePosition[] = []

  // 按输入顺序维护每层深度的下一个水平序号（同级 x 递增）。
  const nextIndexByDepth = new Map<number, number>()
  let maxReached = 0

  for (const node of data.nodes) {
    const d = depth.get(node.id) ?? 0
    if (maxDepth !== undefined && d > maxDepth) continue
    maxReached = Math.max(maxReached, d)
    const index = nextIndexByDepth.get(d) ?? 0
    nextIndexByDepth.set(d, index + 1)
    positions.push({ nodeId: node.id, x: index * horizontalGap, y: d * verticalGap, z: 0 })
  }

  // 包围盒：若为空返回零盒。
  let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, depth: maxReached }
  if (positions.length > 0) {
    const xs = positions.map((p) => p.x)
    const ys = positions.map((p) => p.y)
    bounds = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      depth: maxReached,
    }
  }

  return { positions, bounds }
}