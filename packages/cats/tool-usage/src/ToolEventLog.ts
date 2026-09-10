/**
 * ToolEventLog — F188 Phase F (AC-F10)
 *
 * Append-only event log per thread over an injected SortedSetStore. Bypasses
 * TranscriptWriter toolName Set dedup and ToolUsageCounter aggregation —
 * preserves full sequence for FM-1/FM-2/FM-5 computation.
 */

import { TOOL_EVENT_LOG_TTL_SECONDS, toolEventLogKey } from './redis-keys.ts'
import { createModuleLogger } from './logger.ts'
import type { NudgeFollowupAnalysis, ToolEvent } from './event-log-types.ts'
import type { SortedSetStore } from './store.ts'

const log = createModuleLogger('tool-event-log')

/** Tools that count as "nudge followed" — caller used the recommended entry. */
const NUDGE_FOLLOWUP_TOOLS = new Set(['graph_resolve', 'list_recent'])

/** Substrings that indicate a Bash grep / rg / find fallback. */
const GREP_FALLBACK_PATTERNS = ['grep', 'rg ', 'ripgrep', 'find ', 'find\t']

/**
 * Bounded growth guards (ported from clowder TD 2026-08-12): one thread key
 * reached 12,887 events / 221MB because raw toolInput was wired into summary
 * with no cap. Keep sequence + prefix features, never full payloads.
 */
const SUMMARY_FIELD_CHAR_CAP = 1000
/** Structural arrays get a larger budget and element-wise truncation (kept arrays). */
const SUMMARY_ARRAY_FIELD_CHAR_CAP = 4000
const SUMMARY_TOTAL_CHAR_CAP = 8000
/** Matching/merge sentinels — always preserved verbatim (FIFO merge depends on them). */
const SUMMARY_SENTINEL_KEYS = new Set(['_toolUseId', '_resultMerged', '_truncated'])
const DEFAULT_MAX_EVENTS_PER_THREAD = 2000

function safeStringifyLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 16
  } catch {
    return 16
  }
}

/** Round-end recall correlation (F200) only correlates the just-completed round. */
export const RECALL_CORRELATION_EVENT_WINDOW = 200

/**
 * updateSummary runs a tail-bounded zrange; results arriving >this window
 * behind belong to no live round.
 */
export const UPDATE_SUMMARY_TAIL_WINDOW = 200

/**
 * Cap summary payloads at the storage boundary. TYPE-PRESERVING: truncation
 * must never change a field's JS type (string → prefix slice; array →
 * element-wise prefix, stays an array; plain object → `{}`; scalars pass
 * through). Marked with `_truncated: true`.
 */
export function sanitizeToolEventSummary(
  summary: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!summary) return summary
  const out: Record<string, unknown> = {}
  let budget = SUMMARY_TOTAL_CHAR_CAP
  let truncated = false
  for (const [key, value] of Object.entries(summary)) {
    if (SUMMARY_SENTINEL_KEYS.has(key)) {
      out[key] = value
      continue
    }
    let kept = value
    let cost: number
    if (typeof value === 'string') {
      cost = value.length
      if (cost > SUMMARY_FIELD_CHAR_CAP) {
        kept = value.slice(0, SUMMARY_FIELD_CHAR_CAP)
        cost = SUMMARY_FIELD_CHAR_CAP
        truncated = true
      }
    } else if (Array.isArray(value)) {
      cost = safeStringifyLength(value)
      if (cost > SUMMARY_ARRAY_FIELD_CHAR_CAP) {
        const prefix: unknown[] = []
        let used = 2 // '[]'
        for (const element of value) {
          const elementCost = safeStringifyLength(element) + 1
          if (used + elementCost > SUMMARY_ARRAY_FIELD_CHAR_CAP) break
          prefix.push(element)
          used += elementCost
        }
        kept = prefix
        cost = used
        truncated = true
      }
    } else if (typeof value === 'object' && value !== null) {
      cost = safeStringifyLength(value)
      if (cost > SUMMARY_FIELD_CHAR_CAP) {
        kept = {}
        cost = 2
        truncated = true
      }
    } else {
      // number/boolean/null/undefined — never oversized.
      cost = safeStringifyLength(value)
    }
    if (cost > budget) {
      truncated = true
      continue
    }
    out[key] = kept
    budget -= cost
  }
  if (truncated) out._truncated = true
  return out
}

export class ToolEventLog {
  /**
   * Per-thread serialization queue for updateSummary — concurrent fire-and-forget
   * calls must not race on the same zrange snapshot.
   */
  private readonly updateChain = new Map<string, Promise<unknown>>()

  private readonly maxEventsPerThread: number

