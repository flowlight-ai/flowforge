/**
 * MemoryMessageStore — in-memory bounded LRU implementation of {@link IMessageStore}.
 *
 * Ported from clowder-ai `MessageStore` (api/src/domains/cats/services/stores/ports/MessageStore.ts)
 * with the following simplifications for batch 2:
 * - No Redis visibilitySeq counter mirror (single-process Memory only)
 * - No queued-custody state machine (F254) — `queueCustody` field is opaque, transitions
 *   are stubbed to no-op+thrown on terminalization attempts
 * - No plugin-message revision CAS (F288)
 * - No content-dedup TTL index (lives in a separate route layer)
 *
 * The full feature parity is deferred to incremental batches; the architecture
 * (port + plugin) is already shaped to accept them without breaking consumers.
 *
 * @module @flowforge/cats-stores/memory
 */

import { randomUUID } from 'node:crypto'
import type { CatId } from '@flowforge/cats-shared'
import type {
  AppendMessageInput,
  IMessageStore,
  MarkCanceledResult,
  MarkDeliveredResult,
  MessageAppendListener,
  StoredMessage,
} from '../ports/message-store.ts'

/** Default maximum retained messages per process. */
const DEFAULT_MAX_MESSAGES = 2000

/** Default query limit. */
const DEFAULT_LIMIT = 50

/** Default thread id when none is provided. */
export const DEFAULT_THREAD_ID = 'default'

/** Assert a stored message timestamp is a non-negative integer ECMAScript Date value. */
function assertValidStoredMessageTimestamp(timestamp: number): void {
  if (!Number.isInteger(timestamp) || timestamp < 0 || Number.isNaN(new Date(timestamp).getTime())) {
    throw new RangeError('message timestamp must be a non-negative integer ECMAScript Date value')
  }
}

/** Validate delivery-metadata ownership for an append input. */
function assertValidAppendDeliveryMetadata(msg: AppendMessageInput): void {
  const runtimeInput = msg as AppendMessageInput &
    Partial<Pick<StoredMessage, 'deliveredAt' | 'timelineOrderAt' | 'deliveryStatus'>>
  if (
    'deliveredAt' in runtimeInput
    || 'timelineOrderAt' in runtimeInput
    || (runtimeInput.deliveryStatus !== undefined && runtimeInput.deliveryStatus !== 'queued')
  ) {
    throw new TypeError('append() delivery metadata is transition-owned; only queued status may be initialized')
  }
}

/** Validate caller-controlled fields that affect persistent message order. */
function assertValidAppendMessageInput(msg: AppendMessageInput): void {
  assertValidAppendDeliveryMetadata(msg)
  assertValidStoredMessageTimestamp(msg.timestamp)
}

let _seq = 0
/** Generate a sortable ID: zero-padded timestamp + sequence + UUID suffix. */
function generateSortableId(timestamp: number): string {
  assertValidStoredMessageTimestamp(timestamp)
  const ts = String(timestamp).padStart(16, '0')
  const seq = String(_seq++).padStart(6, '0')
  const suffix = randomUUID().slice(0, 8)
  return `${ts}-${seq}-${suffix}`
}

/** A message is timeline-published iff it's a cat-authored speech OR a delivered user message. */
function isTimelinePublished(msg: StoredMessage): boolean {
  if (msg.catId !== null) return true
  return msg.deliveryStatus !== 'queued' && msg.deliveryStatus !== 'canceled'
}

/** A message is delivered iff it has no deliveryStatus OR deliveryStatus === 'delivered'. */
function isDelivered(msg: StoredMessage): boolean {
  return !msg.deliveryStatus || msg.deliveryStatus === 'delivered'
}

/** Resolve the timeline ordering timestamp (timelineOrderAt if set, else timestamp). */
function getTimelineOrderTime(msg: StoredMessage): number {
  return msg.timelineOrderAt ?? msg.timestamp
}

/**
 * In-memory bounded message store. Not thread-safe across processes — use the
 * Sqlite backend (`@flowforge/cats-stores-sqlite`, batch 2.4) for durability.
 */
export class MemoryMessageStore implements IMessageStore {
  private messages: StoredMessage[] = []
  private readonly maxMessages: number
  private readonly idempotencyIndex = new Map<string, string>()
  // `| undefined` is required by exactOptionalPropertyTypes: true — otherwise
  // assigning `options?.onAppend` (which is `MessageAppendListener | undefined`)
  // is rejected.
  onAppend?: MessageAppendListener | undefined

  constructor(options?: { readonly maxMessages?: number; readonly onAppend?: MessageAppendListener }) {
    this.maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES
    this.onAppend = options?.onAppend
  }

  private buildIdempotencyIndexKey(userId: string, threadId: string, idempotencyKey?: string): string | null {
    if (!idempotencyKey) return null
    return `${userId}:${threadId}:${idempotencyKey}`
  }

