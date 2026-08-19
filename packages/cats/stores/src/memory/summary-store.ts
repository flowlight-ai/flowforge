/**
 * MemorySummaryStore — in-memory ISummaryStore (拍立得照片墙).
 *
 * Ported from clowder-ai `InMemorySummaryStore` (inside `SummaryStore.ts`).
 * Bounded with FIFO eviction (clowder-ai default MAX=200) so a long-running
 * dev process cannot grow unbounded.
 *
 * @module @flowforge/cats-stores/memory
 */

import { generateId, type CreateSummaryInput, type ThreadSummary } from '@flowforge/cats-shared'
import type { ISummaryStore } from '../ports/summary-store.ts'

const DEFAULT_MAX_SUMMARIES = 200

/** In-memory implementation for tests and single-process dev. */
export class MemorySummaryStore implements ISummaryStore {
  private readonly summaries = new Map<string, ThreadSummary>()

  constructor(private readonly max: number = DEFAULT_MAX_SUMMARIES) {}

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
    this.summaries.set(summary.id, summary)
    // FIFO eviction — Map preserves insertion order.
    while (this.summaries.size > this.max) {
      const oldestKey = this.summaries.keys().next().value
      if (oldestKey === undefined) break
      this.summaries.delete(oldestKey)
    }
    return { ...summary }
  }

  get(summaryId: string): ThreadSummary | null {
    const found = this.summaries.get(summaryId)
    return found ? { ...found } : null
  }

  listByThread(threadId: string): ThreadSummary[] {
    const result: ThreadSummary[] = []
    for (const summary of this.summaries.values()) {
      if (summary.threadId === threadId) result.push({ ...summary })
    }
    // Creation order, oldest first (insertion order already guarantees this).
    return result
  }

  delete(summaryId: string): boolean {
    return this.summaries.delete(summaryId)
  }
}
