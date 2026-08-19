/**
 * Thread projection helpers — ported from clowder-ai `threads.ts`
 * (`sanitizeThreadForResponse` / `projectThreadForListView` /
 * `parseOptionalBooleanQuery`).
 *
 * clowder-ai strips `pendingContinuation` / `cloudCatBindings` /
 * `threadMetadata` top-level sidecars; the flowforge `StoredThread` keeps
 * operational state under `metadata` with an `internal.` namespace — those
 * keys are stripped here instead (same defense-in-depth intent).
 *
 * @module @flowforge/chat-threads/service
 */

import type { StoredThread } from '@flowforge/cats-stores'
import { INTERNAL_METADATA_PREFIX } from './invariant.ts'

/** Strip internal-only metadata keys from a client-facing thread projection. */
export function sanitizeThreadForResponse(thread: StoredThread): StoredThread {
  if (!thread.metadata) return thread
  const hasInternal = Object.keys(thread.metadata).some((key) => key.startsWith(INTERNAL_METADATA_PREFIX))
  if (!hasInternal) return thread
  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(thread.metadata)) {
    if (!key.startsWith(INTERNAL_METADATA_PREFIX)) metadata[key] = value
  }
  return { ...thread, metadata }
}

/**
 * Sidebar lightweight projection — strips the full metadata blob from list
 * responses (clowder-ai `view=sidebar` strips `threadMemory`).
 */
export function projectThreadForListView(
  thread: StoredThread,
  view: 'sidebar' | undefined,
): StoredThread {
  if (view !== 'sidebar') return thread
  const { metadata: _metadata, ...summary } = thread
  void _metadata
  return summary as StoredThread
}

/** Parse a loose boolean query value (`'true'/'1'/'false'/'0'` or boolean). */
export function parseOptionalBoolean(value: string | boolean | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}
