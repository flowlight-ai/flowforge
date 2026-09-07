/**
 * ff_codebase CLI end-to-end suite (EP-CB0, T1.10).
 *
 * Spawns the real bin entry (bin/ff_codebase.mjs, tsx direct-run) against a
 * throwaway copy of the fixture micro-repository — the exit codes asserted
 * here are the contract mgr and CI rely on: 0 ok / 1 violation (project not
 * found) / 2 usage error.
 */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const ffCodebase = join(pkgRoot, 'bin', 'ff_codebase.mjs')
const miniRepoFixture = join(pkgRoot, 'tests', 'fixtures', 'mini-repo')

let workspace: string
let repo: string

interface RunResult {
  status: number
  out: string
  err: string
}

function run(args: readonly string[]): RunResult {
  const child = spawnSync(process.execPath, [ffCodebase, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: child.status ?? -1, out: child.stdout ?? '', err: child.stderr ?? '' }
}

function json<T>(result: RunResult): T {
  return JSON.parse(result.out) as T
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ff-codebase-cli-'))
  repo = join(workspace, 'mini-repo')
  cpSync(miniRepoFixture, repo, { recursive: true })
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('index → query → schema → status 闭环', () => {
  it('index exits 0 with the structural + symbol summary and coverage report', () => {
    const result = run(['index', '--repo', repo])
    expect(result.status).toBe(0)
    const payload = json<{
      project: string
      mode: string
      filesIndexed: number
      nodeCount: number
      edgeCount: number
      symbolCount: number
      coverage: { excluded: string[]; skipped: { path: string }[]; parsePartial: { path: string }[] }
    }>(result)
    expect(payload.project).toBe('mini-repo')
    expect(payload.mode).toBe('full')
    expect(payload.filesIndexed).toBe(7)
    expect(payload.nodeCount).toBe(26)
    expect(payload.edgeCount).toBe(33)
    expect(payload.symbolCount).toBe(14)
    expect(payload.coverage.excluded).toContain('out')
    expect(payload.coverage.excluded).toContain('.flowforge')
    expect(payload.coverage.skipped).toEqual([])
    expect(payload.coverage.parsePartial.map(entry => entry.path)).toEqual(['symbols/broken.ts'])
  })

  it('query paginates File nodes with the total/hasMore contract', () => {
    const result = run(['query', '--repo', repo, '--label', 'File', '--limit', '2'])
    expect(result.status).toBe(0)
    const payload = json<{ rows: unknown[]; total: number; hasMore: boolean }>(result)
    expect(payload.rows).toHaveLength(2)
    expect(payload.total).toBe(7)
    expect(payload.hasMore).toBe(true)
  })

  it('query applies name-pattern filters', () => {
    const result = run(['query', '--repo', repo, '--label', 'File', '--name-pattern', '^src/'])
    expect(result.status).toBe(0)
    const payload = json<{ total: number }>(result)
    expect(payload.total).toBe(2)
  })

  it('schema reports label and edge type counts', () => {
    const result = run(['schema', '--repo', repo])
    expect(result.status).toBe(0)
    const payload = json<{ nodeLabels: { label: string; count: number }[]; edgeTypes: { type: string; count: number }[] }>(result)
    expect(payload.nodeLabels).toContainEqual({ label: 'File', count: 7 })
    expect(payload.nodeLabels).toContainEqual({ label: 'Function', count: 3 })
    expect(payload.nodeLabels).toContainEqual({ label: 'Class', count: 2 })
    expect(payload.edgeTypes).toContainEqual({ type: 'CONTAINS_FILE', count: 7 })
    expect(payload.edgeTypes).toContainEqual({ type: 'CONTAINS_FOLDER', count: 4 })
    expect(payload.edgeTypes).toContainEqual({ type: 'DEFINES', count: 14 })
    expect(payload.edgeTypes).toContainEqual({ type: 'DEFINES_METHOD', count: 3 })
  })

  it('status reports the persisted index metadata', () => {
    const result = run(['status', '--repo', repo])
    expect(result.status).toBe(0)
    const payload = json<{ project: { name: string; filesIndexed: number; lastMode: string }; nodeCount: number; edgeCount: number; symbolCount: number }[]>(result)
    expect(payload).toHaveLength(1)
    expect(payload[0]?.project.name).toBe('mini-repo')
    expect(payload[0]?.project.filesIndexed).toBe(7)
    expect(payload[0]?.project.lastMode).toBe('full')
    expect(payload[0]?.nodeCount).toBe(26)
    expect(payload[0]?.edgeCount).toBe(33)
    expect(payload[0]?.symbolCount).toBe(14)
  })

  it('projects lists the registered project', () => {
    const result = run(['projects', '--repo', repo])
    expect(result.status).toBe(0)
    expect(json<{ name: string }[]>(result).map(info => info.name)).toEqual(['mini-repo'])
  })

  it('search on a query matching only File nodes returns the empty-with-note contract (noise filter)', () => {
    const result = run(['search', '--repo', repo, '--query', 'guide'])
    expect(result.status).toBe(0)
    const payload = json<{ rows: unknown[]; total: number; note?: string }>(result)
    expect(payload.total).toBe(0)
    expect(payload.rows).toEqual([])
    expect(payload.note).toContain('无匹配结果')
  })

  it('search returns symbol-level BM25 rows for a symbol-name query', () => {
    const result = run(['search', '--repo', repo, '--query', 'circle', '--limit', '10'])
    expect(result.status).toBe(0)
    const payload = json<{ rows: { name: string; label: string }[]; total: number }>(result)
    expect(payload.total).toBe(3)
    const names = payload.rows.map(row => row.name)
    expect(names).toContain('mini-repo.symbols.demo.Circle')
    expect(payload.rows.every(row => row.label !== 'File')).toBe(true)
  })

  it('outline prints the line-ordered symbol table of an indexed file', () => {
    const result = run(['outline', '--repo', repo, '--file', 'symbols/demo.ts'])
    expect(result.status).toBe(0)
    const payload = json<{ file: string; rows: { qn: string; name: string; label: string; lines: string }[]; total: number }>(result)
    expect(payload.file).toBe('symbols/demo.ts')
    expect(payload.total).toBe(10)
    const circle = payload.rows.find(row => row.name === 'Circle')
    expect(circle?.label).toBe('Class')
    expect(circle?.lines).toMatch(/^\d+-\d+$/)
    const startLines = payload.rows.map(row => Number(row.lines.split('-')[0]))
    expect(startLines).toEqual([...startLines].sort((a, b) => a - b))
  })

  it('snippet prints the resolved source slice for a qualified name', () => {
    const result = run(['snippet', '--repo', repo, '--qn', 'mini-repo.symbols.demo.render'])
    expect(result.status).toBe(0)
    const payload = json<{ kind: string; qualifiedName: string; label: string; filePath: string; startLine: number; endLine: number; source: string }>(result)
    expect(payload.kind).toBe('snippet')
    expect(payload.qualifiedName).toBe('mini-repo.symbols.demo.render')
    expect(payload.label).toBe('Function')
    expect(payload.filePath).toBe('symbols/demo.ts')
    expect(payload.source).toContain("updateCloudClient('demo')")
  })
})

describe('退出码契约（0/1/2）', () => {
  it('delete removes the project and leaves status with exit 1', () => {
    expect(run(['delete', '--repo', repo, '--project', 'mini-repo']).status).toBe(0)
    const status = run(['status', '--repo', repo, '--project', 'mini-repo'])
    expect(status.status).toBe(1)
    expect(status.err).toContain('项目不存在')
    expect(run(['projects', '--repo', repo]).status).toBe(0)
  })

  it('rejects unknown commands with exit 2', () => {
    const result = run(['frobnicate'])
    expect(result.status).toBe(2)
    expect(result.err).toContain('未知命令')
  })

  it('rejects invalid index modes with exit 2', () => {
    const result = run(['index', '--repo', repo, '--mode', 'bogus'])
    expect(result.status).toBe(2)
    expect(result.err).toContain('未知索引模式')
  })

  it('rejects delete without --project with exit 2', () => {
    expect(run(['delete', '--repo', repo]).status).toBe(2)
  })

  it('rejects query against a never-indexed repo with exit 1', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ff-codebase-cli-empty-'))
    try {
      const result = run(['query', '--repo', fresh])
      expect(result.status).toBe(1)
      expect(result.err).toContain('先执行 ff_codebase index')
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('prints usage for help with exit 0', () => {
    const result = run(['help'])
    expect(result.status).toBe(0)
    expect(result.out).toContain('ff_codebase')
    expect(result.out).toContain('index')
  })
})
