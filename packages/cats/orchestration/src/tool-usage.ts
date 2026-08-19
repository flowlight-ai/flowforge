/**
 * UsageAggregatorService — 工具用量遥测 + 聚合 Cordis 服务（F150/F188）。
 *
 * 移植自 clowder-ai `tool-usage/`（ToolUsageCounter + ToolEventLog + classify）
 * （R13 一切皆插件改造）：
 * - clowder-ai 的 Redis INCR + SCAN + TTL/归档机制替换为进程内计数 Map +
 *   有界环形事件日志（flowforge 无 Redis 依赖；聚合语义保持一致）
 * - classifyTool 双 MCP 命名规约（Claude Code `mcp__srv__tool` / Codex `mcp:srv/tool`）
 * - F188 AC-F10 append-only ToolEvent 日志：支撑 per-thread 工具调用序列指标
 * - fire-and-forget recordToolUse：计数失败记日志不抛（对齐 clowder-ai）
 * - `Context` 扩展挂载点：`ctx.catsToolUsage`（对齐 24-stage4 计划 T4.5.5）
 *
 * @module @flowforge/cats-orchestration/tool-usage
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  SkillLoadedEvent,
  ToolCategory,
  ToolClassification,
  ToolEvent,
  ToolUsageEntry,
  ToolUsageReport,
} from '@flowforge/cats-shared'
import { TOOL_EVENT_LOG_CAPACITY, TOOL_USAGE_TOP_TOOLS } from './invariant.ts'

/**
 * Classify a tool_use event by toolName + optional toolInput.
 *
 * Rules:
 * - toolName === 'Skill'          → skill; real name from toolInput.skill
 * - toolName starts with 'mcp__'  → mcp (Claude Code format)
 * - toolName starts with 'mcp:'   → mcp (Codex format)
 * - everything else               → native
 */
export function classifyTool(toolName: string, toolInput: Record<string, unknown> | undefined): ToolClassification {
  // Skill invocations
  if (toolName === 'Skill') {
    const skillName = toolInput && typeof toolInput.skill === 'string' ? toolInput.skill : 'unknown'
    return { category: 'skill', toolName: skillName }
  }

  // MCP tools — Claude Code format: mcp__{serverName}__{toolName}
  if (toolName.startsWith('mcp__')) {
    const withoutPrefix = toolName.slice(5)
    const sepIdx = withoutPrefix.indexOf('__')
    const mcpServer = sepIdx > 0 ? withoutPrefix.slice(0, sepIdx) : withoutPrefix
    return { category: 'mcp', toolName, mcpServer }
  }

  // MCP tools — Codex format: mcp:{serverName}/{toolName}
  if (toolName.startsWith('mcp:')) {
    const withoutPrefix = toolName.slice(4)
    const slashIdx = withoutPrefix.indexOf('/')
    const mcpServer = slashIdx > 0 ? withoutPrefix.slice(0, slashIdx) : withoutPrefix
    return { category: 'mcp', toolName, mcpServer }
  }

  return { category: 'native', toolName }
}

/** F153 Phase J (KD-40): MCP tool name probe (wider than classifyTool for span emission). */
export function isMcpToolName(toolName: string): boolean {
  return (
    toolName.startsWith('mcp__') ||
    toolName.startsWith('mcp:') ||
    toolName.startsWith('cat_cafe_') ||
    toolName.startsWith('signal_')
  )
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 工具用量遥测 — mounted by `@flowforge/cats-orchestration`.
     */
    catsToolUsage: UsageAggregatorService
  }
}

