/**
 * SqliteThreadReadStateStore — durable IThreadReadStateStore（F069，批次52）.
 *
 * 语义对齐 `@flowforge/cats-stores` Memory 版：ack 单调 CAS（lex 比较，
 * 只前进不后退）；reconcileReadCursor 为 v1→v2 无前进 CAS 换写。
 * getUnreadSummaries 依赖调用方注入 IMessageStore（端口设计，本 store 无耦合）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { inImmediateTransaction } from '../schema.ts'
import type { IMessageStore } from '@flowforge/cats-stores/ports'
import type {
  IThreadReadStateStore,
  ThreadReadState,
  ThreadUnreadSummary,
} from '@flowforge/cats-stores/ports'

interface ReadStateRow {
  readonly user_id: string
  readonly thread_id: string
  readonly last_read_message_id: string
  readonly updated_at: number
}

export class SqliteThreadReadStateStore implements IThreadReadStateStore {
  constructor(private readonly db: DatabaseSync) {}

  get(userId: string, threadId: string): ThreadReadState | null {
    const row = this.db.prepare(
      'SELECT * FROM thread_read_states WHERE user_id = ? AND thread_id = ?',
    ).get(userId, threadId) as unknown as ReadStateRow | undefined
    if (row === undefined) return null
    return {
      userId: row.user_id,
      threadId: row.thread_id,
      lastReadMessageId: row.last_read_message_id,
      updatedAt: row.updated_at,
    }
  }

  ack(userId: string, threadId: string, messageId: string): boolean {
    return inImmediateTransaction(this.db, () => {
      const existing = this.get(userId, threadId)
      if (existing === null) {
        this.db.prepare(`
          INSERT INTO thread_read_states (user_id, thread_id, last_read_message_id, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(userId, threadId, messageId, Date.now())
        return true
      }
      // Monotonic CAS — only move forward (mirrors ACK_CAS_LUA fail-closed).
      if (!(messageId > existing.lastReadMessageId)) return false
      this.db.prepare(`
        UPDATE thread_read_states SET last_read_message_id = ?, updated_at = ?
        WHERE user_id = ? AND thread_id = ?
      `).run(messageId, Date.now(), userId, threadId)
      return true
    })
  }

  async getUnreadSummaries(
    userId: string,
    threadIds: readonly string[],
    messageStore: IMessageStore,
  ): Promise<ThreadUnreadSummary[]> {
    const summaries: ThreadUnreadSummary[] = []
    for (const threadId of threadIds) {
      const state = this.get(userId, threadId)
      const cursor = state?.lastReadMessageId ?? null
      const messages = await Promise.resolve(
        messageStore.getByThreadAfter(threadId, cursor ?? undefined, 500, userId),
      )
      let hasUserMention = false
      let unreadCount = 0
      for (const msg of messages) {
        unreadCount++
        if (msg.mentionsUser) hasUserMention = true
      }
      summaries.push({ threadId, unreadCount, hasUserMention })
    }
    return summaries
  }

  deleteByThread(threadId: string): void {
    this.db.prepare('DELETE FROM thread_read_states WHERE thread_id = ?').run(threadId)
  }

  reconcileReadCursor(userId: string, threadId: string, oldV1: string, newV2: string): boolean {
    const result = this.db.prepare(`
      UPDATE thread_read_states SET last_read_message_id = ?, updated_at = ?
      WHERE user_id = ? AND thread_id = ? AND last_read_message_id = ?
    `).run(newV2, Date.now(), userId, threadId, oldV1)
    return result.changes > 0
  }
}
