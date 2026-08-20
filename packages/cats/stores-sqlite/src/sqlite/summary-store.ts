/**
 * SqliteSummaryStore — durable ISummaryStore（拍立得照片墙，批次 6.5）.
 *
 * 语义对齐 `@flowforge/cats-stores` Memory 版（批次 5.2）。差异：持久化
 * 存储无容量上限，不保留 MAX=200 的 FIFO 驱逐 —— 历史照片全量保留，
 * `listByThread` 按 created_at 升序（创建序，最旧在前）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateId } from '@flowforge/cats-shared'
import type { CreateSummaryInput, ThreadSummary } from '@flowforge/cats-shared'
import type { ISummaryStore } from '@flowforge/cats-stores/ports'

/** Row shape of the `summaries` table. */
interface SummaryRow {
  readonly id: string
  readonly thread_id: string
  readonly created_at: number
  readonly data: string
}

/** Durable thread-summary store backed by SQLite. */
export class SqliteSummaryStore implements ISummaryStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateSummaryInput): ThreadSummary {
    const summary: ThreadSummary = {
      id: generateId('summary'),
      threadId: input.threadId,
      topic: input.topic,
      conclusions: [...input.conclusions],
      openQuestions: [...input.openQuestions],
      createdAt: Date.now(),
      createdBy: input.createdBy,
    }
    this.db.prepare(`
      INSERT INTO summaries (id, thread_id, created_at, data)
      VALUES (?, ?, ?, ?)
    `).run(summary.id, summary.threadId, summary.createdAt, JSON.stringify(summary))
    return { ...summary }
  }

  get(summaryId: string): ThreadSummary | null {
    const row = this.db.prepare(
      'SELECT * FROM summaries WHERE id = ?',
    ).get(summaryId) as unknown as SummaryRow | undefined
    if (row === undefined) return null
    const summary = JSON.parse(row.data) as ThreadSummary
    return { ...summary }
  }

  listByThread(threadId: string): ThreadSummary[] {
    const rows = this.db.prepare(
      'SELECT * FROM summaries WHERE thread_id = ? ORDER BY created_at ASC',
    ).all(threadId) as unknown as SummaryRow[]
    return rows.map((row) => {
      const summary = JSON.parse(row.data) as ThreadSummary
      return { ...summary }
    })
  }

  delete(summaryId: string): boolean {
    return this.db.prepare('DELETE FROM summaries WHERE id = ?').run(summaryId).changes > 0
  }
}