function toDateString(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

function entryKey(date: string, catId: string, category: ToolCategory, toolName: string): string {
  return `${date}:${catId}:${category}:${toolName}`
}

/**
 * Cordis service exposing tool-usage telemetry at `ctx.catsToolUsage`.
 *
 * Counters live in-process (Map); the event log is a bounded ring for
 * per-thread tool-call-sequence metrics (F188 AC-F10).
 */
export class UsageAggregatorService extends Service {
  static inject: readonly string[] = []

  private readonly counters = new Map<string, ToolUsageEntry>()
  private readonly events: ToolEvent[] = []
  private readonly skillEvents: SkillLoadedEvent[] = []

  constructor(ctx: Context) {
    super(ctx, 'catsToolUsage')
  }

  /**
   * Record a tool_use event (fire-and-forget — errors are logged, never thrown).
   */
  recordToolUse(catId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    try {
      const classification = classifyTool(toolName, toolInput)
      const date = toDateString(Date.now())
      const key = entryKey(date, catId, classification.category, classification.toolName)
      const existing = this.counters.get(key)
      if (existing) {
        this.counters.set(key, { ...existing, count: existing.count + 1 })
      } else {
        this.counters.set(key, { date, catId, category: classification.category, toolName: classification.toolName, count: 1 })
      }
    } catch (err) {
      this.ctx.logger.warn('cats-tool-usage: failed to record tool use: %o', err)
    }
  }

  /**
   * Append a structured tool event to the bounded log (F188 AC-F10).
   * Oldest entries are evicted beyond TOOL_EVENT_LOG_CAPACITY.
   */
  recordToolEvent(event: ToolEvent): void {
    this.events.push(event)
    if (this.events.length > TOOL_EVENT_LOG_CAPACITY) {
      this.events.splice(0, this.events.length - TOOL_EVENT_LOG_CAPACITY)
    }
  }

  /** Append a skill-load event (AS-4 memory-navigation telemetry). */
  recordSkillLoaded(event: SkillLoadedEvent): void {
    this.skillEvents.push(event)
    if (this.skillEvents.length > TOOL_EVENT_LOG_CAPACITY) {
      this.skillEvents.splice(0, this.skillEvents.length - TOOL_EVENT_LOG_CAPACITY)
    }
  }

  /** Read the recent tool-event log (newest last). */
  listToolEvents(limit?: number): readonly ToolEvent[] {
    return limit === undefined ? [...this.events] : this.events.slice(-limit)
  }

  /** Read the recent skill-load log (newest last). */
  listSkillEvents(limit?: number): readonly SkillLoadedEvent[] {
    return limit === undefined ? [...this.skillEvents] : this.skillEvents.slice(-limit)
  }

  /**
   * Read aggregated tool usage for a trailing date window.
   * Pass days<=0 for all recorded in-process data.
   */
  async aggregate(
    days: number,
    filters?: { catId?: string; category?: ToolCategory },
  ): Promise<ToolUsageReport> {
    const allTime = days <= 0
    const entries = [...this.counters.values()]

    const now = new Date()
    const to = toDateString(now.getTime())
    let from: string
    if (allTime && entries.length > 0) {
      from = entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0]!.date)
    } else {
      const fromDate = new Date(now)
      fromDate.setDate(fromDate.getDate() - (allTime ? 90 : days) + 1)
      from = toDateString(fromDate.getTime())
    }

    const filtered = entries.filter((e) => {
      if (!allTime && e.date < from) return false
      if (filters?.catId && e.catId !== filters.catId) return false
      if (filters?.category && e.category !== filters.category) return false
      return true
    })

    // Summary
    const byCategory: Record<ToolCategory, number> = { native: 0, mcp: 0, skill: 0 }
    let totalCalls = 0
    for (const e of filtered) {
      byCategory[e.category] += e.count
      totalCalls += e.count
    }

    // Top tools (aggregate by category:toolName to avoid cross-category collision)
    const toolTotals = new Map<string, { name: string; category: ToolCategory; count: number }>()
    for (const e of filtered) {
      const aggKey = `${e.category}:${e.toolName}`
      const existing = toolTotals.get(aggKey)
      if (existing) existing.count += e.count
      else toolTotals.set(aggKey, { name: e.toolName, category: e.category, count: e.count })
    }
    const topTools = [...toolTotals.values()].sort((a, b) => b.count - a.count).slice(0, TOOL_USAGE_TOP_TOOLS)

    // Daily breakdown
    const dailyMap = new Map<string, Record<ToolCategory, number>>()
    for (const e of filtered) {
      const day = dailyMap.get(e.date) ?? { native: 0, mcp: 0, skill: 0 }
      day[e.category] += e.count
      dailyMap.set(e.date, day)
    }
    const daily = [...dailyMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, cats]) => ({ date, ...cats }))

    // By cat
    const byCat: Record<string, Record<ToolCategory, number>> = {}
    for (const e of filtered) {
      const catCounters = byCat[e.catId] ?? { native: 0, mcp: 0, skill: 0 }
      catCounters[e.category] += e.count
      byCat[e.catId] = catCounters
    }

    return { period: { from, to }, summary: { totalCalls, byCategory }, topTools, daily, byCat }
  }

  /** Fetch all current entries (for bulk archive / diagnostics). */
  async fetchAllEntries(): Promise<ToolUsageEntry[]> {
    return [...this.counters.values()]
  }
}
