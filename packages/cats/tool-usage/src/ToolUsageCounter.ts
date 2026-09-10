/**
 * Tool Usage Counter — F150 (#339)
 * Fire-and-forget counter for tool_use events + aggregation reader, backed by
 * an injected SortedSetStore port.
 */

import { TOOL_USAGE_SCAN_ALL, TOOL_USAGE_TTL_SECONDS, toolUsageKey } from './redis-keys.ts'
import { createModuleLogger } from './logger.ts'
import { classifyTool, type ToolCategory } from './classify.ts'
import type { SortedSetStore } from './store.ts'

const log = createModuleLogger('tool-usage')

/** A single counter entry. */
export interface ToolUsageEntry {
  date: string
  catId: string
  category: ToolCategory
  toolName: string
  count: number
}

/** Aggregated report returned by the API. */
export interface ToolUsageReport {
  period: { from: string; to: string }
  summary: {
    totalCalls: number
    byCategory: Record<ToolCategory, number>
  }
  topTools: Array<{ name: string; category: ToolCategory; count: number; mcpServer?: string }>
  daily: Array<{
    date: string
    native: number
    mcp: number
    skill: number
  }>
  byCat: Record<string, Record<ToolCategory, number>>
}

export class ToolUsageCounter {
  constructor(
    private readonly store: SortedSetStore,
    private readonly archiver?: { loadArchive(excludeDates?: Set<string>): Promise<ToolUsageEntry[]> },
  ) {}

  /** Resolve store keyPrefix (SCAN doesn't auto-apply it). */
  private get keyPrefix(): string {
    return this.store.keyPrefix ?? ''
  }

  /** Strip keyPrefix from a raw SCAN key for use with normal commands. */
  private stripPrefix(rawKey: string): string {
    const p = this.keyPrefix
    return p && rawKey.startsWith(p) ? rawKey.slice(p.length) : rawKey
  }

  /** Record a tool_use event. Fire-and-forget — errors are logged, never thrown. */
  recordToolUse(catId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const classification = classifyTool(toolName, toolInput)
    const date = toDateString(Date.now())
    const key = toolUsageKey(date, catId, classification.category, classification.toolName)

    this.store
      .incr(key)
      .then((val) => {
        if (val === 1) {
          if (TOOL_USAGE_TTL_SECONDS > 0) this.store.expire(key, TOOL_USAGE_TTL_SECONDS).catch(noop)
        }
      })
      .catch((err) => {
        log.warn({ err, key }, 'Failed to increment tool usage counter')
      })
  }

