/**
 * SqliteThreadStore — SQLite implementation of {@link IThreadStore}.
 *
 * 行为基准：`@flowforge/cats-stores/memory/thread-store.ts`（语义 1:1）：
 * store-owned id、重复 id 抛错、listForUser 按 updatedAt 倒序 + archived
 * 过滤 + limit、update patch 合并、archive/unarchive、touchLastMessage、
 * delete。`unarchive` 以解构剔除 `archivedAt`（与 memory 版一致，null 列
 * 归档状态存于 `archived_at` 索引列）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateId, type CatId, type ThreadId } from '@flowforge/cats-shared'
import type {
  CreateThreadInput,
  IThreadStore,
  StoredThread,
  UpdateThreadPatch,
} from '@flowforge/cats-stores/ports'

/** A row of the `threads` table (`data` holds the full record JSON). */
interface ThreadRow {
  readonly id: string
  readonly user_id: string
  readonly archived_at: number | null
  readonly data: string
}

/** SQLite thread store — durable across processes. */
export class SqliteThreadStore implements IThreadStore {
  constructor(private readonly db: DatabaseSync) {}

  private parse(row: ThreadRow | undefined): StoredThread | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as StoredThread
  }

  private writeRow(thread: StoredThread): void {
    this.db.prepare(`
      INSERT INTO threads (id, user_id, updated_at, archived_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        data = excluded.data
    `).run(thread.id, thread.userId, thread.updatedAt, thread.archivedAt ?? null, JSON.stringify(thread))
  }

  create(input: CreateThreadInput): StoredThread {
    const id = input.id ?? generateId('thread')
    const now = Date.now()
    if (this.getById(id) !== null) {
      throw new Error(`thread "${id}" already exists`)
    }
    const stored: StoredThread = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.writeRow(stored)
    return stored
  }

  getById(id: string): StoredThread | null {
    return this.parse(this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as ThreadRow | undefined)
  }

  listForUser(userId: ThreadId | string, options?: {
    readonly includeArchived?: boolean
    readonly limit?: number
  }): StoredThread[] {
    const limit = options?.limit ?? 100
    const includeArchived = options?.includeArchived ?? false
    const rows = (includeArchived
      ? this.db.prepare('SELECT * FROM threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(userId, limit)
      : this.db.prepare('SELECT * FROM threads WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?')
        .all(userId, limit)) as unknown as unknown[]
    return (rows as unknown as ThreadRow[]).map(row => JSON.parse(row.data) as StoredThread)
  }

  private patch(id: string, mutate: (existing: StoredThread) => StoredThread): StoredThread | null {
    const existing = this.getById(id)
    if (!existing) return null
    const updated = mutate(existing)
    this.writeRow(updated)
    return updated
  }

  update(id: string, patch: UpdateThreadPatch): StoredThread | null {
    return this.patch(id, existing => ({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }))
  }

  archive(id: string, _archivedBy: string): StoredThread | null {
    return this.update(id, { archivedAt: Date.now() })
  }

  unarchive(id: string): StoredThread | null {
    return this.patch(id, (existing) => {
      // Strip archivedAt by destructuring it out (avoids `delete` on readonly).
      const { archivedAt: _omit, ...rest } = existing
      void _omit
      return { ...rest, updatedAt: Date.now() } as StoredThread
    })
  }

  touchLastMessage(id: string, messageId: string, at: number): StoredThread | null {
    return this.update(id, { lastMessageAt: at, lastMessageId: messageId })
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM threads WHERE id = ?').run(id).changes) > 0
  }
}

/** Type re-exports for ergonomic imports. */
export type { CatId, IThreadStore, StoredThread }
