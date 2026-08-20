/**
 * IThreadReadStateStore — per-user/per-thread read cursor port (F069).
 *
 * Ported from clowder-ai `ThreadReadStateStore.ts`
 * (api/src/domains/cats/services/stores/ports/) as a full branded contract
 * for stage-5 batch 1 (`@flowforge/chat-threads`). The Redis ACK_CAS_LUA
 * monotonic semantics are preserved: `ack` only ever advances the cursor.
 *
 * Promoted out of `stub-ports.ts` (the old permissive `IReadStateStore`).
 *
 * @module @flowforge/cats-stores/ports
 */

import type { IMessageStore } from './message-store.ts'

/** Persisted read cursor for one user × thread. */
export interface ThreadReadState {
  readonly userId: string
  readonly threadId: string
  /** Monotonic cursor — raw messageId (v1) or `v2:<seq16>:<messageId>`. */
  readonly lastReadMessageId: string
  readonly updatedAt: number
}

/** Unread badge projection for one thread. */
export interface ThreadUnreadSummary {
  readonly threadId: string
  readonly unreadCount: number
  readonly hasUserMention: boolean
}

export interface IThreadReadStateStore {
  /** Get read cursor for a user+thread. Returns null if never read. */
  get(userId: string, threadId: string): ThreadReadState | null | Promise<ThreadReadState | null>
  /** Ack: advance cursor (monotonic — only moves forward). Returns true if advanced. */
  ack(userId: string, threadId: string, messageId: string): boolean | Promise<boolean>
  /** Bulk get unread summaries for all threads of a user. */
  getUnreadSummaries(
    userId: string,
    threadIds: readonly string[],
    messageStore: IMessageStore,
  ): ThreadUnreadSummary[] | Promise<ThreadUnreadSummary[]>
  /** Cleanup: delete read state for a thread (cascade on thread delete). */
  deleteByThread(threadId: string): void | Promise<void>
  /**
   * #1200: Atomic cursor format reconciliation — upgrade v1 → v2 without
   * advancing. CAS: SET newV2 IF current === oldV1. Returns true if
   * reconciled. Optional: implementations without cross-format concern may
   * omit.
   */
  reconcileReadCursor?(
    userId: string,
    threadId: string,
    oldV1: string,
    newV2: string,
  ): boolean | Promise<boolean>
}
