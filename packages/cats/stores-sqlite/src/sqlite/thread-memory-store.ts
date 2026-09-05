/**
 * SqliteVoteStore + SqliteThreadMemoryStore（批次52）.
 *
 * - VoteStore：F079 每线程投票状态（VotingStateV1 原样读写，thread_id 主键）。
 * - ThreadMemoryStore：F3-lite 每线程 KV 记忆，MAX_KEYS_PER_THREAD 容量内
 *   淘汰 updatedAt 最旧 key（语义对齐 Memory 版）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import type { MemoryEntry, MemoryInput, VotingStateV1 } from '@flowforge/cats-shared'
import type { IVoteStore } from '@flowforge/cats-stores/ports'
import { MAX_KEYS_PER_THREAD, type IThreadMemoryStore } from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

// ── VoteStore ───────────────────────────────────────────────

interface VoteRow {
  readonly thread_id: string
  readonly data: string
}

export class SqliteVoteStore implements IVoteStore {
  constructor(private readonly db: DatabaseSync) {}

  getByThread(threadId: string): VotingStateV1 | null {
    const row = this.db.prepare('SELECT * FROM thread_votes WHERE thread_id = ?')
      .get(threadId) as unknown as VoteRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as VotingStateV1)
  }

  saveByThread(threadId: string, state: VotingStateV1): void {
    this.db.prepare(`
      INSERT INTO thread_votes (thread_id, data) VALUES (?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET data = excluded.data
    `).run(threadId, JSON.stringify(state))
  }

  clearByThread(threadId: string): void {
    this.db.prepare('DELETE FROM thread_votes WHERE thread_id = ?').run(threadId)
  }
}

// ── ThreadMemoryStore ───────────────────────────────────────

interface ThreadMemoryRow {
  readonly thread_id: string
  readonly key: string
  readonly updated_at: number
  readonly data: string
}

export class SqliteThreadMemoryStore implements IThreadMemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  set(input: MemoryInput): MemoryEntry {
    return inImmediateTransaction(this.db, () => {
      const exists = this.db.prepare(
        'SELECT 1 FROM thread_memories WHERE thread_id = ? AND key = ?',
      ).get(input.threadId, input.key) !== undefined
      // Capacity: evict the oldest key before adding a NEW key at capacity.
      if (!exists) {
        const count = this.db.prepare(
          'SELECT COUNT(*) AS count FROM thread_memories WHERE thread_id = ?',
        ).get(input.threadId) as { count: number }
        if (count.count >= MAX_KEYS_PER_THREAD) {
          this.db.prepare(`
            DELETE FROM thread_memories WHERE thread_id = ? AND key = (
              SELECT key FROM thread_memories WHERE thread_id = ?
              ORDER BY updated_at ASC, key ASC LIMIT 1
            )
          `).run(input.threadId, input.threadId)
        }
      }
      const entry: MemoryEntry = {
        key: input.key,
        value: input.value,
        threadId: input.threadId,
        updatedBy: input.updatedBy,
        updatedAt: Date.now(),
      }
      this.db.prepare(`
        INSERT INTO thread_memories (thread_id, key, updated_at, data) VALUES (?, ?, ?, ?)
        ON CONFLICT(thread_id, key) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
      `).run(input.threadId, input.key, entry.updatedAt, JSON.stringify(entry))
      return entry
    })
  }

  get(threadId: string, key: string): MemoryEntry | null {
    const row = this.db.prepare(
      'SELECT * FROM thread_memories WHERE thread_id = ? AND key = ?',
    ).get(threadId, key) as unknown as ThreadMemoryRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as MemoryEntry)
  }

  list(threadId: string): MemoryEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM thread_memories WHERE thread_id = ? ORDER BY updated_at ASC',
    ).all(threadId) as unknown as ThreadMemoryRow[]
    return rows.map((row) => JSON.parse(row.data) as MemoryEntry)
  }

  delete(threadId: string, key: string): boolean {
    return this.db.prepare(
      'DELETE FROM thread_memories WHERE thread_id = ? AND key = ?',
    ).run(threadId, key).changes > 0
  }

  deleteThread(threadId: string): number {
    return Number(
      this.db.prepare('DELETE FROM thread_memories WHERE thread_id = ?').run(threadId).changes,
    )
  }
}
