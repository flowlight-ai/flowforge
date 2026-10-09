/**
 * Contract suite: 只读数据 seam 消费契约（EP-CB6 T6.2 / T6.5）。
 *
 * MemoryGraphDataPort 消费纯内存桩 GraphDataInjector（直接构造 GraphNode[]/GraphEdge[]），
 * 断言结构树层级/深度/边派生、符号图过滤/截断/边归一化、loadAnchors 透传与 meta 计数。
 * 不 mock 文件系统，无 node:fs。
 */

import { describe, expect, it } from 'vitest'

import type { EdgeKind, GraphAnchor, GraphData, GraphEdge, GraphNode } from '../src/contacts/graph-data.ts'
import { MemoryGraphDataPort } from '../src/data/memory.ts'
import type { GraphDataInjector } from '../src/data/ports.ts'

type TestGraph = {
  structure: readonly GraphNode[]
  symbol: readonly GraphNode[]
  edges: readonly GraphEdge[]
}

const STRUCTURE_EDGE_TYPES = ['CONTAINS_FOLDER', 'CONTAINS_FILE', 'IMPORTS']

/** 内存桩：直接提供注入数组。 */
function makeStub(graph: TestGraph): GraphDataInjector {
  return {
    loadStructureNodes: () => graph.structure,
    loadSymbolNodes: () => graph.symbol,
    loadEdges: () => graph.edges,
    resolveAnchor: (nodeId: string): GraphAnchor | null => {
      const found = [...graph.structure, ...graph.symbol].find((n) => n.id === nodeId)
      return found
        ? { nodeId: found.id, shortName: found.shortName ?? found.name, startLine: found.startLine, endLine: found.endLine, filePath: found.filePath }
        : null
    },
    projectLabel: (_nodeId: string, edge: GraphEdge): EdgeKind | undefined => {
      if (STRUCTURE_EDGE_TYPES.includes(edge.type)) return 'structure'
      return 'symbol'
    },
  }
}

const fixture: TestGraph = {
  structure: [
    { id: 'proj', label: 'Project', name: 'proj' },
    { id: 'src', label: 'Folder', name: 'src' },
    { id: 'lib', label: 'Folder', name: 'lib' },
    { id: 'a', label: 'File', name: 'a.ts' },
    { id: 'b', label: 'File', name: 'b.ts' },
    { id: 'm', label: 'Module', name: 'm' },
  ],
  symbol: [
    { id: 'fn1', label: 'Function', name: 'fn', shortName: 'fn1', startLine: 5, endLine: 20, filePath: 'a.ts' },
    { id: 'fn2', label: 'Function', name: 'fn', shortName: 'fn2', startLine: 30, endLine: 40, filePath: 'a.ts' },
    { id: 'cls', label: 'Class', name: 'Cls' },
    { id: 'var', label: 'Variable', name: 'v' },
  ],
  edges: [
    { source: 'proj', target: 'src', type: 'CONTAINS_FOLDER' },
    { source: 'proj', target: 'lib', type: 'CONTAINS_FOLDER' },
    { source: 'src', target: 'a', type: 'CONTAINS_FILE' },
    { source: 'src', target: 'b', type: 'CONTAINS_FILE' },
    { source: 'a', target: 'm', type: 'CONTAINS_FILE' },
    { source: 'a', target: 'b', type: 'IMPORTS' },
    { source: 'cls', target: 'fn1', type: 'DEFINES' },
    { source: 'cls', target: 'fn2', type: 'DEFINES_METHOD' },
    { source: 'fn1', target: 'fn2', type: 'CALLS' },
    { source: 'fn1', target: 'var', type: 'USAGE' },
  ],
}