  private pruneIdempotencyIndexForMessageIds(messageIds: readonly string[]): void {
    if (messageIds.length === 0) return
    const removedIds = new Set(messageIds)
    for (const [key, value] of this.idempotencyIndex.entries()) {
      if (removedIds.has(value)) {
        this.idempotencyIndex.delete(key)
      }
    }
  }

  append(input: AppendMessageInput): StoredMessage {
    const threadId = input.threadId ?? DEFAULT_THREAD_ID
    assertValidAppendMessageInput(input)
    const idempotencyIndexKey = this.buildIdempotencyIndexKey(input.userId, threadId, input.idempotencyKey)
    if (idempotencyIndexKey) {
      const existingId = this.idempotencyIndex.get(idempotencyIndexKey)
      if (existingId) {
        const existing = this.getById(existingId)
        if (existing) return existing
        this.idempotencyIndex.delete(idempotencyIndexKey)
      }
    }

    const { idempotencyKey: _omit, ...payload } = input
    void _omit
    const stored: StoredMessage = {
      ...payload,
      id: generateSortableId(input.timestamp),
      threadId,
    } as StoredMessage
    this.messages.push(stored)
    if (idempotencyIndexKey) {
      this.idempotencyIndex.set(idempotencyIndexKey, stored.id)
    }

    if (this.messages.length > this.maxMessages) {
      const removed = this.messages.slice(0, this.messages.length - this.maxMessages)
      this.messages = this.messages.slice(-this.maxMessages)
      this.pruneIdempotencyIndexForMessageIds(removed.map((entry) => entry.id))
    }

    if (this.onAppend) {
      try {
        void Promise.resolve(this.onAppend(stored)).catch(() => {})
      } catch {
        /* best-effort */
      }
    }

    return stored
  }

  getById(id: string): StoredMessage | null {
    return this.messages.find((m) => m.id === id) ?? null
  }

  getRecent(limit?: number, userId?: string): StoredMessage[] {
    const n = limit ?? DEFAULT_LIMIT
    const matches: StoredMessage[] = []
    for (let i = this.messages.length - 1; i >= 0 && matches.length < n; i--) {
      const msg = this.messages[i]!
      if (msg.deletedAt) continue
      if (userId && msg.userId !== userId) continue
      matches.push(msg)
    }
    return matches.reverse()
  }

  getByThread(threadId: string, limit?: number, userId?: string): StoredMessage[] {
    const n = limit ?? DEFAULT_LIMIT
    const matches: StoredMessage[] = []
    for (let i = this.messages.length - 1; i >= 0 && matches.length < n; i--) {
      const msg = this.messages[i]!
      if (msg.threadId !== threadId) continue
      if (msg.deletedAt) continue
      if (!isDelivered(msg)) continue
      if (userId && msg.userId !== userId) continue
      matches.push(msg)
    }
    return matches.reverse()
  }

