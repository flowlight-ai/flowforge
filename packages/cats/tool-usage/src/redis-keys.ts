/**
 * Redis key patterns for tool event log and tool usage counters.
 *
 * Ported from clowder-ai `stores/redis-keys/{tool-event-log-keys,tool-usage-keys}`
 * into a local module (no external @cat-cafe dependency).
 *
 * Keys:
 *   tool-event-log:{threadId}  → ZSET; score=timestamp, member=JSON event
 *   skill-load-log:{sessionId} → ZSET; score=timestamp, member=JSON event
 *   tool-stats:{date}:{catId}:{category}:{toolName} → counter string
 */

/** TTL: 7 days (matches transcripts retention). */
export const TOOL_EVENT_LOG_TTL_SECONDS = 60 * 60 * 24 * 7

export function toolEventLogKey(threadId: string): string {
  return `tool-event-log:${threadId}`
}

export function skillLoadLogKey(sessionId: string): string {
  return `skill-load-log:${sessionId}`
}

/** Counter key for a single tool on a given day. */
export function toolUsageKey(date: string, catId: string, category: string, toolName: string): string {
  return `tool-stats:${date}:${catId}:${category}:${toolName}`
}

/** SCAN pattern to match all tool-stats keys. */
export const TOOL_USAGE_SCAN_ALL = 'tool-stats:*'

/** Persistent — no expiry (set > 0 to enable). */
export const TOOL_USAGE_TTL_SECONDS = 0