/**
 * QueueProcessorService — queue drain + invocation dispatch Cordis service.
 *
 * The "who runs next" engine. Drains the {@link InvocationQueueService}, starts
 * invocations under the {@link InvocationTrackerService}'s slot mutex, and
 * reconciles zombies on startup.
 *
 * 对齐 dsh `@flowforge/jobs` 范式：抽象 `QueueProcessorService extends Service`
 * 挂载到 `ctx.catsInvocationProcessor`.
 *
 * **Batch 3.5 scope**: minimal abstract skeleton — declares the contract that
 * concrete implementations (batch 3.6+) must satisfy. The full QueueProcessor
 * from clowder-ai is ~2500 lines and depends on router / socketManager /
 * messageStore / outbound hooks / freshness closures / turn execution stores
 * — all of which are ported in later stages. This skeleton defines the seam
 * so downstream packages can depend on `ctx.catsInvocationProcessor` without
 * waiting for the full implementation.
 *
 * @module @flowforge/cats-invocation/processor
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, ThreadId, UserId } from '@flowforge/cats-shared'
import type { QueueEntry } from '@flowforge/cats-shared'

/** Result of `processNext()` — whether a new invocation was started. */
export interface ProcessNextResult {
  readonly started: boolean
  readonly entry?: QueueEntry | undefined
}

/** Result of `onInvocationComplete()` — side-effect confirmation. */
export interface InvocationCompleteInput {
  readonly threadId: ThreadId
  readonly catId: CatId
  readonly status: 'succeeded' | 'failed' | 'canceled' | 'canceled_by_user'
  readonly invocationId?: string | undefined
  readonly completedCatIds: readonly CatId[]
  readonly primaryEntryRequeued?: boolean | undefined
  readonly terminalInvocationIdByCatId?: Readonly<Record<string, string>> | undefined
  readonly attemptedQueueEntryIds?: readonly string[] | undefined
}

/**
 * Abstract queue processor service.
 *
 * Subclass and implement the abstract methods, then load the subclass as a
 * plugin — it registers as `ctx.catsInvocationProcessor`.
 *
 * The concrete implementation (batch 3.6+) will depend on:
 * - `ctx.catsInvocationQueue` (InvocationQueueService)
 * - `ctx.catsInvocationTracker` (InvocationTrackerService)
 * - `ctx.catsInvocationMutex` (SessionMutexService)
 * - `ctx.catStores` (invocation records, task progress)
 * - Router / socket manager / message store (ported in later stages)
 */
export abstract class QueueProcessorService extends Service {
  constructor(ctx: Context) {
    if (new.target === QueueProcessorService) {
      throw new Error(
        '@flowforge/cats-invocation/processor is the abstract queue processor seam; ' +
        'load a concrete implementation (batch 3.6+) instead',
      )
    }
    super(ctx, 'catsInvocationProcessor')
  }

  /**
   * System-level entry: called when an invocation completes.
   * On `succeeded`, auto-dequeues the next entry for the same (threadId, userId).
   */
  abstract onInvocationComplete(input: InvocationCompleteInput): Promise<void>

  /**
   * User-level entry: co-creator manually triggers processing the next
   * queued entry for their scope.
   */
  abstract processNext(threadId: ThreadId, userId: UserId): Promise<ProcessNextResult>

  /** Whether a thread has any queued entries. */
  abstract hasQueuedForThread(threadId: ThreadId): boolean

  /** Whether a thread has any active (running) execution. */
  abstract hasActiveExecution(threadId: ThreadId): boolean

  /** Whether a specific cat is busy (active or queued) in a thread. */
  abstract isCatBusy(threadId: ThreadId, catId: CatId): boolean

  /** Whether a thread is currently being processed (any slot active). */
  abstract isThreadBusy(threadId: ThreadId): boolean
}

declare module '@flowforge/cordis' {
  interface Context {
    catsInvocationProcessor: QueueProcessorService
  }
}