  constructor(
    private readonly store: SortedSetStore,
    options?: { maxEventsPerThread?: number },
  ) {
    this.maxEventsPerThread = options?.maxEventsPerThread ?? DEFAULT_MAX_EVENTS_PER_THREAD
  }

  /** Append a tool event. Errors logged, never thrown. Stable sequence via per-thread INCR. */
  async append(event: ToolEvent): Promise<void> {
    const key = toolEventLogKey(event.threadId)
    const seqKey = `${key}:seq`
    let seq: number | null = null
    try {
      seq = await this.store.incr(seqKey)
    } catch {
      seq = null
    }
    // Score = sequenceId (10 digits) gives strict monotonicity within a thread.
    // Fallback (no INCR): timestamp + turnIndex * 1e-6 tie-break.
    const score = seq != null ? seq : event.timestamp + (event.turnIndex ?? 0) * 1e-6
    const sanitized =
      'summary' in event && event.summary
        ? ({ ...event, summary: sanitizeToolEventSummary(event.summary as Record<string, unknown>) } as ToolEvent)
        : event
    const member = JSON.stringify(sanitized)

    try {
      const added = await this.store.zadd(key, score, member)
      if (added > 0) {
        await this.store.expire(key, TOOL_EVENT_LOG_TTL_SECONDS).catch(noop)
        await this.store.expire(seqKey, TOOL_EVENT_LOG_TTL_SECONDS).catch(noop)
        if (this.maxEventsPerThread > 0) {
          await this.store.zremrangebyrank(key, 0, -(this.maxEventsPerThread + 1)).catch(noop)
        }
      }
    } catch (err) {
      log.warn({ err, key, toolName: event.toolName }, 'Failed to append tool event')
    }
  }

  /** Read all events for a thread, ordered by timestamp ascending. */
  async readByThread(threadId: string): Promise<ToolEvent[]> {
    const key = toolEventLogKey(threadId)
    const members = await this.store.zrange(key, 0, -1)
    return members.map((m) => JSON.parse(m) as ToolEvent)
  }

  /** Bounded tail read for hot paths — only the current round's events. */
  async readRecentByThread(threadId: string, limit: number): Promise<ToolEvent[]> {
    if (limit <= 0) return []
    const key = toolEventLogKey(threadId)
    const members = await this.store.zrange(key, -limit, -1)
    return members.map((m) => JSON.parse(m) as ToolEvent)
  }

  /** Discover thread IDs that own a tool-event-log zset; filters the `:seq` sibling. */
  async listThreadIds(): Promise<string[]> {
    const keyPrefix = this.store.keyPrefix ?? ''
    const pattern = `${keyPrefix}tool-event-log:*`
    const collected = await this.store.scan(pattern)
    const threadIdSet = new Set<string>()
    for (const raw of collected) {
      const k = keyPrefix && raw.startsWith(keyPrefix) ? raw.slice(keyPrefix.length) : raw
      if (k.endsWith(':seq')) continue
      const m = /^tool-event-log:(.+)$/.exec(k)
      if (m?.[1]) threadIdSet.add(m[1])
    }
    return [...threadIdSet]
  }

  /**
   * Update an existing event's summary fields — result-side data arrives in
   * tool_result AFTER tool_use; merge back so aggregator can compute FM-2/FM-5.
   *
   * Match precedence: exact `toolUseId`, else oldest unmatched event with
   * matching toolName + catId (FIFO). `_resultMerged=true` marks merged events.
   * Read cost is tail-bounded (UPDATE_SUMMARY_TAIL_WINDOW); the exact path
   * falls back to one full scan on a window miss.
   */
  async updateSummary(
    threadId: string,
    matcher: { toolUseId?: string; toolName?: string; catId?: string },
    summaryPatch: Record<string, unknown>,
  ): Promise<boolean> {
    const prev = this.updateChain.get(threadId) ?? Promise.resolve()
    const next = prev.then(
      () => this._doUpdateSummary(threadId, matcher, summaryPatch),
      () => this._doUpdateSummary(threadId, matcher, summaryPatch),
    )
    this.updateChain.set(threadId, next)
    try {
      return await next
    } finally {
      if (this.updateChain.get(threadId) === next) {
        this.updateChain.delete(threadId)
      }
    }
  }

  private async _doUpdateSummary(
    threadId: string,
    matcher: { toolUseId?: string; toolName?: string; catId?: string },
    summaryPatch: Record<string, unknown>,
  ): Promise<boolean> {
    const updated = await this._matchAndMerge(threadId, matcher, summaryPatch, -UPDATE_SUMMARY_TAIL_WINDOW)
    if (updated || !matcher.toolUseId) return updated
    return this._matchAndMerge(threadId, matcher, summaryPatch, 0)
  }

