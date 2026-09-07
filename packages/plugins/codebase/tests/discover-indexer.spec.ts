/**
 * Discovery + structural/symbol indexer suite (EP-CB0 T1.10, EP-CB1 T2.4b)
 * — real fixture micro-repository (tests/fixtures/mini-repo) and a real
 * temp-dir store.
 *
 * Pins: default exclusion rules firing (out/ is by-design excluded), the
 * Project → Folder → File node/edge tree, module detection on package
 * markers, mode filtering (full vs moderate), index metadata, the coverage
 * honesty contract (skipped on oversize files, parsePartial on ERROR
 * trees), and the symbol-layer invariants (Function/Class labels minted,
 * DEFINES/DEFINES_METHOD edges, non-symbol languages excluded).
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

async function indexFixture(options: { mode?: 'full' | 'moderate' | 'fast'; maxFileBytes?: number } = {}): Promise<IndexResult> {
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
      'symbols/broken.ts',
      'symbols/demo.ts',
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
      'symbols/broken.ts',
      'symbols/demo.ts',
    ])
    expect(result.excluded).toContain('docs')
  })
})

describe('indexRepository — full mode', () => {
  let result: IndexResult

  beforeEach(async () => {
    result = await indexFixture({ mode: 'full' })
  })

  it('derives the project name from the repository directory', () => {
    expect(result.project).toBe('mini-repo')
    expect(result.mode).toBe('full')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('indexes the complete structural tree (nodes, edges, files)', () => {
    expect(result.filesIndexed).toBe(7)
    expect(result.nodeCount).toBe(26)
    expect(result.edgeCount).toBe(33)
    const labels = store.schemaOverview('mini-repo').nodeLabels
    expect(labels).toEqual(expect.arrayContaining([
      { label: 'File', count: 7 },
      { label: 'Folder', count: 4 },
      { label: 'Project', count: 1 },
    ]))
    const edgeTypes = store.schemaOverview('mini-repo').edgeTypes
    expect(edgeTypes).toEqual(expect.arrayContaining([
      { type: 'CONTAINS_FILE', count: 7 },
      { type: 'CONTAINS_FOLDER', count: 4 },
    ]))
  })

  it('emits the Project → Folder → File containment tree', () => {
    const files = store.search({ project: 'mini-repo', label: 'File' }).rows
    expect(files.map(file => file.name).sort()).toEqual([
      'README.md',
      'docs/guide.md',
      'package.json',
      'src/index.ts',
      'src/utils/helper.ts',
      'symbols/broken.ts',
      'symbols/demo.ts',
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
    expect(edges).toContainEqual({ project: 'mini-repo', source: 'p:mini-repo', target: 'd:mini-repo:symbols', type: 'CONTAINS_FOLDER' })
    expect(edges).toContainEqual({ project: 'mini-repo', source: 'd:mini-repo:symbols', target: 'c:mini-repo:symbols/demo.ts', type: 'CONTAINS_FILE' })
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
    expect(info?.filesIndexed).toBe(7)
    expect(info?.lastIndexedAt).toBeDefined()
    expect(result.coverage.skipped).toEqual([])
    expect(result.coverage.excluded).toContain('out')
  })

  it('re-indexes idempotently (delete + rebuild, counts stable)', async () => {
    const second = await indexFixture({ mode: 'full' })
    expect(second.nodeCount).toBe(result.nodeCount)
    expect(second.edgeCount).toBe(result.edgeCount)
    expect(second.symbolCount).toBe(result.symbolCount)
    expect(store.search({ project: 'mini-repo', label: 'File' }).total).toBe(7)
  })
})

describe('indexRepository — symbol layer (EP-CB1)', () => {
  let result: IndexResult

  beforeEach(async () => {
    result = await indexFixture({ mode: 'full' })
  })

  it('mints symbol nodes with Function/Class label counts in schema', () => {
    expect(result.symbolCount).toBe(14)
    const labels = store.schemaOverview('mini-repo').nodeLabels
    expect(labels).toEqual(expect.arrayContaining([
      { label: 'Function', count: 3 },
      { label: 'Method', count: 3 },
      { label: 'Class', count: 2 },
      { label: 'Interface', count: 1 },
      { label: 'Enum', count: 1 },
      { label: 'Type', count: 1 },
      { label: 'Variable', count: 3 },
    ]))
  })

  it('emits DEFINES and DEFINES_METHOD edges from File/Class to symbols', () => {
    const edges = store.edgesOf('mini-repo')
    expect(edges).toContainEqual({
      project: 'mini-repo',
      source: 'c:mini-repo:symbols/demo.ts',
      target: 's:mini-repo:mini-repo.symbols.demo.Circle',
      type: 'DEFINES',
    })
    expect(edges).toContainEqual({
      project: 'mini-repo',
      source: 's:mini-repo:mini-repo.symbols.demo.Circle',
      target: 's:mini-repo:mini-repo.symbols.demo.Circle.area',
      type: 'DEFINES_METHOD',
    })
    expect(edges).toContainEqual({
      project: 'mini-repo',
      source: 's:mini-repo:mini-repo.symbols.demo.render',
      target: 's:mini-repo:mini-repo.src.utils.helper.updateCloudClient',
      type: 'CALLS',
    })
    expect(edges).toContainEqual({
      project: 'mini-repo',
      source: 's:mini-repo:mini-repo.symbols.demo.Circle',
      target: 's:mini-repo:mini-repo.src.utils.helper.HelperRegistry',
      type: 'INHERITS',
    })
    expect(edges).toContainEqual({
      project: 'mini-repo',
      source: 's:mini-repo:mini-repo.symbols.demo.Circle',
      target: 's:mini-repo:mini-repo.symbols.demo.Shape',
      type: 'IMPLEMENTS',
    })
  })

  it('reports syntactically broken files through coverage.parsePartial', () => {
    expect(result.coverage.parsePartial).toEqual([
      { path: 'symbols/broken.ts', reason: expect.stringContaining('语法错误') },
    ])
    // Partial parse still yields honest symbol material: the broken file's
    // leading function remains indexed while coverage flags the tree.
    expect(result.symbolCount).toBeGreaterThan(0)
  })

  it('keeps non-symbol languages (.md) out of the symbol layer', () => {
    const markdown = store.search({ project: 'mini-repo', label: 'File', namePattern: '\\.md$' }).rows
    expect(markdown.length).toBeGreaterThan(0)
    for (const file of markdown) {
      const defines = store.edgesOf('mini-repo').filter(edge =>
        edge.type === 'DEFINES' && edge.source === `c:mini-repo:${file.name}`)
      expect(defines).toEqual([])
    }
  })
})

describe('indexRepository — mode filtering', () => {
  it('moderate keeps only code extensions (markdown dropped)', async () => {
    const result = await indexFixture({ mode: 'moderate' })
    expect(result.filesIndexed).toBe(5)
    const names = store.search({ project: 'mini-repo', label: 'File' }).rows.map(file => file.name).sort()
    expect(names).toEqual(['package.json', 'src/index.ts', 'src/utils/helper.ts', 'symbols/broken.ts', 'symbols/demo.ts'])
  })
})

describe('indexRepository — coverage honesty contract', () => {
  it('reports oversize files as skipped, not silently dropped', async () => {
    const result = await indexFixture({ mode: 'full', maxFileBytes: 1 })
    expect(result.filesIndexed).toBe(0)
    expect(result.coverage.skipped.map(entry => entry.path).sort()).toEqual([
      'README.md',
      'docs/guide.md',
      'package.json',
      'src/index.ts',
      'src/utils/helper.ts',
      'symbols/broken.ts',
      'symbols/demo.ts',
    ])
    for (const entry of result.coverage.skipped) {
      expect(entry.reason).toContain('字节行数统计上限')
    }
  })

  it('supports project name override', async () => {
    const result = await indexRepository({ repoPath: miniRepo, store, projectName: 'custom-name' })
    expect(result.project).toBe('custom-name')
    expect(store.search({ project: 'custom-name', label: 'File' }).total).toBe(7)
  })
})
