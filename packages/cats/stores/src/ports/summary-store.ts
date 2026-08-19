/**
 * ISummaryStore — discussion summary store port (拍立得照片墙).
 *
 * Ported from clowder-ai `stores/ports/SummaryStore.ts` (batch 5.2 — promoted
 * from the permissive stub to the full branded contract used by
 * `@flowforge/cats-orchestration` AutoSummarizerService).
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CreateSummaryInput, ThreadSummary } from '@flowforge/cats-shared'

/**
 * Common interface for summary stores. In-memory implementations are bounded
 * (clowder-ai default MAX=200, FIFO eviction).
 */
export interface ISummaryStore {
  /** Create a summary; id/createdAt are store-owned. */
  create(input: CreateSummaryInput): ThreadSummary | Promise<ThreadSummary>
  /** Get a summary by ID. */
  get(summaryId: string): ThreadSummary | null | Promise<ThreadSummary | null>
  /** List summaries for a thread in creation order (oldest first). */
  listByThread(threadId: string): ThreadSummary[] | Promise<ThreadSummary[]>
  /** Delete a summary by ID. Returns whether it existed. */
  delete(summaryId: string): boolean | Promise<boolean>
}
