/**
 * SqliteMessageStore — SQLite implementation of {@link IMessageStore}.
 *
 * 行为基准是 `@flowforge/cats-stores/memory/message-store.ts`（语义 1:1）：
 * store-owned sortable id、默认 thread `default`、append 交付元数据所有权
 * 校验、幂等键去重、soft/hard delete、revealWhispers、markDelivered/
 * markCanceled 状态机。
 *
 * 与 memory 版的语义差异（持久化存储无容量上限）：
 * - 无 `maxMessages` 有界驱逐 — 持久化存储不丢数据，`getRecent`/`getByThread`
 *   用 SQL `LIMIT` 等价实现"最新 N 条"窗口。
 * - 其余查询语义（deleted 过滤、delivered 过滤、timeline 排序、pruned
 *   cursor 回退）逐条对齐 memory 版。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CatId } from '@flowforge/cats-shared'
import type {
  AppendMessageInput,
  IMessageStore,
  MarkCanceledResult,
  MarkDeliveredResult,
  MessageAppendListener,
  StoredMessage,
} from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

/** Default query limit. */
const DEFAULT_LIMIT = 50

/** Default thread id when none is provided. */
export const DEFAULT_THREAD_ID = 'default'

/** A row of the `messages` table (`data` holds the full record JSON). */
interface MessageRow {
  readonly id: string
  readonly thread_id: string
  readonly deleted_at: number | null
  readonly delivery_status: string | null
  readonly timeline_order_at: number | null
  readonly data: string
}

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

/** A message is delivered iff it has no deliveryStatus OR deliveryStatus === 'delivered'. */
function isDelivered(msg: StoredMessage): boolean {
  return !msg.deliveryStatus || msg.deliveryStatus === 'delivered'
}

/** A message is timeline-published iff it's a cat-authored speech OR a delivered user message. */
function isTimelinePublished(msg: StoredMessage): boolean {
  if (msg.catId !== null) return true
  return msg.deliveryStatus !== 'queued' && msg.deliveryStatus !== 'canceled'
}

/** Resolve the timeline ordering timestamp (timelineOrderAt if set, else timestamp). */
function getTimelineOrderTime(msg: StoredMessage): number {
  return msg.timelineOrderAt ?? msg.timestamp
}

/** Return a shallow copy of `value` with the given keys removed. */
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

/**
 * SQLite message store. All mutations rewrite the extracted columns AND the
 * `data` JSON in one statement so the index columns never drift from the
 * record. Appends run inside a BEGIN IMMEDIATE transaction (dedup check +
 * per-thread seq allocation + insert are atomic).
 */
export class SqliteMessageStore implements IMessageStore {
  // `| undefined` is required by exactOptionalPropertyTypes: true — otherwise
  // assigning an optional listener is rejected.
  onAppend?: MessageAppendListener | undefined

  constructor(private readonly db: DatabaseSync) {}

