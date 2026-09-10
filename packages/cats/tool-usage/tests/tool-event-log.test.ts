import { describe, expect, it } from 'vitest'
import { sanitizeToolEventSummary, ToolEventLog, UPDATE_SUMMARY_TAIL_WINDOW } from '../src/ToolEventLog.ts'
import type { ToolEvent } from '../src/event-log-types.ts'
import { InMemorySortedSetStore } from '../src/store.ts'

function makeEvent(overrides: Partial<ToolEvent> & { toolName?: string; summary?: Record<string, unknown> }): ToolEvent {
  return {
    invocationId: 'inv-1',
    sessionId: 'sess-1',
    threadId: 'thread-1',
    catId: 'cat-1',
    toolName: 'Bash',
    timestamp: 1_700_000_000_000,
    turnIndex: 0,
    status: 'success',
    summary: { command: 'echo hi' },
    ...overrides,
  } as ToolEvent
}

describe('ToolEventLog.append/read', () => {
  it('round-trips events ordered by append sequence', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    await log.append(makeEvent({ timestamp: 5 }))
    await log.append(makeEvent({ timestamp: 3 }))
    await log.append(makeEvent({ timestamp: 4 }))
    const events = await log.readByThread('thread-1')
    // score = INCR seq, so insertion order regardless of timestamps
    expect(events.map((e) => e.timestamp)).toEqual([5, 3, 4])
  })

  it('readRecentByThread returns the newest N', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    for (let i = 0; i < 5; i++) await log.append(makeEvent({ timestamp: i }))
    const recent = await log.readRecentByThread('thread-1', 2)
    expect(recent.map((e) => e.timestamp)).toEqual([3, 4])
  })

  it('listThreadIds discovers owners and skips :seq siblings', async () => {
    const store = new InMemorySortedSetStore()
    const log = new ToolEventLog(store)
    await log.append(makeEvent({ threadId: 'a' }))
    await log.append(makeEvent({ threadId: 'b' }))
    await log.append(makeEvent({ threadId: 'a' }))
    expect((await log.listThreadIds()).sort()).toEqual(['a', 'b'])
  })
})

describe('ToolEventLog.updateSummary', () => {
  it('merges by exact toolUseId', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    await log.append(makeEvent({ summary: { _toolUseId: 'tu-1', resultCount: 1 } }))
    await log.append(makeEvent({ summary: { command: 'echo hi' } }))
    const ok = await log.updateSummary('thread-1', { toolUseId: 'tu-1' }, { resultStatus: 'counted' })
    expect(ok).toBe(true)
    const events = await log.readByThread('thread-1')
    expect(events[0]?.summary).toMatchObject({ _toolUseId: 'tu-1', resultStatus: 'counted', _resultMerged: true })
    expect(events[1]?.summary).toEqual({ command: 'echo hi' })
  })

  it('merges oldest-unmatched FIFO when no toolUseId', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    await log.append(makeEvent({ invocationId: 'inv-1', toolName: 'search_evidence' as never, summary: {} }))
    await log.append(makeEvent({ invocationId: 'inv-2', toolName: 'search_evidence' as never, summary: {} }))
    expect(await log.updateSummary('thread-1', { toolName: 'search_evidence', catId: 'cat-1' }, { resultCount: 3 })).toBe(
      true,
    )
    // second update should target the second (still unmatched) event, not the first
    expect(await log.updateSummary('thread-1', { toolName: 'search_evidence' }, { resultCount: 9 })).toBe(true)
    const events = await log.readByThread('thread-1')
    expect(events.map((e) => (e.summary as { resultCount?: number }).resultCount)).toEqual([3, 9])
  })

  it('returns false when no event matches', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    await log.append(makeEvent({ summary: {} }))
    expect(await log.updateSummary('thread-1', { toolUseId: 'missing' }, { x: 1 })).toBe(false)
  })

  it('is a no-op (true) when the merge is identical (idempotent retry guard)', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    await log.append(makeEvent({ summary: { _toolUseId: 'tu-2' } }))
    expect(await log.updateSummary('thread-1', { toolUseId: 'tu-2' }, { resultCount: 1 })).toBe(true)
  })
})

describe('ToolEventLog.getAllSequencesAfterTool / analyzeNudgeFollowup', () => {
  it('counts same-cat follow-ups within maxTurns', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    await log.append(makeEvent({ threadId: 't', catId: 'a', toolName: 'search_evidence', summary: {} }))
    await log.append(makeEvent({ threadId: 't', catId: 'b', toolName: 'grep', summary: {} }))
    await log.append(makeEvent({ threadId: 't', catId: 'a', toolName: 'graph_resolve', summary: {} }))
    const seqs = await log.getAllSequencesAfterTool('t', 'search_evidence', 5)
    expect(seqs).toHaveLength(1)
    expect(seqs[0]!.map((e) => e.catId)).toEqual(['a'])
  })

  it('detects nudge followed by memory tools and grep fallback', async () => {
    const log = new ToolEventLog(new InMemorySortedSetStore())
    // thread t1: nudge followed by graph_resolve
    await log.append(makeEvent({ invocationId: 'i1', threadId: 't1', catId: 'a', toolName: 'search_evidence', summary: { nudgeEmitted: true, resultCount: 3 } }))
    await log.append(makeEvent({ invocationId: 'i2', threadId: 't1', catId: 'a', toolName: 'graph_resolve', summary: {} }))
    // thread t2: nudge ignored in favor of Bash grep fallback
    await log.append(makeEvent({ invocationId: 'i3', threadId: 't2', catId: 'a', toolName: 'search_evidence', summary: { nudgeEmitted: true, resultCount: 0 } }))
    await log.append(makeEvent({ invocationId: 'i4', threadId: 't2', catId: 'a', toolName: 'Bash', summary: { command: 'grep foo' } }))
    const analysis = await log.analyzeNudgeFollowup('t1', 5)
    const analysis2 = await log.analyzeNudgeFollowup('t2', 5)
    expect(analysis[0]).toMatchObject({ followed: true, followupTool: 'graph_resolve', fallbackGrepDetected: false })
    expect(analysis2[0]).toMatchObject({ followed: false, followupTool: null, fallbackGrepDetected: true })
  })
})

describe('sanitizeToolEventSummary', () => {
  it('truncates oversized strings and marks _truncated', () => {
    const big = 'x'.repeat(2000)
    const out = sanitizeToolEventSummary({ note: big })
    expect((out?.note as string).length).toBe(1000)
    expect(out?._truncated).toBe(true)
  })

  it('keeps structural arrays intact when within budget', () => {
    const out = sanitizeToolEventSummary({ _f200Candidates: [{ anchor: 'a', rank: 0 }] })
    expect(Array.isArray(out?._f200Candidates)).toBe(true)
    expect(out).toEqual({ _f200Candidates: [{ anchor: 'a', rank: 0 }] })
  })

  it('preserves sentinel keys verbatim', () => {
    const out = sanitizeToolEventSummary({ _toolUseId: 'tu', _resultMerged: true, _truncated: true })
    expect(out).toEqual({ _toolUseId: 'tu', _resultMerged: true, _truncated: true })
  })

  it('returns undefined for undefined input', () => {
    expect(sanitizeToolEventSummary(undefined)).toBeUndefined()
  })
})

describe('ToolEventLog constants', () => {
  it('exposes bounded windows for hot-path reads', () => {
    expect(UPDATE_SUMMARY_TAIL_WINDOW).toBe(200)
  })
})