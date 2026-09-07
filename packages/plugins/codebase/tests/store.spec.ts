/**
 * Storage engine suite (EP-CB0, T1.10) — real node:sqlite, real temp
 * directory, zero mocks (test ironclad rule T1–T9).
 *
 * Pins: schema bootstrap idempotency, RAM-first batched upserts (FTS resync),
 * edge dedup, multi-project registry, deleteProject cascade, BM25 search
 * (camelCase split + label boost + noise filter + id tie-break) and the
 * pagination contract (total/hasMore across offset pages).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, buildFtsMatch, tokenizeName } from '../src/index.ts'
import type { EdgeRecord, NodeRecord } from '../src/index.ts'

let dir: string
let dbPath: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-store-'))
  dbPath = join(dir, 'codebase.db')
  store = new CodebaseStore(dbPath)
  store.open()
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function node(id: string, label: NodeRecord['label'], name: string, extra: Partial<NodeRecord> = {}): NodeRecord {
  return { id, project: 'demo', label, name, ...extra }
}

describe('open / dispose', () => {
  it('bootstraps the schema idempotently across reopens', () => {
    store.dispose()
    const reopened = new CodebaseStore(dbPath)
    reopened.open()
    reopened.registerProject('demo')
    expect(reopened.listProjects().map(info => info.name)).toEqual(['demo'])
    reopened.dispose()
  })

  it('rejects operations before open()', () => {
    const closed = new CodebaseStore(dbPath)
    expect(() => closed.registerProject('demo')).toThrow('store 未 open')
  })
})

describe('tokenizeName / buildFtsMatch', () => {
  it('splits camelCase, snake/kebab separators and keeps the raw identifier', () => {
    expect(tokenizeName('updateCloudClient')).toBe('updatecloudclient update cloud client')
    expect(tokenizeName('ff_codebase-cli')).toBe('ff_codebase-cli ff codebase cli')
    expect(tokenizeName('HandleHTTPResponse')).toBe('handlehttpresponse handle http response')
  })

  it('escapes user tokens into an implicit-OR FTS match expression', () => {
    expect(buildFtsMatch('cloud client')).toBe('"cloud" OR "client"')
    expect(buildFtsMatch('')).toBe('""')
    expect(buildFtsMatch('we"ird')).toBe('"we""ird"')
  })
})

describe('upsertNodes / insertEdges', () => {
  it('upserts nodes with full FTS resync (idempotent, no stale rows)', () => {
    store.upsertNodes([node('fn:1', 'Function', 'updateCloudClient', { lines: 10 })])
    store.upsertNodes([node('fn:1', 'Function', 'renamedFunction', { lines: 20 })])
    const result = store.search({ project: 'demo', query: 'updateCloudClient' })
    expect(result.total).toBe(0)
    const renamed = store.search({ project: 'demo', query: 'renamedFunction' })
    expect(renamed.total).toBe(1)
    expect(renamed.rows[0]?.name).toBe('renamedFunction')
    expect(renamed.rows[0]?.lines).toBe(20)
  })

  it('round-trips optional fields and props as absent-or-present (never null)', () => {
    store.upsertNodes([
      node('fn:1', 'Function', 'plain'),
      node('fn:2', 'Function', 'rich', { filePath: 'src/a.ts', language: 'typescript', lines: 3, sizeBytes: 42, props: { complexity: 7, recursive: true } }),
    ])
    const rows = store.search({ project: 'demo', namePattern: 'plain|rich' }).rows
    const plain = rows.find(row => row.name === 'plain')
    const rich = rows.find(row => row.name === 'rich')
    expect(plain?.filePath).toBeUndefined()
    expect(plain?.props).toBeUndefined()
    expect(rich?.filePath).toBe('src/a.ts')
    expect(rich?.language).toBe('typescript')
    expect(rich?.lines).toBe(3)
    expect(rich?.sizeBytes).toBe(42)
    expect(rich?.props).toEqual({ complexity: 7, recursive: true })
  })

  it('dedups edges via the primary key', () => {
    const edge: EdgeRecord = { project: 'demo', source: 'fn:1', target: 'fn:2', type: 'CALLS' }
    store.insertEdges([edge, edge, edge])
    expect(store.edgeTypeCounts('demo')).toEqual([{ type: 'CALLS', count: 1 }])
  })
})

describe('multi-project registry', () => {
  it('lists projects ordered by name and keeps index state per project', () => {
    store.registerProject('beta')
    store.registerProject('alpha')
    store.updateProjectIndexState('beta', 'full', 12)
    const names = store.listProjects().map(info => info.name)
    expect(names).toEqual(['alpha', 'beta'])
    const beta = store.listProjects().find(info => info.name === 'beta')
    expect(beta?.lastMode).toBe('full')
    expect(beta?.filesIndexed).toBe(12)
    expect(beta?.lastIndexedAt).toBeDefined()
    const alpha = store.listProjects().find(info => info.name === 'alpha')
    expect(alpha?.lastIndexedAt).toBeUndefined()
  })

  it('deletes a project cascading nodes, edges and FTS rows', () => {
    store.registerProject('demo')
    store.registerProject('other')
    store.upsertNodes([
      node('fn:1', 'Function', 'updateCloudClient'),
      { ...node('fn:x', 'Function', 'otherProject'), project: 'other' },
    ])
    store.insertEdges([{ project: 'demo', source: 'fn:1', target: 'fn:x', type: 'CALLS' }])
    expect(store.deleteProject('demo')).toBe(true)
    expect(store.deleteProject('demo')).toBe(false)
    expect(store.search({ project: 'demo', query: 'cloud' }).total).toBe(0)
    expect(store.search({ project: 'demo' }).total).toBe(0)
    expect(store.search({ project: 'other', query: 'otherProject' }).total).toBe(1)
    expect(store.edgeTypeCounts('demo')).toEqual([])
  })
})

describe('search — BM25 ranked mode (query provided)', () => {
  beforeEach(() => {
    store.upsertNodes([
      node('fn:cloud', 'Function', 'updateCloudClient', { filePath: 'src/cloud.ts' }),
      node('cls:cloud', 'Class', 'CloudClient', { filePath: 'src/cloud.ts' }),
      node('mod:cloud', 'Module', 'cloud', { filePath: 'src/cloud.ts' }),
      node('file:cloud', 'File', 'cloud.ts', { filePath: 'src/cloud.ts' }),
      node('fn:other', 'Function', 'parseConfig', { filePath: 'src/config.ts' }),
    ])
  })

  it('ranks label-boost order Function > Class > Module and filters noise labels', () => {
    const result = store.search({ project: 'demo', query: 'cloud' })
    expect(result.rows.map(row => row.name)).toEqual(['updateCloudClient', 'CloudClient', 'cloud'])
    expect(result.rows.map(row => row.label)).toEqual(['Function', 'Class', 'Module'])
    expect(result.total).toBe(3)
  })

  it('matches camelCase identifiers through the split-token index', () => {
    const orQuery = store.search({ project: 'demo', query: 'cloud client' })
    expect(orQuery.rows.map(row => row.name)).toEqual(['updateCloudClient', 'CloudClient', 'cloud'])
    const updateOnly = store.search({ project: 'demo', query: 'update' })
    expect(updateOnly.rows.map(row => row.name)).toEqual(['updateCloudClient'])
    const single = store.search({ project: 'demo', query: 'cloudclient' })
    expect(single.rows.map(row => row.name)).toEqual(['CloudClient'])
  })

  it('applies label and regex filters as rank-preserving post-filters', () => {
    const all = store.search({ project: 'demo', query: 'cloud' })
    const classes = store.search({ project: 'demo', query: 'cloud', label: 'Class' })
    expect(classes.rows.map(row => row.name)).toEqual(['CloudClient'])
    const byFile = store.search({ project: 'demo', query: 'cloud', filePattern: 'cloud\\.ts$' })
    expect(byFile.rows.length).toBe(3)
    const byName = store.search({ project: 'demo', query: 'cloud', namePattern: '^Cloud' })
    expect(byName.rows.map(row => row.name)).toEqual(['CloudClient'])
    expect(classes.rows[0]?.name).toBe(all.rows.find(row => row.label === 'Class')?.name)
  })

  it('filters by CALLS-degree (min/max over in+out)', () => {
    store.insertEdges([
      { project: 'demo', source: 'fn:cloud', target: 'fn:other', type: 'CALLS' },
      { project: 'demo', source: 'cls:cloud', target: 'fn:cloud', type: 'CONTAINS_FILE' },
    ])
    const minOne = store.search({ project: 'demo', query: 'cloud', minDegree: 1 })
    expect(minOne.rows.map(row => row.name)).toEqual(['updateCloudClient'])
    const maxZero = store.search({ project: 'demo', query: 'cloud', maxDegree: 0 })
    expect(maxZero.rows.map(row => row.name)).toEqual(['CloudClient', 'cloud'])
  })
})

describe('search — structural mode (no query)', () => {
  it('paginates deterministically with the total/hasMore contract', () => {
    const nodes: NodeRecord[] = []
    for (let index = 0; index < 25; index += 1) {
      nodes.push(node(`f:${index}`, 'File', `file${index}.ts`))
    }
    store.upsertNodes(nodes)
    const page1 = store.search({ project: 'demo', limit: 10, offset: 0 })
    expect(page1.rows).toHaveLength(10)
    expect(page1.total).toBe(25)
    expect(page1.hasMore).toBe(true)
    const page3 = store.search({ project: 'demo', limit: 10, offset: 20 })
    expect(page3.rows).toHaveLength(5)
    expect(page3.hasMore).toBe(false)
    const union = [...store.search({ project: 'demo', limit: 10, offset: 0 }).rows, ...store.search({ project: 'demo', limit: 10, offset: 10 }).rows, ...page3.rows]
    expect(new Set(union.map(row => row.id)).size).toBe(25)
  })

  it('applies structural filters without BM25', () => {
    store.upsertNodes([
      node('f:1', 'File', 'a.ts', { filePath: 'src/a.ts' }),
      node('f:2', 'File', 'b.ts', { filePath: 'src/b.ts' }),
      node('f:3', 'Folder', 'src'),
    ])
    const files = store.search({ project: 'demo', label: 'File' })
    expect(files.total).toBe(2)
    const srcOnly = store.search({ project: 'demo', filePattern: '^src/' })
    expect(srcOnly.rows.map(row => row.name)).toEqual(['a.ts', 'b.ts'])
    const folder = store.search({ project: 'demo', label: 'Folder', namePattern: '^sr' })
    expect(folder.rows.map(row => row.name)).toEqual(['src'])
  })
})

describe('schemaOverview', () => {
  it('aggregates label and edge type counts across projects', () => {
    store.upsertNodes([
      node('f:1', 'File', 'a.ts'),
      node('f:2', 'File', 'b.ts'),
      node('d:1', 'Folder', 'src'),
    ])
    store.insertEdges([{ project: 'demo', source: 'd:1', target: 'f:1', type: 'CONTAINS_FILE' }])
    const overview = store.schemaOverview('demo')
    expect(overview.nodeLabels).toEqual([
      { label: 'File', count: 2 },
      { label: 'Folder', count: 1 },
    ])
    expect(overview.edgeTypes).toEqual([{ type: 'CONTAINS_FILE', count: 1 }])
    expect(store.schemaOverview().nodeLabels).toEqual(overview.nodeLabels)
  })

  it('exposes edgesOf for raw adjacency access', () => {
    store.insertEdges([{ project: 'demo', source: 'a', target: 'b', type: 'CALLS' }])
    expect(store.edgesOf('demo')).toEqual([{ project: 'demo', source: 'a', target: 'b', type: 'CALLS' }])
  })
})

describe('EP-CB1 — QN lookup and file outline', () => {
  beforeEach(() => {
    store.upsertNodes([
      node('s:1', 'Function', 'demo.src.store.upsertNodes', { filePath: 'src/store.ts', props: { shortName: 'upsertNodes', startLine: 10, endLine: 40 } }),
      node('s:2', 'Class', 'demo.src.store.CodebaseStore', { filePath: 'src/store.ts', props: { shortName: 'CodebaseStore', startLine: 50, endLine: 200 } }),
      node('s:3', 'Method', 'demo.src.store.CodebaseStore.search', { filePath: 'src/store.ts', props: { shortName: 'search', startLine: 60, endLine: 90 } }),
      node('s:4', 'Enum', 'demo.src.store.Mode', { filePath: 'src/store.ts', props: { shortName: 'Mode', startLine: 5, endLine: 8 } }),
      node('s:5', 'Type', 'demo.src.store.StoreOptions', { filePath: 'src/store.ts', props: { shortName: 'StoreOptions', startLine: 1, endLine: 3 } }),
      { ...node('f:1', 'File', 'src/store.ts'), filePath: 'src/store.ts' },
    ])
  })

  it('findNodeByQn hits exactly and misses unknowns', () => {
    expect(store.findNodeByQn('demo', 'demo.src.store.upsertNodes')?.label).toBe('Function')
    expect(store.findNodeByQn('demo', 'demo.src.store.CodebaseStore.search')?.label).toBe('Method')
    expect(store.findNodeByQn('demo', 'demo.src.store.missing')).toBeUndefined()
    expect(store.findNodeByQn('other', 'demo.src.store.upsertNodes')).toBeUndefined()
  })

  it('findNodesByQnSuffix returns segment-boundary candidates only', () => {
    const hits = store.findNodesByQnSuffix('demo', 'search')
    expect(hits.map(hit => hit.name)).toEqual(['demo.src.store.CodebaseStore.search'])
    const multi = store.findNodesByQnSuffix('demo', 'store.CodebaseStore')
    expect(multi.map(hit => hit.name)).toEqual(['demo.src.store.CodebaseStore'])
    const exact = store.findNodesByQnSuffix('demo', 'demo.src.store.Mode')
    expect(exact.map(hit => hit.name)).toEqual(['demo.src.store.Mode'])
    expect(store.findNodesByQnSuffix('demo', 'tore')).toEqual([])
    expect(store.findNodesByQnSuffix('demo', 'store')).toEqual([])
  })

  it('fileOutline orders by start line and paginates with hasMore', () => {
    const outline = store.fileOutline('demo', 'src/store.ts')
    expect(outline.rows.map(row => row.props?.shortName)).toEqual(['StoreOptions', 'Mode', 'upsertNodes', 'CodebaseStore', 'search'])
    expect(outline.total).toBe(5)
    expect(outline.hasMore).toBe(false)
    const page = store.fileOutline('demo', 'src/store.ts', { limit: 2 })
    expect(page.rows.map(row => row.props?.shortName)).toEqual(['StoreOptions', 'Mode'])
    expect(page.total).toBe(5)
    expect(page.hasMore).toBe(true)
    const classOnly = store.fileOutline('demo', 'src/store.ts', { labels: ['Class', 'Method'] })
    expect(classOnly.rows.map(row => row.props?.shortName)).toEqual(['CodebaseStore', 'search'])
  })

  it('round-trips Enum and Type labels with DEFINES/DEFINES_METHOD edges', () => {
    store.insertEdges([
      { project: 'demo', source: 'f:1', target: 's:4', type: 'DEFINES' },
      { project: 'demo', source: 's:2', target: 's:3', type: 'DEFINES_METHOD' },
    ])
    const counts = store.edgeTypeCounts('demo')
    expect(counts).toContainEqual({ type: 'DEFINES', count: 1 })
    expect(counts).toContainEqual({ type: 'DEFINES_METHOD', count: 1 })
    const schema = store.schemaOverview('demo')
    expect(schema.nodeLabels).toContainEqual({ label: 'Enum', count: 1 })
    expect(schema.nodeLabels).toContainEqual({ label: 'Type', count: 1 })
  })
})

describe('EP-CB3 — traces, edgesByType and subtractNodesForFiles', () => {
  beforeEach(() => {
    store.upsertNodes([
      { ...node('f:1', 'File', 'src/a.ts'), filePath: 'src/a.ts' },
      { ...node('s:1', 'Function', 'demo.src.a.alpha'), filePath: 'src/a.ts' },
      { ...node('f:2', 'File', 'src/b.ts'), filePath: 'src/b.ts' },
      { ...node('s:2', 'Function', 'demo.src.b.beta'), filePath: 'src/b.ts' },
    ])
    store.insertEdges([
      { project: 'demo', source: 's:1', target: 's:2', type: 'CALLS' },
      { project: 'demo', source: 'f:1', target: 's:1', type: 'DEFINES' },
      { project: 'demo', source: 'f:1', target: 's:2', type: 'USAGE' },
    ])
  })

  it('upserts and queries trace records newest-first', () => {
    store.upsertTraces([
      { project: 'demo', trace_id: 't-1', name: 'index', agent: 'trae', timestamp: '2026-09-07T01:00:00Z', metadata: { files: 3 } },
      { project: 'demo', trace_id: 't-2', name: 'query', timestamp: '2026-09-07T03:00:00Z' },
    ])
    const traces = store.queryTraces('demo', 10)
    expect(traces.map(trace => trace.trace_id)).toEqual(['t-2', 't-1'])
    expect(traces[1]?.agent).toBe('trae')
    expect(traces[1]?.metadata).toEqual({ files: 3 })
    // Overwrites on the same trace_id (idempotent upsert).
    store.upsertTraces([{ project: 'demo', trace_id: 't-1', name: 'reindex' }])
    const updated = store.queryTraces('demo', 10)
    expect(updated.find(trace => trace.trace_id === 't-1')?.name).toBe('reindex')
    expect(updated.length).toBe(2)
  })

  it('filters edges by edge type via edgesByType', () => {
    const calls = store.edgesByType('demo', ['CALLS'])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ source: 's:1', target: 's:2', type: 'CALLS' })
    const multi = store.edgesByType('demo', ['CALLS', 'USAGE'])
    expect(multi).toHaveLength(2)
    expect(store.edgesByType('demo', [])).toEqual([])
    const unknown = store.edgesByType('demo', ['INHERITS'])
    expect(unknown).toEqual([])
  })

  it('subtractNodesForFiles deletes file + symbol nodes and touching edges', () => {
    const removed = store.subtractNodesForFiles('demo', ['src/a.ts'])
    expect(removed).toBe(2)
    const remaining = store.allNodes('demo').map(node => node.filePath)
    expect(remaining).not.toContain('src/a.ts')
    // The CALLS edge between the removed symbol and b's symbol is gone.
    const edges = store.edgesOf('demo')
    expect(edges.filter(edge => edge.type === 'CALLS')).toEqual([])
    // FTS rows for the removed symbols are gone.
    expect(store.search({ project: 'demo', query: 'alpha' }).total).toBe(0)
  })

  it('listFileNodes returns only File-label nodes', () => {
    const files = store.listFileNodes('demo')
    expect(files.map(file => file.filePath)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files.every(file => file.label === 'File')).toBe(true)
  })
})
