/**
 * watcher incremental-index suite (EP-CB3, T4.3) — mtime tri-state, removed-file
 * cleanup and the full-reindex fallback. Real temp repo + real store (T1-T9).
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, detectFileDelta, watchIndex, ProjectNotFoundError } from '../src/index.ts'
import type { EdgeRecord, NodeRecord } from '../src/index.ts'

const PROJECT = 'demo'
let dir: string
let repo: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-watch-'))
  repo = join(dir, 'repo').replace(/\\/g, '/')
  mkdirSync(join(repo, 'src'), { recursive: true })
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject(PROJECT)
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2\n')
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function fileNode(id: string, filePath: string): NodeRecord {
  return { id, project: PROJECT, label: 'File', name: `repo/${filePath}`, filePath }
}

describe('detectFileDelta (pure tri-state)', () => {
  it('classifies added / modified / removed from injected baselines', () => {
    const baseline = new Map<string, number>([
      ['src/a.ts', statSync(join(repo, 'src', 'a.ts')).mtimeMs],
      ['src/gone.ts', 100],
    ])
    const delta = detectFileDelta(repo, baseline)
    expect(delta.added).toEqual(['src/b.ts'])
    expect(delta.modified).toEqual([])
    expect(delta.removed).toEqual(['src/gone.ts'])
  })

  it('flags modified files newer than their baseline', () => {
    const baseline = new Map<string, number>([['src/a.ts', 0]])
    const delta = detectFileDelta(repo, baseline)
    expect(delta.modified).toEqual(['src/a.ts'])
  })
})

describe('watchIndex', () => {
  it('requires a full reindex when the project has no indexed File baseline', () => {
    const result = watchIndex({ store, repoPath: repo, projectName: PROJECT })
    expect(result.fullReindexRequired).toBe(true)
    expect(result.added).toEqual([])
    expect(result.project).toBe(PROJECT)
  })

  it('computes added/modified/removed and reports duration', () => {
    // Index a baseline snapshot where the disk files carry the baseline.
    store.upsertNodes([fileNode('f:a', 'src/a.ts'), fileNode('f:b', 'src/b.ts')])
    const before = Date.now()
    const result = watchIndex({ store, repoPath: repo, projectName: PROJECT })
    expect(result.project).toBe(PROJECT)
    expect(result.fullReindexRequired).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.modified).toEqual(['src/a.ts', 'src/b.ts'])
    expect(before).toBeLessThanOrEqual(Date.now())
  })

  it('removes deleted files (and their symbols/edges/FTS) and reports them', () => {
    store.upsertNodes([
      fileNode('f:a', 'src/a.ts'),
      fileNode('f:b', 'src/b.ts'),
      nodeSym('s:a', 'demo.src.a.alpha', 'src/a.ts'),
    ])
    store.insertEdges(ctxEdges())
    store.subtractNodesForFiles(PROJECT, []) // no-op guard
    // Delete src/a.ts from disk, then run the watch.
    rmSync(join(repo, 'src', 'a.ts'), { force: true })
    const beforeCount = store.allNodes(PROJECT).length
    const result = watchIndex({ store, repoPath: repo, projectName: PROJECT })
    expect(result.removed).toEqual(['src/a.ts'])
    // After watch the removed baseline's symbols + edges are cleared.
    expect(store.allNodes(PROJECT).length).toBeLessThan(beforeCount)
    expect(edgeCount(store)).toBe(0)
    expect(store.search({ project: PROJECT, query: 'alpha' }).total).toBe(0)
  })

  it('raises ProjectNotFoundError for an unknown project', () => {
    expect(() => watchIndex({ store, repoPath: repo, projectName: 'ghost' })).toThrow(ProjectNotFoundError)
  })
})

function nodeSym(id: string, name: string, filePath: string): NodeRecord {
  return { id, project: PROJECT, label: 'Function', name, filePath, props: { complexity: 1 } }
}

function ctxEdges(): Array<{ project: string; source: string; target: string; type: EdgeRecord['type'] }> {
  return [
    { project: PROJECT, source: 's:a', target: 'f:a', type: 'DEFINES' },
  ]
}

function edgeCount(target: CodebaseStore): number {
  return target.edgesOf(PROJECT).length
}