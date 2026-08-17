/**
 * ITaskProgressStore — per-thread × per-cat task-progress snapshot port.
 *
 * Ported from clowder-ai `TaskProgressStore.ts`
 * (api/src/domains/cats/services/agents/invocation/), using branded types
 * from `@flowforge/cats-shared` (CatId / ThreadId / InvocationId).
 *
 * Used by:
 * - `QueueProcessorService` to record in-flight cat execution state
 * - `reconcileZombies` to detect snapshots whose owning invocation has died
 * - `getThreadSnapshots` powers the `/council` page's progress cards
 *
 * The `deleteSnapshotIfOwner` method MUST be atomic: zombie cleanup races
 * with same-cat replacement snapshots, so the comparison + deletion must
 * happen in one CAS step (Memory: synchronous Map ops; Sqlite: transaction).
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId, InvocationId, ThreadId } from '@flowforge/cats-shared'

/** Coarse lifecycle of a per-cat task snapshot. */
export type TaskProgressStatus = 'running' | 'completed' | 'interrupted'

/** A single tracked task within a snapshot (e.g. one PR review check). */
export interface TaskProgressItem {
  readonly id: string
  readonly subject: string
  readonly status: string
  readonly activeForm?: string | undefined
}

/** Immutable snapshot of one cat's task progress in one thread. */
export interface TaskProgressSnapshot {
  readonly threadId: ThreadId
  readonly catId: CatId
  readonly tasks: readonly TaskProgressItem[]
  readonly status: TaskProgressStatus
  readonly updatedAt: number
  /** Last invocation that wrote this snapshot — used by `deleteSnapshotIfOwner`. */
  readonly lastInvocationId?: InvocationId | undefined
  readonly interruptReason?: string | undefined
}

/** Optional TTL hint passed by the writer. Backends may ignore it (Memory does). */
export interface SetSnapshotOptions {
  readonly ttlSeconds?: number
}

/**
 * Port for the task-progress store.
 *
 * All methods are async to keep the contract uniform across Memory (sync
 * underneath) and future Sqlite/Redis backends.
 */
export interface ITaskProgressStore {
  /** Read the snapshot for (threadId, catId), or null if absent. */
  getSnapshot(threadId: ThreadId, catId: CatId): Promise<TaskProgressSnapshot | null>

  /**
   * Insert or replace the snapshot for (threadId, catId).
   * The store does not merge — callers compose the full snapshot.
   */
  setSnapshot(snapshot: TaskProgressSnapshot, options?: SetSnapshotOptions): Promise<void>

  /** Remove the snapshot for (threadId, catId). Idempotent. */
  deleteSnapshot(threadId: ThreadId, catId: CatId): Promise<void>

  /**
   * Atomic CAS delete: remove the snapshot only if its `lastInvocationId`
   * still matches. Returns true on deletion, false on mismatch or absence.
   * Prevents zombie cleanup from clobbering a fresh replacement snapshot.
   */
  deleteSnapshotIfOwner(
    threadId: ThreadId,
    catId: CatId,
    invocationId: InvocationId,
  ): Promise<boolean>

  /** Read every snapshot for a thread (keyed by catId as string). */
  getThreadSnapshots(threadId: ThreadId): Promise<Readonly<Record<string, TaskProgressSnapshot>>>

  /** Remove all snapshots for a thread (e.g. on thread archival). Idempotent. */
  deleteThread(threadId: ThreadId): Promise<void>
}
