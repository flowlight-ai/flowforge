/**
 * detect_changes contract suite (EP-CB2, T3.2b).
 *
 * Pure-Node mtime-based change detection. Uses a copy of the mini-repo fixture
 * seeded with explicit mtimes so the changed/added/removed classification is
 * deterministic and environment-independent.
 */

import { mkdtempSync, cpSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, detectChanges, indexRepository } from '../src/index.ts'
import { MINI_REPO } from './_fixture.ts'

// indexRepository derives the project name from the repo basename: dir/repo → 'repo'.
const PROJECT = 'repo'

describe('detectChanges', () => {
  let dir: string
  let repoPath: string
  let store: CodebaseStore

  // Far-future mtime guarantees it exceeds any `last_indexed_at` written during
  // indexing (baseline ≈ now), so changed/added fire deterministically.
  const FUTURE = Date.parse('2099-01-01T00:00:00Z')

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ff-codebase-changes-'))
    repoPath = join(dir, 'repo')
    cpSync(MINI_REPO, repoPath, { recursive: true })
    // Pin every file mtime to a past epoch so untouched files are never "changed".
    const fixed = Date.parse('2026-01-01T00:00:00Z')
    for (const rel of ['src/index.ts', 'src/utils/helper.ts', 'symbols/demo.ts', 'symbols/broken.ts', 'README.md']) {
      utimesSync(join(repoPath, rel.split('/').join('\\')), fixed / 1000, fixed / 1000)
    }
    store = new CodebaseStore(join(dir, 'codebase.db'))
    await indexRepository({ repoPath, store })
  })

  afterEach(() => {
    store.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports no changes when mtimes are at or before the index baseline', () => {
    const result = detectChanges(store, { project: PROJECT, repoPath })
    expect(result.changed).toEqual([])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.lastIndexedAt).toBeDefined()
  })

  it('classifies a touched file as changed', () => {
    touch(repoPath, 'symbols/demo.ts', FUTURE)
    const result = detectChanges(store, { project: PROJECT, repoPath })
    expect(result.changed).toContain('symbols/demo.ts')
  })

  it('classifies a removed indexed file as removed', () => {
    rmSync(join(repoPath, 'symbols', 'broken.ts'))
    const result = detectChanges(store, { project: PROJECT, repoPath })
    expect(result.removed).toContain('symbols/broken.ts')
  })

  it('classifies a brand-new on-disk file as added', () => {
    const newFile = join(repoPath, 'src', 'brand-new.ts')
    writeFileSync(newFile, 'export const x = 1\n')
    utimesSync(newFile, FUTURE / 1000, FUTURE / 1000)
    const result = detectChanges(store, { project: PROJECT, repoPath })
    expect(result.added).toContain('src/brand-new.ts')
  })

  it('throws ProjectNotFoundError for an unknown project', () => {
    expect(() => detectChanges(store, { project: 'ghost', repoPath })).toThrow()
  })
})

function touch(repoPath: string, rel: string, mtimeMs: number): void {
  utimesSync(join(repoPath, rel.split('/').join('\\')), mtimeMs / 1000, mtimeMs / 1000)
}