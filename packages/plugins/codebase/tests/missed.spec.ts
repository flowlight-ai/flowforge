/**
 * missed graph suite (EP-CB3, T4.2) — unindexed file reporting folded into a
 * navigable directory skeleton. Real temp repo on disk, real store (T1-T9).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, missedGraph, ProjectNotFoundError } from '../src/index.ts'
import type { MissedDir, NodeRecord } from '../src/index.ts'

const PROJECT = 'demo'
let dir: string
let repo: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-missed-'))
  repo = join(dir, 'repo').replace(/\\/g, '/')
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true })
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject(PROJECT)
  // Indexed files (subset of what is on disk).
  store.upsertNodes([
    fileNode('f:1', `${repo}`.split('/').pop() ?? 'repo', 'src/a.ts'),
  ])
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 2\n')
  writeFileSync(join(repo, 'src', 'deep', 'c.ts'), 'export const c = 3\n')
  writeFileSync(join(repo, 'README.md'), '# demo\n')
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function fileNode(id: string, name: string, filePath: string): NodeRecord {
  return { id, project: PROJECT, label: 'File', name, filePath }
}

describe('missedGraph', () => {
  it('reports unindexed files in a directory skeleton', () => {
    const result = missedGraph(store, PROJECT, repo)
    expect(result.totalMissed).toBe(3)
    const srcdir = result.tree.find(entry => entry.dir === 'src')
    const paths = walkFiles(result.tree)
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'src/b.ts', 'src/deep/c.ts']))
    expect(srcdir?.subdirs?.map(entry => entry.dir)).toContain('deep')
  })

  it('excludes indexed files from the missed set', () => {
    const result = missedGraph(store, PROJECT, repo)
    expect(walkFiles(result.tree)).not.toContain('src/a.ts')
  })

  it('returns an empty set when nothing is missed', () => {
    const covered = [
      fileNode('f:b', 'repo', 'src/b.ts'),
      fileNode('f:c', 'repo', 'src/deep/c.ts'),
      fileNode('f:md', 'repo', 'README.md'),
    ]
    store.upsertNodes(covered)
    const result = missedGraph(store, PROJECT, repo)
    expect(result.totalMissed).toBe(0)
    expect(result.tree).toEqual([])
  })

  it('flattens the missed files list sorted by path', () => {
    const result = missedGraph(store, PROJECT, repo)
    expect(result.files.map(file => file.path)).toEqual(['README.md', 'src/b.ts', 'src/deep/c.ts'])
  })

  it('raises ProjectNotFoundError for an unknown project', () => {
    expect(() => missedGraph(store, 'ghost', repo)).toThrow(ProjectNotFoundError)
  })
})

function walkFiles(tree: readonly MissedDir[]): string[] {
  const paths: string[] = []
  for (const entry of tree) {
    for (const file of entry.files) paths.push(file.path)
    paths.push(...walkFiles(entry.subdirs))
  }
  return paths
}