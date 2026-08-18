/**
 * TaskProgressService — per-thread × per-cat task-progress snapshot Cordis service.
 *
 * Cordis wrapper around `ITaskProgressStore` (from `@flowforge/cats-stores`).
 * Provides owner-guarded cleanup and per-thread × per-cat snapshot reads.
 *
 * Used by:
 * - `QueueProcessorService` (batch 3.5) to record in-flight cat execution state
 * - `reconcileZombies` to detect snapshots whose owning invocation has died
 * - `getThreadSnapshots` powers the `/council` page's progress cards
 *
 * 对齐 dsh `@flowforge/jobs` 范式：抽象 `TaskProgressService extends Service`
 * 挂载到 `ctx.catsInvocationProgress`，具体实现继承本类并通过 `ctx.inject()`
 * 获取 `ITaskProgressStore` 依赖.
 *
 * @module @flowforge/cats-invocation/progress
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, InvocationId, ThreadId } from '@flowforge/cats-shared'
import type {
  ITaskProgressStore,
  SetSnapshotOptions,
  TaskProgressItem,
  TaskProgressSnapshot,
  TaskProgressStatus,
} from '@flowforge/cats-stores'

// Re-export store-side types for consumer convenience
export type {
  ITaskProgressStore,
  SetSnapshotOptions,
  TaskProgressItem,
  TaskProgressSnapshot,
  TaskProgressStatus,
}

/**
 * Abstract task-progress snapshot service.
 *
 * Subclass and implement the abstract methods, then load the subclass as a
 * plugin — it registers as `ctx.catsInvocationProgress`.
 *
 * The abstract class itself does NOT hold a store reference — concrete
 * implementations receive the store via `ctx.inject('catStores')` or
 * constructor injection, following the dsh `Service.inject` pattern.
 */
export abstract class TaskProgressService extends Service {
  constructor(ctx: Context) {
    if (new.target === TaskProgressService) {
      throw new Error(
        '@flowforge/cats-invocation/progress is the abstract task-progress seam; ' +
        'load a concrete implementation (e.g. MemoryTaskProgressService) instead',
      )
    }
    super(ctx, 'catsInvocationProgress')
  }

  /** Read the snapshot for (threadId, catId), or null if absent. */
  abstract getSnapshot(threadId: ThreadId, catId: CatId): Promise<TaskProgressSnapshot | null>

  /** Insert or replace the snapshot for (threadId, catId). */
  abstract setSnapshot(
    snapshot: TaskProgressSnapshot,
    options?: SetSnapshotOptions,
  ): Promise<void>

  /** Remove the snapshot for (threadId, catId). Idempotent. */
  abstract deleteSnapshot(threadId: ThreadId, catId: CatId): Promise<void>

  /**
   * Atomic CAS delete: remove the snapshot only if its `lastInvocationId`
   * still matches. Returns true on deletion, false on mismatch or absence.
   */
  abstract deleteSnapshotIfOwner(
    threadId: ThreadId,
    catId: CatId,
    invocationId: InvocationId,
  ): Promise<boolean>

  /** Read every snapshot for a thread (keyed by catId as string). */
  abstract getThreadSnapshots(
    threadId: ThreadId,
  ): Promise<Readonly<Record<string, TaskProgressSnapshot>>>

  /** Remove all snapshots for a thread (e.g. on thread archival). Idempotent. */
  abstract deleteThread(threadId: ThreadId): Promise<void>
}

declare module '@flowforge/cordis' {
  interface Context {
    catsInvocationProgress: TaskProgressService
  }
}

// ---------------------------------------------------------------------------
// Memory implementation (delegates to ITaskProgressStore)
// ---------------------------------------------------------------------------

/**
 * Memory-backed TaskProgressService implementation.
 *
 * Wraps an `ITaskProgressStore` (typically `MemoryTaskProgressStore` from
 * `@flowforge/cats-stores`). The store is injected via constructor —
 * this service is a thin Cordis adapter that mounts the store at
 * `ctx.catsInvocationProgress`.
 *
 * In a Cordis plugin graph, load this after `@flowforge/cats-stores`:
 * ```ts
 * ctx.plugin(CatStores)           // mounts ctx.catStores
 * ctx.plugin(MemoryTaskProgressService) // mounts ctx.catsInvocationProgress
 * ```
 */
export class MemoryTaskProgressService extends TaskProgressService {
  private readonly store: ITaskProgressStore

  constructor(ctx: Context, store: ITaskProgressStore) {
    super(ctx)
    this.store = store
  }

  override getSnapshot(threadId: ThreadId, catId: CatId): Promise<TaskProgressSnapshot | null> {
    return this.store.getSnapshot(threadId, catId)
  }

  override setSnapshot(
    snapshot: TaskProgressSnapshot,
    options?: SetSnapshotOptions,
  ): Promise<void> {
    return this.store.setSnapshot(snapshot, options)
  }

  override deleteSnapshot(threadId: ThreadId, catId: CatId): Promise<void> {
    return this.store.deleteSnapshot(threadId, catId)
  }

  override deleteSnapshotIfOwner(
    threadId: ThreadId,
    catId: CatId,
    invocationId: InvocationId,
  ): Promise<boolean> {
    return this.store.deleteSnapshotIfOwner(threadId, catId, invocationId)
  }

  override getThreadSnapshots(
    threadId: ThreadId,
  ): Promise<Readonly<Record<string, TaskProgressSnapshot>>> {
    return this.store.getThreadSnapshots(threadId)
  }

  override deleteThread(threadId: ThreadId): Promise<void> {
    return this.store.deleteThread(threadId)
  }
}