describe('MemoryGraphDataPort.loadStructureTree（结构层树契约）', () => {
  const port = new MemoryGraphDataPort(makeStub(fixture))

  it('生成投影的层级深度与 meta.totalNodes', async () => {
    const data = await port.loadStructureTree('proj')
    expect(data.nodes.map((n) => n.id)).toEqual(['proj', 'src', 'lib', 'a', 'b', 'm'])
    expect(data.meta.totalNodes).toBe(6)
    // 层级深度：proj=0, src/lib=1, a/b=2, m=3
    expect(depthOf(data, 'proj')).toBe(0)
    expect(depthOf(data, 'src')).toBe(1)
    expect(depthOf(data, 'lib')).toBe(1)
    expect(depthOf(data, 'a')).toBe(2)
    expect(depthOf(data, 'm')).toBe(3)
    expect(data.meta.projectId).toBe('proj')
  })

  it('结构边正确派生（CONTAINS_FILE/CONTAINS_FILE/IMPORTS）', async () => {
    const data = await port.loadStructureTree('proj')
    const byType = new Map<string, number>()
    for (const e of data.edges) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
    expect(byType.get('CONTAINS_FOLDER')).toBe(2)
    expect(byType.get('CONTAINS_FILE')).toBe(3)
    expect(byType.get('IMPORTS')).toBe(1)
    expect(data.meta.totalEdges).toBe(6)
    // IMPORTS 边为结构边但不计入容器父子（仍被返回）。
    expect(data.edges.some((e) => e.type === 'IMPORTS' && e.source === 'a' && e.target === 'b')).toBe(true)
  })

  it('maxDepth 过滤深层节点并裁剪相关边', async () => {
    const data = await port.loadStructureTree('proj', { maxDepth: 1 })
    expect(data.nodes.map((n) => n.id)).toEqual(['proj', 'src', 'lib'])
    expect(data.meta.totalNodes).toBe(3)
    const containsFile = data.edges.filter((e) => e.type === 'CONTAINS_FILE').length
    expect(containsFile).toBe(0)
    expect(data.edges.some((e) => e.type === 'IMPORTS')).toBe(false)
    expect(data.meta.totalEdges).toBe(2)
  })
})

describe('MemoryGraphDataPort.loadSymbolGraph（符号层图契约）', () => {
  const port = new MemoryGraphDataPort(makeStub(fixture))

  it('符号边归一化且仅含两端存活节点的边', async () => {
    const data = await port.loadSymbolGraph('proj')
    expect(data.nodes.map((n) => n.id)).toEqual(['fn1', 'fn2', 'cls', 'var'])
    expect(data.meta.totalNodes).toBe(4)
    // 仅符号边：缩放入库的 DEFINES/DEFINES_METHOD/CALLS/USAGE，无结构边 IMPORTS/CONTAINS。
    expect(data.edges.some((e) => e.type === 'IMPORTS' || e.type === 'CONTAINS_FILE')).toBe(false)
    expect(data.edges.length).toBe(4)
    expect(data.edges.every((e) => e.source !== e.target)).toBe(true)
  })

  it('labelFilter 仅保留目标标签的符号节点', async () => {
    const data = await port.loadSymbolGraph('proj', { labelFilter: ['Function'] })
    expect(data.nodes.map((n) => n.id)).toEqual(['fn1', 'fn2'])
    expect(data.meta.totalNodes).toBe(2)
    expect(data.edges.length).toBe(1)
    expect(data.edges[0]).toMatchObject({ source: 'fn1', target: 'fn2', type: 'CALLS' })
  })

  it('limit 截断节点并同步裁剪边', async () => {
    const data = await port.loadSymbolGraph('proj', { limit: 2 })
    expect(data.nodes.map((n) => n.id)).toEqual(['fn1', 'fn2'])
    expect(data.meta.totalNodes).toBe(2)
    expect(data.edges.length).toBe(1)
  })
})

describe('MemoryGraphDataPort.loadAnchors（定义锚点透传）', () => {
  const port = new MemoryGraphDataPort(makeStub(fixture))

  it('透传 resolveAnchor 的定义锚点', async () => {
    const anchor = await port.loadAnchors('fn1')
    expect(anchor).toEqual({
      nodeId: 'fn1',
      shortName: 'fn1',
      startLine: 5,
      endLine: 20,
      filePath: 'a.ts',
    })
  })

  it('缺失节点返回 null', async () => {
    expect(await port.loadAnchors('missing')).toBeNull()
  })
})

/** 由结构边推导节点深度（测试辅助，与布局层契约一致）。 */
function depthOf(data: GraphData, nodeId: string): number {
  const depth = new Map(data.nodes.map((n) => [n.id, 0]))
  const contain = data.edges.filter((e) => e.type === 'CONTAINS_FOLDER' || e.type === 'CONTAINS_FILE')
  for (let pass = 0; pass < data.nodes.length; pass += 1) {
    for (const e of contain) {
      const pd = depth.get(e.source) ?? 0
      const cd = depth.get(e.target) ?? 0
      if (cd <= pd) depth.set(e.target, pd + 1)
    }
  }
  return depth.get(nodeId) ?? 0
}