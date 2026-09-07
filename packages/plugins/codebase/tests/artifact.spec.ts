/**
 * artifact persistence suite (EP-CB3, T4.5) — dump→restore round-trip over a
 * real temp-dir store, gzip-forced (zstd CLI may be absent in CI).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, dumpArtifact, restoreArtifact, removeArtifact, ProjectNotFoundError } from '../src/index.ts'
import type { NodeRecord } from '../src/index.ts'

const PROJECT = 'demo'
let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-artifact-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject(PROJECT)
  store.upsertNodes([
    node('fn:1', 'Function', 'demo.fn.alpha', 'src/a.ts'),
    node('cls:1', 'Class', 'demo.cls.Beta', 'src/b.ts'),
  ])
  store.insertEdges([
    { project: PROJECT, source: 'fn:1', target: 'cls:1', type: 'CALLS' },
  ])
  store.upsertTraces([{ project: PROJECT, trace_id: 't-1', name: 'index' }])
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function node(id: string, label: NodeRecord['label'], name: string, filePath: string): NodeRecord {
  return { id, project: PROJECT, label, name, filePath, props: { startLine: 1 } }
}

describe('dumpArtifact / restoreArtifact', () => {
  it('restores an idempotent copy of the dumped graph', () => {
    const out = join(dir, 'snapshot.ffg')
    const repo = dumpArtifact({ store, project: PROJECT, outPath: out, format: 'gzip' })
    expect(repo.format).toBe('gzip')
    expect(repo.nodeCount).toBe(2)
    expect(repo.edgeCount).toBe(1)
    expect(repo.traceCount).toBe(1)
    const filePath = `${out}.gz`
    expect(readFileSync(filePath).length).toBeGreaterThan(0)

    // Restore into a fresh store and assert the graph round-trips.
    const fresh = new CodebaseStore(join(dir, 'fresh.db'))
    fresh.open()
    const report = restoreArtifact({ store: fresh, project: 'restored', inPath: filePath })
    expect(report.project).toBe('restored')
    expect(fresh.allNodes('restored')).toHaveLength(2)
    expect(fresh.edgesOf('restored')).toHaveLength(1)
    expect(fresh.queryTraces('restored')).toHaveLength(1)
    fresh.dispose()
    removeArtifact(filePath)
  })

  it('reports the actual compression format used', () => {
    const out = join(dir, 'nofmt')
    const repo = dumpArtifact({ store, project: PROJECT, outPath: out, format: 'gzip' })
    expect(repo.path.endsWith('.gz')).toBe(true)
    removeArtifact(repo.path)
  })

  it('raises ProjectNotFoundError for an unknown project on dump', () => {
    const out = join(dir, 'x')
    expect(() => dumpArtifact({ store, project: 'ghost', outPath: out })).toThrow(ProjectNotFoundError)
  })
})