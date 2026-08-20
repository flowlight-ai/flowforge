/**
 * SqliteDeliveryCursorStore — durable IDeliveryCursorStore (F254, 批次 6.5).
 *
 * 语义对齐 `@flowforge/cats-stores` Memory 版：delivery 与 seen 两个 cursor
 * 命名空间相互独立（AC-A9），本实现落为同一复合主键行 (user_id, cat_id,
 * thread_id) 上的两个可空列 —— 对其中一个的写永远不会影响另一个
 * （ON CONFLICT 仅更新目标列）。消息 ID 是 lexicographically sortable
 * 字符串，字符串比较即单调。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import type { CatId, ThreadId, UserId } from '@flowforge/cats-shared'
import type { IDeliveryCursorStore } from '@flowforge/cats-stores/ports'

/** Row shape of the `delivery_cursors` table. */
interface DeliveryCursorRow {
  readonly user_id: string
  readonly cat_id: string
  readonly thread_id: string
  readonly delivery_cursor: string | null
  readonly seen_cursor: string | null
}

/** Durable per (user × cat × thread) cursor store backed by SQLite. */
export class SqliteDeliveryCursorStore implements IDeliveryCursorStore {
  constructor(private readonly db: DatabaseSync) {}

  private row(userId: UserId, catId: CatId, threadId: ThreadId): DeliveryCursorRow | undefined {
    return this.db.prepare(
      'SELECT * FROM delivery_cursors WHERE user_id = ? AND cat_id = ? AND thread_id = ?',
    ).get(userId, catId, threadId) as unknown as DeliveryCursorRow | undefined
  }

  getDeliveryCursor(userId: UserId, catId: CatId, threadId: ThreadId): string | null {
    return this.row(userId, catId, threadId)?.delivery_cursor ?? null
  }

  setDeliveryCursor(
    userId: UserId,
    catId: CatId,
    threadId: ThreadId,
    cursor: string,
  ): void {
    // Upsert only the delivery column — the seen cursor is never touched.
    this.db.prepare(`
      INSERT INTO delivery_cursors (user_id, cat_id, thread_id, delivery_cursor)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, cat_id, thread_id) DO UPDATE SET
        delivery_cursor = excluded.delivery_cursor
    `).run(userId, catId, threadId, cursor)
  }

  getSeenCursor(userId: UserId, catId: CatId, threadId: ThreadId): string | null {
    return this.row(userId, catId, threadId)?.seen_cursor ?? null
  }

  setSeenCursor(
    userId: UserId,
    catId: CatId,
    threadId: ThreadId,
    cursor: string,
  ): void {
    // Upsert only the seen column — the delivery cursor is never touched.
    this.db.prepare(`
      INSERT INTO delivery_cursors (user_id, cat_id, thread_id, seen_cursor)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, cat_id, thread_id) DO UPDATE SET
        seen_cursor = excluded.seen_cursor
    `).run(userId, catId, threadId, cursor)
  }
}