  getByThreadAfter(
    threadId: string,
    afterId?: string,
    limit?: number,
    userId?: string,
  ): StoredMessage[] {
    const max = Number.isFinite(limit as number) && (limit as number) > 0
      ? (limit as number)
      : Number.MAX_SAFE_INTEGER
    const matches: StoredMessage[] = []
    for (const msg of this.messages) {
      if (msg.threadId !== threadId) continue
      if (msg.deletedAt) continue
      if (!isTimelinePublished(msg) && !isDelivered(msg)) continue
      if (userId && msg.userId !== userId) continue
      matches.push(msg)
    }
    matches.sort((a, b) => {
      const ta = getTimelineOrderTime(a)
      const tb = getTimelineOrderTime(b)
      if (ta !== tb) return ta - tb
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

    if (!afterId) return matches.slice(0, max)
    const cursorIdx = matches.findIndex((m) => m.id === afterId)
    if (cursorIdx >= 0) return matches.slice(cursorIdx + 1, cursorIdx + 1 + max)
    // Pruned cursor fallback: full rescan from origin
    return matches.slice(0, max)
  }

  getByThreadBefore(
    threadId: string,
    beforeTs?: number,
    limit?: number,
    beforeId?: string,
    userId?: string,
  ): StoredMessage[] {
    const max = Number.isFinite(limit as number) && (limit as number) > 0
      ? (limit as number)
      : DEFAULT_LIMIT
    const matches: StoredMessage[] = []
    for (const msg of this.messages) {
      if (msg.threadId !== threadId) continue
      if (msg.deletedAt) continue
      if (!isTimelinePublished(msg) && !isDelivered(msg)) continue
      if (userId && msg.userId !== userId) continue
      matches.push(msg)
    }
    matches.sort((a, b) => {
      const ta = getTimelineOrderTime(a)
      const tb = getTimelineOrderTime(b)
      if (ta !== tb) return ta - tb
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    const older = beforeTs === undefined
      ? matches
      : matches.filter((m) => {
          const t = getTimelineOrderTime(m)
          if (t !== beforeTs) return t < beforeTs
          return beforeId === undefined ? false : m.id < beforeId
        })
    return older.slice(-max)
  }

  deleteByThread(threadId: string): number {
    const removed = this.messages.filter((m) => m.threadId === threadId)
    const before = this.messages.length
    this.messages = this.messages.filter((m) => m.threadId !== threadId)
    this.pruneIdempotencyIndexForMessageIds(removed.map((entry) => entry.id))
    return before - this.messages.length
  }

  softDelete(id: string, deletedBy: string): StoredMessage | null {
    const msg = this.messages.find((m) => m.id === id)
    if (!msg) return null
    const updated: StoredMessage = { ...msg, deletedAt: Date.now(), deletedBy }
    this.replace(id, updated)
    return updated
  }

  hardDelete(id: string, deletedBy: string): StoredMessage | null {
    const msg = this.messages.find((m) => m.id === id)
    if (!msg) return null
    const tombstone: StoredMessage = {
      ...msg,
      content: '',
      mentions: [],
      deletedAt: Date.now(),
      deletedBy,
      _tombstone: true,
    }
    // Strip optional content fields by destructuring them out (avoids `delete`
    // on readonly fields, which is rejected under exactOptionalPropertyTypes).
    const stripped = omitFields(tombstone, ['contentBlocks', 'toolEvents', 'metadata', 'thinking'])
    this.replace(id, stripped)
    this.pruneIdempotencyIndexForMessageIds([id])
    return stripped
  }

  restore(id: string): StoredMessage | null {
    const msg = this.messages.find((m) => m.id === id)
    if (!msg || !msg.deletedAt || msg._tombstone) return null
    const restored = omitFields(msg, ['deletedAt', 'deletedBy'])
    this.replace(id, restored)
    return restored
  }

  revealWhispers(threadId: string, userId: string): number {
    const now = Date.now()
    let count = 0
    for (const msg of this.messages) {
      if (msg.threadId !== threadId) continue
      if (msg.userId !== userId) continue
      if (msg.visibility === 'whisper' && !msg.revealedAt) {
        const updated: StoredMessage = { ...msg, revealedAt: now }
        this.replace(msg.id, updated)
        count++
      }
    }
    return count
  }

  updateExtra(id: string, extra: Record<string, unknown>): StoredMessage | null {
    const msg = this.messages.find((m) => m.id === id)
    if (!msg) return null
    const updated: StoredMessage = {
      ...msg,
      metadata: { ...(msg.metadata ?? {}), ...extra },
    }
    this.replace(id, updated)
    return updated
  }

  markDelivered(id: string, deliveredAt: number): MarkDeliveredResult | null {
    assertValidStoredMessageTimestamp(deliveredAt)
    const msg = this.messages.find((m) => m.id === id)
    if (!msg) return null
    if (msg.deliveryStatus !== 'queued') return { ...msg, deliveryTransitioned: false }
    const timelineOrderAt = Math.max(deliveredAt, msg.timestamp)
    const updated: StoredMessage = {
      ...msg,
      timelineOrderAt,
      deliveredAt,
      deliveryStatus: 'delivered',
    }
    this.replace(id, updated)
    return { ...updated, deliveryTransitioned: true }
  }

  markCanceled(id: string): MarkCanceledResult | null {
    const msg = this.messages.find((m) => m.id === id)
    if (!msg) return null
    if (msg.deliveryStatus !== 'queued') return { ...msg, deliveryTransitioned: false }
    const updated: StoredMessage = {
      ...msg,
      deliveryStatus: 'canceled',
    }
    this.replace(id, updated)
    return { ...updated, deliveryTransitioned: true }
  }

  /** Current message count (for testing). */
  get size(): number {
    return this.messages.length
  }

  /** Replace a message by id (helper for mutation). */
  private replace(id: string, updated: StoredMessage): void {
    const idx = this.messages.findIndex((m) => m.id === id)
    if (idx >= 0) this.messages[idx] = updated
  }
}

/** Type re-exports for ergonomic imports. */
export type { CatId, IMessageStore, StoredMessage }

/**
 * Return a shallow copy of `value` with the given `keys` removed, preserving
 * the rest. Used to clear optional readonly fields without `delete` (which is
 * rejected under `exactOptionalPropertyTypes` + readonly enforcement).
 *
 * The cast is safe: callers pass keys that exist on `T`, and the runtime
 * destructure correctly omits them.
 */
function omitFields<T>(value: T, keys: readonly string[]): T {
  const keySet = new Set(keys)
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!keySet.has(k)) {
      rest[k] = v
    }
  }
  return rest as T
}