  /**
   * Read aggregated tool usage for a date range. Pass days=0 for all-time
   * (Redis + archive).
   */
  async aggregate(days: number, filters?: { catId?: string; category?: ToolCategory }): Promise<ToolUsageReport> {
    const allTime = days <= 0
    const redisEntries = allTime ? await this.scanAll() : await this.scanDays(days)

    let entries: ToolUsageEntry[]
    if (allTime && this.archiver) {
      const redisKeys = new Set(redisEntries.map((e) => `${e.date}:${e.catId}:${e.category}:${e.toolName}`))
      const archived = await this.archiver.loadArchive()
      const deduped = archived.filter((e) => !redisKeys.has(`${e.date}:${e.catId}:${e.category}:${e.toolName}`))
      entries = [...deduped, ...redisEntries]
    } else {
      entries = redisEntries
    }

    const now = new Date()
    const to = toDateString(now.getTime())
    let from: string
    const firstEntry = entries[0]
    if (allTime && firstEntry) {
      from = entries.reduce((min, e) => (e.date < min ? e.date : min), firstEntry.date)
    } else {
      const fromDate = new Date(now)
      fromDate.setDate(fromDate.getDate() - (allTime ? 90 : days) + 1)
      from = toDateString(fromDate.getTime())
    }

    const filtered = entries.filter((e) => {
      if (filters?.catId && e.catId !== filters.catId) return false
      if (filters?.category && e.category !== filters.category) return false
      return true
    })

    const byCategory: Record<ToolCategory, number> = { native: 0, mcp: 0, skill: 0 }
    let totalCalls = 0
    for (const e of filtered) {
      byCategory[e.category] += e.count
      totalCalls += e.count
    }

    const toolTotals = new Map<string, { name: string; category: ToolCategory; count: number }>()
    for (const e of filtered) {
      const aggKey = `${e.category}:${e.toolName}`
      const existing = toolTotals.get(aggKey)
      if (existing) {
        existing.count += e.count
      } else {
        toolTotals.set(aggKey, { name: e.toolName, category: e.category, count: e.count })
      }
    }
    const topTools = [...toolTotals.values()].sort((a, b) => b.count - a.count).slice(0, 20)

    const dailyMap = new Map<string, Record<ToolCategory, number>>()
    for (const e of filtered) {
      const day = dailyMap.get(e.date) ?? { native: 0, mcp: 0, skill: 0 }
      day[e.category] += e.count
      dailyMap.set(e.date, day)
    }
    const daily = [...dailyMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, cats]) => ({ date, ...cats }))

    const byCat: Record<string, Record<ToolCategory, number>> = {}
    for (const e of filtered) {
      const bucket = byCat[e.catId] ?? (byCat[e.catId] = { native: 0, mcp: 0, skill: 0 })
      bucket[e.category] += e.count
    }

    return { period: { from, to }, summary: { totalCalls, byCategory }, topTools, daily, byCat }
  }

  /** Single-pass scan + client-side date filtering (avoids O(days * total_keys)). */
  private async scanDays(days: number): Promise<ToolUsageEntry[]> {
    const now = new Date()
    const validDates = new Set<string>()
    for (let i = 0; i < days; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      validDates.add(toDateString(d.getTime()))
    }

    const scanPattern = `${this.keyPrefix}${TOOL_USAGE_SCAN_ALL}`
    const entries: ToolUsageEntry[] = []
    const keys = await this.store.scan(scanPattern)
    if (keys.length > 0) {
      const strippedKeys = keys.map((k) => this.stripPrefix(k))
      const values = await this.store.mget(...strippedKeys)
      for (let i = 0; i < keys.length; i++) {
        const parsed = parseToolUsageKey(strippedKeys[i]!, values[i] ?? null)
        if (parsed && validDates.has(parsed.date)) {
          entries.push(parsed)
        }
      }
    }
    return entries
  }

  /** Scan all keys without date filtering (for all-time queries). */
  private async scanAll(): Promise<ToolUsageEntry[]> {
    const scanPattern = `${this.keyPrefix}${TOOL_USAGE_SCAN_ALL}`
    const entries: ToolUsageEntry[] = []
    const keys = await this.store.scan(scanPattern)
    if (keys.length > 0) {
      const strippedKeys = keys.map((k) => this.stripPrefix(k))
      const values = await this.store.mget(...strippedKeys)
      for (let i = 0; i < keys.length; i++) {
        const parsed = parseToolUsageKey(strippedKeys[i]!, values[i] ?? null)
        if (parsed) entries.push(parsed)
      }
    }
    return entries
  }

  /** Fetch all current entries (for bulk archive operations). */
  async fetchAllEntries(): Promise<ToolUsageEntry[]> {
    return this.scanAll()
  }
}

/** Parse a tool-stats key + value into a ToolUsageEntry. */
function parseToolUsageKey(key: string, value: string | null): ToolUsageEntry | null {
  if (!value) return null
  // key format: tool-stats:{date}:{catId}:{category}:{toolName}
  const parts = key.split(':')
  if (parts.length < 5) return null
  const date = parts[1]!
  const catId = parts[2]!
  const category = parts[3] as ToolCategory
  const toolName = parts.slice(4).join(':')
  const count = Number.parseInt(value, 10)
  if (!Number.isFinite(count)) return null
  return { date, catId, category, toolName, count }
}

function toDateString(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

function noop(): void {}