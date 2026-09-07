/**
 * Contract suite: file outline + code snippet (EP-CB1, T2.4).
 *
 * Real node:sqlite store in a real temp directory with fixture sources on
 * disk (zero mocks). Pins the mcp.c get_file_outline / get_code_snippet
 * contract: line-ordered rows with pagination, three-tier QN resolution
 * (exact → unique suffix → ambiguous suggestions) and the not-found error.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, fileOutline, codeSnippet } from '../src/index.ts'
import type { NodeRecord } from '../src/index.ts'
import { ProjectNotFoundError, UsageError } from '../src/index.ts'

let dir: string
let store: CodebaseStore
const PROJECT = 'demo'
const REL = 'src/store.ts'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-outline-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject(PROJECT)
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function sym(qn: string, label: NodeRecord['label'], startLine: number, endLine: number): NodeRecord {
  return {
    id: `s:${PROJECT}:${qn}`,
    project: PROJECT,
    label,
    name: qn,
    filePath: REL,
    language: 'typescript',
    lines: endLine - startLine + 1,
    props: { shortName: qn.split('.').pop() ?? qn, startLine, endLine },
  }
}

describe('fileOutline（get_file_outline 移植）', () => {
  it('returns line-ordered rows with the pagination contract', () => {
    store.upsertNodes([
      sym('demo.src.store.run', 'Function', 12, 30),
      sym('demo.src.store.Store', 'Class', 2, 40),
      sym('demo.src.store.Store.save', 'Method', 15, 20),
    ])
    const result = fileOutline(store, PROJECT, REL, {})
    expect(result.rows.map(row => row.qn)).toEqual([
      'demo.src.store.Store',
      'demo.src.store.run',
      'demo.src.store.Store.save',
    ])
    expect(result.rows[0]).toMatchObject({ name: 'Store', label: 'Class', lines: '2-40' })
    expect(result.total).toBe(3)
    expect(result.returned).toBe(3)
    expect(result.hasMore).toBe(false)

    const page = fileOutline(store, PROJECT, REL, { limit: 2, offset: 2 })
    expect(page.rows.map(row => row.qn)).toEqual(['demo.src.store.Store.save'])
    expect(page.total).toBe(3)
    expect(page.returned).toBe(1)
    expect(page.hasMore).toBe(false)
  })

  it('validates limit/offset ranges and unknown labels', () => {
    expect(() => fileOutline(store, PROJECT, REL, { limit: 0 })).toThrow(UsageError)
    expect(() => fileOutline(store, PROJECT, REL, { limit: 201 })).toThrow(UsageError)
    expect(() => fileOutline(store, PROJECT, REL, { offset: -1 })).toThrow(UsageError)
    expect(() => fileOutline(store, PROJECT, REL, { labels: ['NotALabel'] })).toThrow(UsageError)
    expect(() => fileOutline(store, 'ghost', REL, {})).toThrow(ProjectNotFoundError)
  })
})

describe('codeSnippet（get_code_snippet 移植）', () => {
  beforeEach(() => {
    const lines = [
      'export class Store {',
      '  save(): void {',
      '    this.flush()',
      '  }',
      '}',
      '',
      'export function run(): void {',
      '  helper()',
      '}',
    ]
    writeFileSync(join(dir, REL), `${lines.join('\n')}\n`, 'utf8')
    store.upsertNodes([
      sym('demo.src.store.Store', 'Class', 1, 5),
      sym('demo.src.store.run', 'Function', 7, 9),
    ])
  })

  it('resolves an exact QN and returns the sliced source with its line span', () => {
    const result = codeSnippet(store, PROJECT, 'demo.src.store.run', { repoPath: dir })
    expect(result.kind).toBe('snippet')
    if (result.kind !== 'snippet') throw new Error('unreachable')
    expect(result.qualifiedName).toBe('demo.src.store.run')
    expect(result.label).toBe('Function')
    expect(result.startLine).toBe(7)
    expect(result.endLine).toBe(9)
    expect(result.source).toContain('export function run(): void {')
    expect(result.source).toContain('helper()')
    expect(result.source).not.toContain('export class Store {')
    expect(result.matchMethod).toBeUndefined()
  })

  it('resolves a unique suffix with match_method=suffix', () => {
    const result = codeSnippet(store, PROJECT, 'run', { repoPath: dir })
    expect(result.kind).toBe('snippet')
    if (result.kind !== 'snippet') throw new Error('unreachable')
    expect(result.qualifiedName).toBe('demo.src.store.run')
    expect(result.matchMethod).toBe('suffix')
  })

  it('expands the window by ±5 context lines with includeNeighbors', () => {
    const result = codeSnippet(store, PROJECT, 'demo.src.store.Store', { repoPath: dir, includeNeighbors: true })
    expect(result.kind).toBe('snippet')
    if (result.kind !== 'snippet') throw new Error('unreachable')
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBeGreaterThanOrEqual(5)
    expect(result.source).toContain('export function run(): void {')
  })

  it('returns the disambiguation list when the suffix matches several symbols', () => {
    store.upsertNodes([sym('demo.lib.util.run', 'Function', 1, 3)])
    const result = codeSnippet(store, PROJECT, 'run', { repoPath: dir })
    expect(result.kind).toBe('ambiguous')
    if (result.kind !== 'ambiguous') throw new Error('unreachable')
    expect(result.suggestions.map(item => item.qn).sort()).toEqual(['demo.lib.util.run', 'demo.src.store.run'])
  })

  it('throws SymbolNotFoundError for an unknown name', () => {
    expect(() => codeSnippet(store, PROJECT, 'demo.src.store.ghost', { repoPath: dir })).toThrow(
      '未找到符号 demo.src.store.ghost',
    )
    expect(() => codeSnippet(store, 'ghost', 'demo.src.store.run', { repoPath: dir })).toThrow(ProjectNotFoundError)
  })
})