  private parse(row: MessageRow | undefined): StoredMessage | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as StoredMessage
  }

  private parseAll(rows: readonly unknown[]): StoredMessage[] {
    return (rows as unknown as MessageRow[]).map(row => JSON.parse(row.data) as StoredMessage)
  }

  append(input: AppendMessageInput): StoredMessage {
    const threadId = input.threadId ?? DEFAULT_THREAD_ID
    assertValidAppendMessageInput(input)
    return inImmediateTransaction(this.db, () => {
      // Idempotency: dedupe when the (userId, threadId, key) index still holds
      // a live row (the memory backend's idempotencyIndex equivalent).
      if (input.idempotencyKey) {
        const existing = this.db.prepare(
          'SELECT data FROM messages WHERE user_id = ? AND thread_id = ? AND idempotency_key = ? LIMIT 1',
        ).get(input.userId, threadId, input.idempotencyKey) as unknown as MessageRow | undefined
        if (existing !== undefined) {
          return JSON.parse(existing.data) as StoredMessage
        }
      }

      const { idempotencyKey: _omit, ...payload } = input
      void _omit
      const stored: StoredMessage = {
        ...payload,
        threadId,
        id: generateSortableId(input.timestamp),
      } as StoredMessage

      const nextSeq = (this.db.prepare(
        'SELECT COALESCE(MAX(seq_in_thread), -1) + 1 AS n FROM messages WHERE thread_id = ?',
      ).get(threadId) as unknown as { n: number }).n
      this.db.prepare(`
        INSERT INTO messages
          (id, thread_id, user_id, from_cat, timestamp, seq_in_thread, deleted_at,
           delivery_status, timeline_order_at, idempotency_key, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stored.id,
        threadId,
        stored.userId,
        stored.catId,
        stored.timestamp,
        nextSeq,
        stored.deletedAt ?? null,
        stored.deliveryStatus ?? null,
        stored.timelineOrderAt ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(stored),
      )

      if (this.onAppend) {
        try {
          void Promise.resolve(this.onAppend(stored)).catch(() => {})
        } catch {
          /* best-effort */
        }
      }

      return stored
    })
  }

  getById(id: string): StoredMessage | null {
    return this.parse(this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow | undefined)
  }

  getRecent(limit?: number, userId?: string): StoredMessage[] {
    const n = limit ?? DEFAULT_LIMIT
    // Insertion order == rowid order; newest-first scan then reverse, skipping
    // deleted rows and (optionally) other users' rows — the memory semantics.
    const rows = (userId !== undefined
      ? this.db.prepare('SELECT * FROM messages WHERE deleted_at IS NULL AND user_id = ? ORDER BY rowid DESC LIMIT ?')
        .all(userId, n)
      : this.db.prepare('SELECT * FROM messages WHERE deleted_at IS NULL ORDER BY rowid DESC LIMIT ?')
        .all(n)) as unknown as unknown[]
    return this.parseAll(rows).reverse()
  }

  getByThread(threadId: string, limit?: number, userId?: string): StoredMessage[] {
    const n = limit ?? DEFAULT_LIMIT
    const rows = (userId !== undefined
      ? this.db.prepare(`
          SELECT * FROM messages
          WHERE thread_id = ? AND deleted_at IS NULL
            AND (delivery_status IS NULL OR delivery_status = 'delivered')
            AND user_id = ?
          ORDER BY rowid DESC LIMIT ?
        `).all(threadId, userId, n)
      : this.db.prepare(`
          SELECT * FROM messages
          WHERE thread_id = ? AND deleted_at IS NULL
            AND (delivery_status IS NULL OR delivery_status = 'delivered')
          ORDER BY rowid DESC LIMIT ?
        `).all(threadId, n)) as unknown as unknown[]
    return this.parseAll(rows).reverse()
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
    // Timeline order depends on the record's timelineOrderAt ?? timestamp, so
    // sort in JS exactly like the memory backend (bounded per-thread scan).
    const rows = this.db.prepare('SELECT * FROM messages WHERE thread_id = ?').all(threadId) as unknown as unknown[]
    const matches = this.parseAll(rows).filter((msg) => {
      if (msg.deletedAt) return false
      if (!isTimelinePublished(msg) && !isDelivered(msg)) return false
      if (userId !== undefined && msg.userId !== userId) return false
      return true
    })
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

  deleteByThread(threadId: string): number {
    const res = this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId)
    return Number(res.changes)
  }

  private replace(updated: StoredMessage): void {
    this.db.prepare(`
      UPDATE messages SET
        thread_id = ?, user_id = ?, from_cat = ?, timestamp = ?, deleted_at = ?,
        delivery_status = ?, timeline_order_at = ?, data = ?
      WHERE id = ?
    `).run(
      updated.threadId,
      updated.userId,
      updated.catId,
      updated.timestamp,
      updated.deletedAt ?? null,
      updated.deliveryStatus ?? null,
      updated.timelineOrderAt ?? null,
      JSON.stringify(updated),
      updated.id,
    )
  }

  private findById(id: string): StoredMessage | null {
    return this.getById(id)
  }

  softDelete(id: string, deletedBy: string): StoredMessage | null {
    const msg = this.findById(id)
    if (!msg) return null
    const updated: StoredMessage = { ...msg, deletedAt: Date.now(), deletedBy }
    this.replace(updated)
    return updated
  }

  hardDelete(id: string, deletedBy: string): StoredMessage | null {
    const msg = this.findById(id)
    if (!msg) return null
    const tombstone: StoredMessage = {
      ...msg,
      content: '',
      mentions: [],
      deletedAt: Date.now(),
      deletedBy,
      _tombstone: true,
    }
    const stripped = omitFields(tombstone, ['contentBlocks', 'toolEvents', 'metadata', 'thinking'])
    this.db.prepare('UPDATE messages SET deleted_at = ?, idempotency_key = NULL, data = ? WHERE id = ?')
      .run(stripped.deletedAt ?? null, JSON.stringify(stripped), id)
    return stripped
  }

  restore(id: string): StoredMessage | null {
    const msg = this.findById(id)
    if (!msg || !msg.deletedAt || msg._tombstone) return null
    const restored = omitFields(msg, ['deletedAt', 'deletedBy'])
    this.replace(restored)
    return restored
  }

  revealWhispers(threadId: string, userId: string): number {
    const rows = this.db.prepare('SELECT * FROM messages WHERE thread_id = ? AND user_id = ?')
      .all(threadId, userId) as unknown as unknown[]
    const now = Date.now()
    let count = 0
    for (const row of this.parseAll(rows)) {
      if (row.visibility === 'whisper' && !row.revealedAt) {
        const updated: StoredMessage = { ...row, revealedAt: now }
        this.replace(updated)
        count++
      }
    }
    return count
  }

  updateExtra(id: string, extra: Record<string, unknown>): StoredMessage | null {
    const msg = this.findById(id)
    if (!msg) return null
    const updated: StoredMessage = {
      ...msg,
      metadata: { ...(msg.metadata ?? {}), ...extra },
    }
    this.replace(updated)
    return updated
  }

  markDelivered(id: string, deliveredAt: number): MarkDeliveredResult | null {
    assertValidStoredMessageTimestamp(deliveredAt)
    const msg = this.findById(id)
    if (!msg) return null
    if (msg.deliveryStatus !== 'queued') return { ...msg, deliveryTransitioned: false }
    const timelineOrderAt = Math.max(deliveredAt, msg.timestamp)
    const updated: StoredMessage = {
      ...msg,
      timelineOrderAt,
      deliveredAt,
      deliveryStatus: 'delivered',
    }
    this.replace(updated)
    return { ...updated, deliveryTransitioned: true }
  }

  markCanceled(id: string): MarkCanceledResult | null {
    const msg = this.findById(id)
    if (!msg) return null
    if (msg.deliveryStatus !== 'queued') return { ...msg, deliveryTransitioned: false }
    const updated: StoredMessage = {
      ...msg,
      deliveryStatus: 'canceled',
    }
    this.replace(updated)
    return { ...updated, deliveryTransitioned: true }
  }

  /** Current message count (for testing). */
  get size(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as unknown as { n: number }).n
  }
}

/** Type re-exports for ergonomic imports. */
export type { CatId, IMessageStore, StoredMessage }
