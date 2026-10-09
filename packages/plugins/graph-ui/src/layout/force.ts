/**
 * @flowforge/graph-ui — 符号层力导向布局纯函数（layoutSymbolForce, EP-CB6 T6.3）。
 *
 * 确定性力导向布局：用 mulberry32 伪随机（LCG 变体，seed 固定则结果可复现），
 * 迭代静电斥力 + 符号边弹性引力，末次把坐标钳制/收敛在 box 内。契约定点纯函数，
 * 同 seed 两次调用结果完全一致，可单测断言。
 *
 * 中文对照：符号层力导向布局 / 种子可复现
 * @module @flowforge/graph-ui/layout/force
 */

import type { GraphData } from '../contacts/graph-data.ts'
import type { LayoutResult, NodePosition } from './types.ts'

/** layoutSymbolForce 选项。 */
export interface LayoutForceOptions {
  /** 迭代步数。 */
  readonly iterations?: number
  /** 确定性伪随机种子。 */
  readonly seed?: number
  readonly width?: number
  readonly height?: number
  readonly depth?: number
  /** 布局中心 [cx, cy, cz]。 */
  readonly center?: number[]
  readonly repulsion?: number
  readonly attraction?: number
}

/** mulberry32 确定性伪随机生成器（返回 [0,1)）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 把数值钳制到 [min, max]。 */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** 符号层力导向布局。 */
export function layoutSymbolForce(data: GraphData, opts?: LayoutForceOptions): LayoutResult {
  const iterations = opts?.iterations ?? 100
  const seed = opts?.seed ?? 1
  const width = opts?.width ?? 800
  const height = opts?.height ?? 600
  const depth = opts?.depth ?? 400
  const repulsion = opts?.repulsion ?? 4000
  const attraction = opts?.attraction ?? 0.01
  const center = opts?.center ?? [width / 2, height / 2, depth / 2] as const

  const random = mulberry32(seed)
  const count = data.nodes.length
  const positions: NodePosition[] = new Array(count)

  // 初始位置：围绕中心在 box 内的确定性随机散布。
  for (let i = 0; i < count; i += 1) {
    positions[i] = {
      nodeId: data.nodes[i]!.id,
      x: center[0]! + (random() - 0.5) * width,
      y: center[1]! + (random() - 0.5) * height,
      z: center[2]! + (random() - 0.5) * depth,
    }
  }

  // nodeId → 数组下标，供边查询。
  const indexById = new Map<string, number>()
  for (let i = 0; i < count; i += 1) indexById.set(data.nodes[i]!.id, i)

  const fx = new Float64Array(count)
  const fy = new Float64Array(count)
  const fz = new Float64Array(count)
  const EPSILON = 1e-4

  for (let it = 0; it < iterations; it += 1) {
    fx.fill(0); fy.fill(0); fz.fill(0)

    // 两两静电斥力。
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const dx = positions[i]!.x - positions[j]!.x
        const dy = positions[i]!.y - positions[j]!.y
        const dz = positions[i]!.z - positions[j]!.z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + EPSILON
        const force = repulsion / (d * d)
        const ux = dx / d
        const uy = dy / d
        const uz = dz / d
        fx[i]! += force * ux
        fy[i]! += force * uy
        fz[i]! += force * uz
        fx[j]! -= force * ux
        fy[j]! -= force * uy
        fz[j]! -= force * uz
      }
    }

    // 符号边弹性引力。
    for (const edge of data.edges) {
      const i = indexById.get(edge.source)
      const j = indexById.get(edge.target)
      if (i === undefined || j === undefined) continue
      const dx = positions[j]!.x - positions[i]!.x
      const dy = positions[j]!.y - positions[i]!.y
      const dz = positions[j]!.z - positions[i]!.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + EPSILON
      const force = attraction * d
      const ux = dx / d
      const uy = dy / d
      const uz = dz / d
      fx[i]! += force * ux
      fy[i]! += force * uy
      fz[i]! += force * uz
      fx[j]! -= force * ux
      fy[j]! -= force * uy
      fz[j]! -= force * uz
    }

    // 应用位移并钳制在 box 内（确定性）。
    for (let i = 0; i < count; i += 1) {
      const p = positions[i]!
      positions[i] = {
        nodeId: data.nodes[i]!.id,
        x: clamp(p.x + fx[i]!, 0, width),
        y: clamp(p.y + fy[i]!, 0, height),
        z: clamp(p.z + fz[i]!, 0, depth),
      }
    }
  }

  let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, depth: 0 }
  if (count > 0) {
    const xs = positions.map((p) => p.x)
    const ys = positions.map((p) => p.y)
    const zs = positions.map((p) => p.z)
    bounds = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      depth: Math.max(...zs) - Math.min(...zs),
    }
  }

  return { positions, bounds }
}