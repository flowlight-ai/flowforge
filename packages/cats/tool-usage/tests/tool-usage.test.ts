import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolUsageArchiver } from '../src/ToolUsageArchiver.ts'
import { InMemorySortedSetStore } from '../src/store.ts'
import { ToolUsageCounter, type ToolUsageEntry } from '../src/ToolUsageCounter.ts'

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tool-usage-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  for (const dir of tempDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('ToolUsageArchiver', () => {
  it('append + load round-trips entries', async () => {
    const dir = await tempDir()
    const archiver = new ToolUsageArchiver(join(dir, 'archive.jsonl'))
    const entry: ToolUsageEntry = { date: '2026-01-15', catId: 'opus', category: 'native', toolName: 'Read', count: 42 }
    expect(await archiver.archiveEntries([entry])).toBe(1)
    const loaded = await archiver.loadArchive()
    expect(loaded).toEqual([entry])
    expect(await archiver.getArchivedDates()).toEqual(new Set(['2026-01-15']))
  })

  it('skips malformed lines gracefully', async () => {
    const dir = await tempDir()
    const path = join(dir, 'archive.jsonl')
    await writeFile(path, '{"broken"\n{"date":"2026-01-15","catId":"a","category":"native","toolName":"Read","count":1}\n')
    const archiver = new ToolUsageArchiver(path)
    const loaded = await archiver.loadArchive()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.date).toBe('2026-01-15')
  })

  it('returns empty for a missing file', async () => {
    const dir = await tempDir()
    const archiver = new ToolUsageArchiver(join(dir, 'nope.jsonl'))
    expect(await archiver.loadArchive()).toEqual([])
  })
})

describe('ToolUsageCounter', () => {
  it('records and aggregates counts by category and tool', async () => {
    const store = new InMemorySortedSetStore()
    const counter = new ToolUsageCounter(store)
    counter.recordToolUse('opus', 'mcp:cat-cafe/search_evidence')
    counter.recordToolUse('opus', 'mcp:cat-cafe/search_evidence')
    counter.recordToolUse('opus', 'Read')
    counter.recordToolUse('opus', 'Skill', { skill: 'memory-navigator' })
    // flush promise chain
    await new Promise((r) => setTimeout(r, 5))
    const report = await counter.aggregate(90)
    expect(report.summary.totalCalls).toBe(4)
    expect(report.summary.byCategory.mcp).toBe(2)
    expect(report.summary.byCategory.native).toBe(1)
    expect(report.summary.byCategory.skill).toBe(1)
  })

  it('applies catId and category filters', async () => {
    const store = new InMemorySortedSetStore()
    const counter = new ToolUsageCounter(store)
    counter.recordToolUse('opus', 'Read')
    counter.recordToolUse('opus', 'Write')
    counter.recordToolUse('mini', 'Read')
    await new Promise((r) => setTimeout(r, 5))
    const forOpus = await counter.aggregate(90, { catId: 'opus' })
    expect(forOpus.summary.totalCalls).toBe(2)
    const onlyNative = await counter.aggregate(90, { category: 'native' })
    expect(onlyNative.summary.totalCalls).toBe(3)
  })

  it('filters the aggregated today count to the requested window', async () => {
    const store = new InMemorySortedSetStore()
    const counter = new ToolUsageCounter(store)
    counter.recordToolUse('opus', 'Read')
    await new Promise((r) => setTimeout(r, 5))
    const report = await counter.aggregate(0)
    expect(report.summary.totalCalls).toBe(1)
    expect(report.daily[0]?.native).toBe(1)
  })

  it('merges archive with redis dedup on all-time queries', async () => {
    const dir = await tempDir()
    const archiver = new ToolUsageArchiver(join(dir, 'archive.jsonl'))
    const store = new InMemorySortedSetStore()
    const counter = new ToolUsageCounter(store, archiver)
    // archive a date far in the past (before TTL window)
    await archiver.archiveEntries([
      { date: '2020-01-01', catId: 'opus', category: 'native', toolName: 'Read', count: 7 },
    ])
    counter.recordToolUse('opus', 'Read')
    await new Promise((r) => setTimeout(r, 5))
    const report = await counter.aggregate(0)
    expect(report.summary.totalCalls).toBeGreaterThanOrEqual(8)
  })
})