  private async _matchAndMerge(
    threadId: string,
    matcher: { toolUseId?: string; toolName?: string; catId?: string },
    summaryPatch: Record<string, unknown>,
    start: number,
  ): Promise<boolean> {
    const key = toolEventLogKey(threadId)
    // [member0, score0, member1, score1, …] flat layout.
    const withScores = await this.store.zrangeWithScores(key, start, -1).catch(() => [])
    const hasScores = (() => {
      if (withScores.length < 2 || withScores.length % 2 !== 0) return false
      for (let i = 1; i < withScores.length; i += 2) {
        if (Number.isNaN(Number.parseFloat(withScores[i]!))) return false
      }
      return true
    })()
    const pairs: Array<{ member: string; score: number }> = []
    if (hasScores) {
      for (let i = 0; i < withScores.length; i += 2) {
        pairs.push({ member: withScores[i]!, score: Number.parseFloat(withScores[i + 1]!) })
      }
    } else {
      const members = await this.store.zrange(key, start, -1)
      for (const m of members) pairs.push({ member: m, score: Number.NaN })
    }

    let updated = false
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]
      if (!pair) continue
      const event = JSON.parse(pair.member) as ToolEvent & { summary?: Record<string, unknown> }
      const summary = event.summary ?? {}
      if (matcher.toolUseId) {
        if (summary['_toolUseId'] !== matcher.toolUseId) continue
      } else {
        if (matcher.toolName && event.toolName !== matcher.toolName) continue
        if (matcher.catId && event.catId !== matcher.catId) continue
        if (summary['_resultMerged'] === true) continue
      }
      const mergedSummary = sanitizeToolEventSummary({ ...summary, ...summaryPatch, _resultMerged: true })
      const newEvent = { ...event, summary: mergedSummary }
      const newMember = JSON.stringify(newEvent)
      if (newMember === pair.member) {
        updated = true
        break
      }
      try {
        const preservedScore = Number.isNaN(pair.score) ? event.timestamp : pair.score
        await this.store.zadd(key, preservedScore, newMember)
        await this.store.zrem(key, pair.member).catch(() => {})
      } catch (err) {
        log.warn({ err, key, threadId }, 'Failed to update event summary')
        return false
      }
      updated = true
      break
    }
    return updated
  }

  /**
   * Get all event sub-sequences immediately following calls to `toolName`,
   * counting same-cat events (FM-1 grep_after_search_rate).
   */
  async getAllSequencesAfterTool(threadId: string, toolName: string, maxTurns: number): Promise<ToolEvent[][]> {
    const events = await this.readByThread(threadId)
    const sequences: ToolEvent[][] = []
    events.forEach((event, idx) => {
      if (event.toolName !== toolName) return
      const seq: ToolEvent[] = []
      for (let j = idx + 1; j < events.length && seq.length < maxTurns; j++) {
        const e = events[j]!
        if (e.catId === event.catId) seq.push(e)
      }
      sequences.push(seq)
    })
    return sequences
  }

  /**
   * Analyze nudge followup for all search_evidence events with nudgeEmitted=true
   * (FM-5 nudge effectiveness). Same-cat lookahead window.
   */
  async analyzeNudgeFollowup(threadId: string, lookaheadTurns: number): Promise<NudgeFollowupAnalysis[]> {
    const events = await this.readByThread(threadId)
    const result: NudgeFollowupAnalysis[] = []
    events.forEach((event, idx) => {
      if (event.toolName !== 'search_evidence') return
      const summary = event.summary as { nudgeEmitted?: boolean }
      if (!summary?.nudgeEmitted) return

      const lookahead: ToolEvent[] = []
      for (let j = idx + 1; j < events.length && lookahead.length < lookaheadTurns; j++) {
        const e = events[j]!
        if (e.catId === event.catId) lookahead.push(e)
      }
      const followupTool = lookahead.find((e) => NUDGE_FOLLOWUP_TOOLS.has(e.toolName))
      const grepEvent = lookahead.find((e) => isGrepFallback(e))

      result.push({
        searchEvent: event,
        followed: Boolean(followupTool),
        followupTool: followupTool?.toolName ?? null,
        fallbackGrepDetected: Boolean(grepEvent),
      })
    })
    return result
  }
}

function isGrepFallback(event: ToolEvent): boolean {
  if (event.toolName !== 'Bash') return false
  const summary = event.summary as { command?: unknown }
  if (typeof summary?.command !== 'string') return false
  const lower = summary.command.toLowerCase()
  return GREP_FALLBACK_PATTERNS.some((p) => lower.includes(p))
}

function noop(): void {}