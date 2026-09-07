/**
 * Discovery + structural indexer suite (EP-CB0, T1.10) — real fixture
 * micro-repository (tests/fixtures/mini-repo) and a real temp-dir store.
 *
 * Pins: default exclusion rules firing (out/ is by-design excluded), the
 * Project → Folder → File node/edge tree, module detection on package
 * markers, mode filtering (full vs moderate), index metadata and the
 * coverage honesty contract (skipped reporting on oversize files).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, discoverFiles, indexRepository } from '../src/index.ts'
import type { IndexResult } from '../src/index.ts'

const fixturesRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
const miniRepo = join(fixturesRoot, 'mini-repo')

let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-index-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function indexFixture(options: { mode?: 'full' | 'moderate' | 'fast'; maxFileBytes?: number } = {}): IndexResult {
  return indexRepository({
    repoPath: miniRepo,
    store,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
  })
}

describe('discoverFiles', () => {
  it('walks the fixture tree and applies default directory exclusions', () => {
    const result = discoverFiles(miniRepo)
    expect(result.files.map(file => file.relativePath).sort()).toEqual([
      'README.md',
      'docs/guide.md',
      'package.json',
      'src/index.ts',
      'src/utils/helper.ts',
    ])
    expect(result.excluded).toContain('out')
    expect(result.excluded).toContain('node_modules')
    expect(result.excluded).toContain('.git')
    for (const file of result.files) {
      expect(file.sizeBytes).toBeGreaterThan(0)
      expect(file.absolutePath.endsWith(file.relativePath.split('/').pop() as string)).toBe(true)
    }
  })

  it('honors caller-provided extra exclusion patterns', () => {
    const result = discoverFiles(miniRepo, { exclude: ['docs'] })
    expect(result.files.map(file => file.relativePath).sort()).toEqual([
      'README.md',
      'package.json',
      'src/index.ts',
      'src/utils/helper.ts',
    ])
    expect(result.excluded).toContain('docs')
  })
})

describe('indexRepository — full mode', () => {
  let result: IndexResult

  beforeEach(() => {
    result = indexFixture({ mode: 'full' })
  })

  it('derives the project name from the repository directory', () => {
    expect(result.project).toBe('mini-repo')
    expect(result.mode).toBe('full')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('indexes the complete structural tree (nodes, edges, files)', () => {
    expect(result.filesIndexed).toBe(5)
    expect(result.nodeCount).toBe(9)
    expect(result.edgeCount).toBe(8)
    const labels = store.schemaOverview('mini-repo').nodeLabels
    expect(labels).toEqual([
      { label: 'File', count: 5 },
      { label: 'Folder', count: 3 },
      { label: 'Project', count: 1 },
    ])
    const edgeTypes = store.schemaOverview('mini-repo').edgeTypes
    expect(edgeTypes).toEqual([
      { type: 'CONTAINS_FILE', count: 5 },
      { type: 'CONTAINS_FOLDER', count: 3 },
    ])
  })

  it('emits the Project → Folder → File containment tree', () => {
    const files = store.search({ project: 'mini-repo', label: 'File' }).rows
    expect(files.map(file => file.name).sort()).toEqual([
      'README.md',
      'docs/guide.md',
      'package.json',
      'src/index.ts',
      'src/utils/helper.ts',
    ])
    const srcFile = files.find(file => file.name === 'src/index.ts')
    expect(srcFile?.language).toBe('typescript')
    expect(srcFile?.lines).toBe(4)
    expect(srcFile?.sizeBytes).toBeGreaterThan(0)
    const guide = files.find(file => file.name === 'docs/guide.md')
    expect(guide?.language).toBe('markdown')
    const edges = store.edgesOf('mini-repo')
    expect(edges).toContainEqual({ project: 'mini-repo', source: 'p:mini-repo', target: 'd:mini-repo:src', type: 'CONTAINS_FOLDER' })
    expect(edges).toContainEqual({ project: 'mini-repo', source: 'd:mini-repo:src', target: 'd:mini-repo:src/utils', type: 'CONTAINS_FOLDER' })
    expect(edges).toContainEqual({ project: 'mini-repo', source: 'd:mini-repo:src/utils', target: 'c:mini-repo:src/utils/helper.ts', type: 'CONTAINS_FILE' })
    expect(edges).toContainEqual({ project: 'mini-repo', source: 'p:mini-repo', target: 'c:mini-repo:package.json', type: 'CONTAINS_FILE' })
  })

  it('detects module boundaries on package markers', () => {
    const projectNode = store.search({ project: 'mini-repo', label: 'Project' }).rows[0]
    expect(projectNode?.props).toMatchObject({
      module: true,
      moduleKind: 'npm',
      moduleName: 'mini-repo',
      moduleVersion: '1.0.0',
    })
    const packageFile = store.search({ project: 'mini-repo', label: 'File', namePattern: 'package\\.json$' }).rows[0]
    expect(packageFile?.props).toMatchObject({ isPackageMarker: true, packageKind: 'npm' })
  })

  it('records index metadata and coverage (excluded by design, nothing skipped)', () => {
    const info = store.listProjects().find(entry => entry.name === 'mini-repo')
    expect(info?.lastMode).toBe('full')
    expect(info?.filesIndexed).toBe(5)
    expect(info?.lastIndexedAt).toBeDefined()
    expect(result.coverage.skipped).toEqual([])
    expect(result.coverage.parsePartial).toEqual([])
    expect(result.coverage.excluded).toContain('out')
  })

  it('re-indexes idempotently (delete + rebuild, counts stable)', () => {
    const second = indexFixture({ mode: 'full' })
    expect(second.nodeCount).toBe(result.nodeCount)
    expect(second.edgeCount).toBe(result.edgeCount)
    expect(store.search({ project: 'mini-repo', label: 'File' }).total).toBe(5)
  })
})

describe('indexRepository — mode filtering', () => {
  it('moderate keeps only code extensions (markdown dropped)', () => {
    const result = indexFixture({ mode: 'moderate' })
    expect(result.filesIndexed).toBe(3)
    const names = store.search({ project: 'mini-repo', label: 'File' }).rows.map(file => file.name).sort()
    expect(names).toEqual(['package.json', 'src/index.ts', 'src/utils/helper.ts'])
  })
})

describe('indexRepository — coverage honesty contract', () => {
  it('reports oversize files as skipped, not silently dropped', () => {
    const result = indexFixture({ mode: 'full', maxFileBytes: 1 })
    expect(result.filesIndexed).toBe(0)
    expect(result.coverage.skipped.map(entry => entry.path).sort()).toEqual([
      'README.md',
      'docs/guide.md',
      'package.json',
      'src/index.ts',
      'src/utils/helper.ts',
    ])
    for (const entry of result.coverage.skipped) {
      expect(entry.reason).toContain('字节行数统计上限')
    }
  })

  it('supports project name override', () => {
    const result = indexRepository({ repoPath: miniRepo, store, projectName: 'custom-name' })
    expect(result.project).toBe('custom-name')
    expect(store.search({ project: 'custom-name', label: 'File' }).total).toBe(5)
  })
})
