/**
 * Query layer suite (EP-CB0, T1.10) — validated surface over the store:
 * project existence contract, eager regex validation (usage errors),
 * BM25 ranked pagination with the id tie-break, schema/status views and
 * the iteratePages dump helper.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CodebaseStore,
  ProjectNotFoundError,
  UsageError,
  indexStatus,
  iteratePages,
  schemaFor,
  searchNodes,
} from '../src/index.ts'
import type { EdgeRecord, NodeRecord } from '../src/index.ts'

let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-query-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function symbol(id: string, name: string, label: NodeRecord['label'] = 'Function'): NodeRecord {
  return { id, project: 'demo', label, name }
}

describe('searchNodes — validation contract', () => {
  it('rejects unknown projects with ProjectNotFoundError (CLI exit 1 semantics)', () => {
    expect(() => searchNodes(store, { project: 'missing' })).toThrow(ProjectNotFoundError)
    expect(() => searchNodes(store, { project: 'missing' })).toThrow('先执行 ff_codebase index')
  })

  it('compiles regex filters eagerly so invalid patterns surface as UsageError (CLI exit 2)', () => {
    store.registerProject('demo')
    store.upsertNodes([symbol('fn:1', 'handlerA')])
    expect(() => searchNodes(store, { project: 'demo', namePattern: '([unclosed' })).toThrow(UsageError)
    expect(() => searchNodes(store, { project: 'demo', filePattern: '[bad' })).toThrow(UsageError)
    expect(() => searchNodes(store, { project: 'demo', namePattern: 'handler' })).not.toThrow()
  })
})

describe('searchNodes — BM25 ranked pagination contract', () => {
  beforeEach(() => {
    store.registerProject('demo')
    const nodes: NodeRecord[] = [
      symbol('fn:a', 'runHandlerA'),
      symbol('fn:b', 'runHandlerB'),
      symbol('fn:c', 'runHandlerC'),
      symbol('fn:d', 'parseConfig'),
    ]
    const edges: EdgeRecord[] = [
      { project: 'demo', source: 'fn:a', target: 'fn:b', type: 'CALLS' },
    ]
    store.upsertNodes(nodes)
    store.insertEdges(edges)
  })

  it('paginates ranked results with stable total/hasMore across offset pages', () => {
    const page1 = searchNodes(store, { project: 'demo', query: 'handler', limit: 2, offset: 0 })
    expect(page1.rows.map(row => row.name)).toEqual(['runHandlerA', 'runHandlerB'])
    expect(page1.total).toBe(3)
    expect(page1.hasMore).toBe(true)
    const page2 = searchNodes(store, { project: 'demo', query: 'handler', limit: 2, offset: 2 })
    expect(page2.rows.map(row => row.name)).toEqual(['runHandlerC'])
    expect(page2.hasMore).toBe(false)
    const union = [...page1.rows, ...page2.rows]
    expect(new Set(union.map(row => row.id)).size).toBe(3)
  })

  it('keeps degree filters working in ranked mode', () => {
    const minOne = searchNodes(store, { project: 'demo', query: 'handler', minDegree: 1 })
    expect(minOne.rows.map(row => row.name).sort()).toEqual(['runHandlerA', 'runHandlerB'])
    const maxZero = searchNodes(store, { project: 'demo', query: 'handler', maxDegree: 0 })
    expect(maxZero.rows.map(row => row.name)).toEqual(['runHandlerC'])
  })
})

describe('schemaFor / indexStatus', () => {
  beforeEach(() => {
    store.registerProject('demo')
    store.registerProject('other')
    store.upsertNodes([
      symbol('fn:1', 'handlerA'),
      { ...symbol('cls:1', 'Handler', 'Class'), project: 'demo' },
      { ...symbol('f:1', 'a.ts', 'File'), project: 'other' },
    ])
    store.insertEdges([{ project: 'demo', source: 'cls:1', target: 'fn:1', type: 'IMPLEMENTS' }])
  })

  it('returns the schema overview scoped to a project', () => {
    const overview = schemaFor(store, 'demo')
    expect([...overview.nodeLabels].sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: 'Class', count: 1 },
      { label: 'Function', count: 1 },
    ])
    expect(overview.edgeTypes).toEqual([{ type: 'IMPLEMENTS', count: 1 }])
    expect(overview.projects.map(info => info.name)).toEqual(['demo', 'other'])
  })

  it('rejects schema/status for unknown projects', () => {
    expect(() => schemaFor(store, 'missing')).toThrow(ProjectNotFoundError)
    expect(() => indexStatus(store, 'missing')).toThrow(ProjectNotFoundError)
  })

  it('reports live node/edge counts alongside the persisted project row', () => {
    store.updateProjectIndexState('demo', 'full', 7)
    const statuses = indexStatus(store)
    expect(statuses.map(entry => entry.project.name)).toEqual(['demo', 'other'])
    const demo = statuses.find(entry => entry.project.name === 'demo')
    expect(demo?.project.filesIndexed).toBe(7)
    expect(demo?.project.lastMode).toBe('full')
    expect(demo?.nodeCount).toBe(2)
    expect(demo?.edgeCount).toBe(1)
    const single = indexStatus(store, 'demo')
    expect(single.map(entry => entry.project.name)).toEqual(['demo'])
  })
})

describe('iteratePages', () => {
  beforeEach(() => {
    store.registerProject('demo')
  })

  it('yields every row across pages of the requested size', () => {
    const nodes: NodeRecord[] = []
    for (let index = 0; index < 7; index += 1) {
      nodes.push(symbol(`fn:${index}`, `handler${index}`))
    }
    store.upsertNodes(nodes)
    const collected: string[] = []
    for (const page of iteratePages(store, { project: 'demo', namePattern: '^handler' }, 3)) {
      expect(page.length).toBeLessThanOrEqual(3)
      collected.push(...page.map(row => row.name))
    }
    expect(collected).toHaveLength(7)
  })

  it('yields nothing for an empty result set', () => {
    store.upsertNodes([symbol('fn:1', 'handlerA')])
    const pages = [...iteratePages(store, { project: 'demo', namePattern: 'nomatch' }, 3)]
    expect(pages).toEqual([])
  })
})
