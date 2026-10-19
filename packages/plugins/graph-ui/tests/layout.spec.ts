/**
 * Contract suite: 布局纯函数坐标契约（EP-CB6 T6.3 / T6.5）。
 *
 * - layoutStructureTree：同级 x 递增、深度 y 正确、确定性快照、maxDepth 过滤。
 * - layoutSymbolForce：同 seed 两次完全一致（确定性）；所有坐标在 box 内；
 *   不同 seed 结果不同；节点数/坐标与输入一致。
 */

import { describe, expect, it } from 'vitest'
import type { GraphData } from '../src/contacts/graph-data.ts'
import { layoutStructureTree } from '../src/layout/structure.ts'
import { layoutSymbolForce } from '../src/layout/force.ts'

const structureData: GraphData = {
  nodes: [
    { id: 'proj', label: 'Project', name: 'proj' },
    { id: 'src', label: 'Folder', name: 'src' },
    { id: 'lib', label: 'Folder', name: 'lib' },
    { id: 'a', label: 'File', name: 'a.ts' },
  ],
  edges: [
    { source: 'proj', target: 'src', type: 'CONTAINS_FOLDER' },
    { source: 'proj', target: 'lib', type: 'CONTAINS_FOLDER' },
    { source: 'src', target: 'a', type: 'CONTAINS_FILE' },
    // IMPORTS 不参与层级：lib 深度应保持 1 而非被提升。
    { source: 'a', target: 'lib', type: 'IMPORTS' },
  ],
  meta: { totalNodes: 4, totalEdges: 4 },
}

const symbolData: GraphData = {
  nodes: [
    { id: 'fn1', label: 'Function', name: 'fn1' },
    { id: 'fn2', label: 'Function', name: 'fn2' },
    { id: 'cls', label: 'Class', name: 'Cls' },
    { id: 'var', label: 'Variable', name: 'v' },
  ],
  edges: [
    { source: 'cls', target: 'fn1', type: 'DEFINES' },
    { source: 'fn1', target: 'fn2', type: 'CALLS' },
    { source: 'fn1', target: 'var', type: 'USAGE' },
  ],
  meta: { totalNodes: 4, totalEdges: 3 },
}

describe('layoutStructureTree（结构层层次布局）', () => {
  it('深度 y 正确 + 同级 x 递增', () => {
    const r = layoutStructureTree(structureData, { horizontalGap: 100, verticalGap: 50 })
    const byId = new Map(r.positions.map((p) => [p.nodeId, p]))
    // proj 深度0
    expect(byId.get('proj')!.y).toBe(0)
    // src/lib 深度1
    expect(byId.get('src')!.y).toBe(50)
    expect(byId.get('lib')!.y).toBe(50)
    // a 深度2
    expect(byId.get('a')!.y).toBe(100)
    // 同级横向：src 在前(0)，lib 在后(100)
    expect(byId.get('src')!.x).toBe(0)
    expect(byId.get('lib')!.x).toBe(100)
    // IMPORTS 不提升 lib 深度：仍 y=50
    expect(byId.get('lib')!.y).toBe(50)
  })

  it('确定性快照：两次调用完全一致', () => {
    const a = layoutStructureTree(structureData)
    const b = layoutStructureTree(structureData)
    expect(b.positions).toEqual(a.positions)
    expect(b.bounds).toEqual(a.bounds)
  })

  it('maxDepth 过滤深层节点', () => {
    const r = layoutStructureTree(structureData, { maxDepth: 1 })
    expect(r.positions.map((p) => p.nodeId).sort()).toEqual(['lib', 'proj', 'src'])
  })
})

describe('layoutSymbolForce（符号层力导向布局）', () => {
  it('同 seed 两次调用结果完全一致（确定性）', () => {
    const a = layoutSymbolForce(symbolData, { seed: 42, iterations: 60 })
    const b = layoutSymbolForce(symbolData, { seed: 42, iterations: 60 })
    expect(a.positions).toEqual(b.positions)
    expect(a.bounds).toEqual(b.bounds)
  })

  it('所有坐标钳制在 box 内', () => {
    const r = layoutSymbolForce(symbolData, {
      seed: 7,
      iterations: 200,
      width: 800,
      height: 600,
      depth: 400,
      repulsion: 5000,
    })
    for (const p of r.positions) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(800)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(600)
      expect(p.z).toBeGreaterThanOrEqual(0)
      expect(p.z).toBeLessThanOrEqual(400)
    }
  })

  it('不同 seed 结果不同', () => {
    const a = layoutSymbolForce(symbolData, { seed: 1 })
    const b = layoutSymbolForce(symbolData, { seed: 2 })
    expect(b.positions).not.toEqual(a.positions)
  })

  it('坐标数量与节点顺序和输入一致', () => {
    const r = layoutSymbolForce(symbolData, { seed: 3 })
    expect(r.positions).toHaveLength(symbolData.nodes.length)
    expect(r.positions.map((p) => p.nodeId)).toEqual(symbolData.nodes.map((n) => n.id))
  })
})