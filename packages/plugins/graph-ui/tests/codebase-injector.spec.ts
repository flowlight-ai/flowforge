/**
 * Contract suite: CodebaseGraphInjector（真实 codebase 只读注入器, EP-CB6 T6.4 接线验证）。
 *
 * 用真实 CodebaseStore（临时目录 real DB，无 mock，镜像 plugin-codebase 测试纪律）写入
 * 结构/符号节点与边，经 CodebaseGraphInjector 喂给 MemoryGraphDataPort，断言：
 * - structure 树 / symbol 图层级切分正确（注入节点、边过滤与归类、锚点解析）。
 * - loadAnchors 透传 anchorOf。
 * - 仅消费只读端口原语（nodesOf/edgesOf/anchorOf），不 import codebase、不写 DB。
 *
 * @module plugin-codebase/graph-ui/tests
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CodebaseStore } from '../../codebase/src/store.ts'
import { MemoryGraphDataPort } from '../src/data/memory.ts'
import { CodebaseGraphInjector } from '../src/data/codebase-injector.ts'
import type { CodebaseGraphRead } from '../src/data/codebase-injector.ts'

/** 用真实临时库构造 CodebaseGraphRead（web 层同一形状的实现）。 */
function makeRead(store: CodebaseStore): CodebaseGraphRead {
  // 真实 web 适配器会维护一个 id→节点 的 O(1) 索引（对齐 codebase indexNodePaths 思路），
  // 此处对 demo 工程所有节点预建，使 anchorOf 不依赖 nodesOf 先被调用的时序。
  const byId = new Map<string, ReturnType<CodebaseStore['allNodes']>[number]>()
  for (const node of store.allNodes('demo')) byId.set(node.id, node)
  return {
    nodesOf: (project: string) => store.allNodes(project),
    edgesOf: (project: string) => store.edgesOf(project),
    anchorOf: (nodeId: string) => {
      const node = byId.get(nodeId)
      if (node === undefined) return null
      return {
        nodeId: node.id,
        shortName: node.name,
        startLine: node.lines,
        endLine: node.lines,
        filePath: node.filePath,
      }
    },
  }
}

describe('CodebaseGraphInjector（真实临时库）', () => {
  let dir: string
  let store: CodebaseStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ff-graphui-codebase-'))
    store = new CodebaseStore(join(dir, 'codebase.db'))
    store.open()
    store.registerProject('demo')
    store.upsertNodes([
      { id: 'p', project: 'demo', label: 'Project', name: 'demo' },
      { id: 'f1', project: 'demo', label: 'Folder', name: 'src' },
      { id: 'f2', project: 'demo', label: 'Folder', name: 'linéaire' },
      { id: 'fileA', project: 'demo', label: 'File', name: 'index.ts', filePath: 'src/index.ts', lines: 12 },
      { id: 'fnA', project: 'demo', label: 'Function', name: 'openFile', filePath: 'src/index.ts', lines: 3 },
      { id: 'clsB', project: 'demo', label: 'Class', name: 'Store', filePath: 'src/store.ts', lines: 40 },
      // 非法标签/边：应被守卫过滤，不得进入 GraphData。
      { id: 'yunk', project: 'demo', label: 'NotALabel', name: 'garbage' },
    ])
    store.insertEdges([
      { project: 'demo', source: 'p', target: 'f1', type: 'CONTAINS_FOLDER' },
      { project: 'demo', source: 'f1', target: 'fileA', type: 'CONTAINS_FILE' },
      { project: 'demo', source: 'fileA', target: 'fnA', type: 'DEFINES' },
      { project: 'demo', source: 'fnA', target: 'clsB', type: 'USAGE' },
      // 非法边类型：应被过滤。
      { project: 'demo', source: 'p', target: 'fileA', type: 'MAGIC_LINK' },
    ])
  })

  afterEach(() => {
    store?.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('structure 树只包含结构层节点，并派生正确的容器边', async () => {
    const injector = new CodebaseGraphInjector(makeRead(store))
    const data = await new MemoryGraphDataPort(injector).loadStructureTree('demo')

    const labels = data.nodes.map((n) => n.label)
    expect(labels).toEqual(expect.arrayContaining(['Project', 'Folder', 'File']))
    expect(labels).not.toContain('Function')
    expect(labels).not.toContain('Class')
    expect(labels).not.toContain('NotALabel')

    // 保留结构与容器边，过滤符号/非法边
    const types = new Set(data.edges.map((e) => e.type))
    expect(types.has('CONTAINS_FOLDER')).toBe(true)
    expect(types.has('CONTAINS_FILE')).toBe(true)
    expect(types.has('DEFINES')).toBe(false)
    expect(types.has('MAGIC_LINK')).toBe(false)
    expect(data.meta.totalEdges).toBe(data.edges.length)
  })

  it('symbol 图固定 Function/Class/...，过滤结构节点与非法标签', async () => {
    const injector = new CodebaseGraphInjector(makeRead(store))
    const data = await new MemoryGraphDataPort(injector).loadSymbolGraph('demo')

    const labels = data.nodes.map((n) => n.label)
    expect(labels).toContain('Function')
    expect(labels).toContain('Class')
    expect(labels).not.toContain('File')
    expect(labels).not.toContain('Folder')
    expect(labels).not.toContain('Project')

    // 仅符号边入选；结构边（CONTAINS_FOLDER/IMPORTS）与跨结构→符号的 DEFINES 不入选
    const types = new Set(data.edges.map((e) => e.type))
    expect(types.has('USAGE')).toBe(true)
    expect(types.has('CONTAINS_FOLDER')).toBe(false)
    expect(types.has('DEFINES')).toBe(false)
  })

  it('锚点解析经 anchorOf 透传；未知 id 返回 null', async () => {
    const injector = new CodebaseGraphInjector(makeRead(store))
    const anchor = await injector.resolveAnchor('fnA')
    expect(anchor).not.toBeNull()
    expect(anchor?.filePath).toBe('src/index.ts')
    expect(anchor?.shortName).toBe('openFile')
    expect(anchor?.startLine).toBe(3)

    expect(await injector.resolveAnchor('missing')).toBeNull()
  })

  it('projectLabel 按边类型归类 structure/symbol/unknown', () => {
    const injector = new CodebaseGraphInjector(makeRead(store))
    expect(injector.projectLabel('x', { source: 'a', target: 'b', type: 'CONTAINS_FILE' })).toBe('structure')
    expect(injector.projectLabel('x', { source: 'a', target: 'b', type: 'DEFINES' })).toBe('symbol')
    expect(injector.projectLabel('x', { source: 'a', target: 'b', type: 'NOPE' })).toBeUndefined()
  })

  it('labelFilter 与 limit 作用于 symbol 层', async () => {
    const injector = new CodebaseGraphInjector(makeRead(store))
    const data = await new MemoryGraphDataPort(injector).loadSymbolGraph('demo', {
      labelFilter: ['Class'],
      limit: 1,
    })
    expect(data.nodes).toHaveLength(1)
    expect(data.nodes[0]?.label).toBe('Class')
  })
})