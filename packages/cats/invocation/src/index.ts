/**
 * @flowforge/cats-invocation — Forgekin (cats) invocation queue / tracker / mutex /
 * progress Cordis service seam.
 *
 * Architecture (对齐 dsh `@flowforge/jobs` 范式):
 * - This package is the **abstract seam** — it declares the `CatsInvocation`
 *   aggregate Service contract and mounts the empty aggregate at
 *   `ctx.catsInvocation`. Concrete sub-services (queue / tracker / mutex /
 *   progress / processor) are added in batch 3.4+ as `Service` subclasses
 *   registered via `ctx.plugin()` and exposed as accessors on the aggregate.
 * - Concrete in-memory implementations may live in a sibling package
 *   (cf. dsh `jobs` → `jobs-local`) or inline in this package — to be
 *   decided by batch 3.4.
 * - Sub-services persist through `ctx.catStores` (invocation records, task
 *   progress, managed-work registrations) and process-local state (per-thread
 *   FIFO queues, per-session mutex locks, per-slot trackers).
 *
 * Consumers must load a concrete implementation plugin:
 * ```ts
 * import { CatsInvocation } from '@flowforge/cats-invocation'
 * // import { MemoryCatsInvocation } from '@flowforge/cats-invocation-local' // batch 3.6+
 * ctx.plugin(CatsInvocation)
 * // ctx.plugin(MemoryCatsInvocation) // mounts queue/tracker/mutex/progress/processor
 * ```
 *
 * @module @flowforge/cats-invocation
 */

import { Context, Service } from '@flowforge/cordis'

// Import sub-service types for use in CatsInvocation aggregate accessors.
// (re-export below also exposes them to consumers)
import type { InvocationQueueService } from './queue.ts'
import type { InvocationTrackerService } from './tracker.ts'
import type { SessionMutexService } from './mutex.ts'
import type { TaskProgressService } from './progress.ts'
import type { QueueProcessorService } from './processor.ts'

// Re-export shared invocation types + state machine for consumer convenience.
// Pure functions + constants use `export { ... }`; types use `export type { ... }`.
export {
  classifyInvocationRecoveryStatus,
  isValidTransition,
  VALID_TRANSITIONS,
} from '@flowforge/cats-shared'
export type {
  CreateInvocationInput,
  CreateInvocationOutcome,
  InvocationActionLeaseCarrier,
  InvocationId,
  InvocationRecord,
  InvocationSource,
  InvocationSourceCategory,
  InvocationStatus,
  UpdateInvocationInput,
  UpdateInvocationOutcome,
} from '@flowforge/cats-shared'
export {
  createInvocationId,
  generateInvocationId,
} from '@flowforge/cats-shared'
export type {
  EnqueueOutcome,
  EnqueueResult,
  QueueEntry,
  QueueEntryId,
} from '@flowforge/cats-shared'
export {
  createQueueEntryId,
  generateQueueEntryId,
  MAX_QUEUE_DEPTH,
} from '@flowforge/cats-shared'
export type {
  ForceReleaseOptions,
  ForceReleaseResult,
  SessionLockCancelReason,
  SessionLockOwner,
  SessionLockScope,
} from '@flowforge/cats-shared'
export type {
  InvocationRecoveryStatus,
  LiveInvocation,
  LivenessReason,
  ReconcileZombieResult,
  ZombieReason,
  ZombieRecord,
} from '@flowforge/cats-shared'

// Re-export store ports that the invocation services depend on.
export type {
  IInvocationRecordStore,
  StoreCreateInvocationOutcome,
  StoreUpdateInvocationInput,
  StoreUpdateInvocationOutcome,
} from '@flowforge/cats-stores'
export type {
  ITaskProgressStore,
  SetSnapshotOptions,
  TaskProgressItem,
  TaskProgressSnapshot,
  TaskProgressStatus,
} from '@flowforge/cats-stores'
export type {
  ITaskManagedWorkRegistrationStore,
  ManagedWorkBindingConflict,
  UpsertManagedWorkBindingOutcome,
} from '@flowforge/cats-stores'

// Re-export queue service (batch 3.4)
export {
  InvocationQueueService,
  MemoryInvocationQueueService,
} from './queue.ts'
export type { EnqueueInput } from './queue.ts'

// Re-export tracker service (batch 3.4)
export {
  DEFAULT_INVOCATION_SLOT_TTL_MS,
  InvocationTrackerService,
  MemoryInvocationTrackerService,
} from './tracker.ts'
export type {
  ActiveSlotInfo,
  BatchGateStatus,
  CancelAllResult,
  CancelResult,
  DeleteGuard,
  ExactExecutionOwnerState,
  ExecutionOwnerMatch,
  FinalInvocationStatus,
  SlotState,
} from './tracker.ts'

// Re-export mutex service (batch 3.4)
export {
  MemorySessionMutexService,
  SessionMutexService,
} from './mutex.ts'

// Re-export progress service (batch 3.4)
export {
  MemoryTaskProgressService,
  TaskProgressService,
} from './progress.ts'

// Re-export processor service (batch 3.5 — abstract skeleton)
export {
  QueueProcessorService,
} from './processor.ts'
export type { InvocationCompleteInput, ProcessNextResult } from './processor.ts'

// Re-export zombie reconciliation pure functions (batch 3.5)
export {
  convergeZombieQueueEntry,
  makeConvergeQueueEntry,
  reconcileZombies,
} from './reconcile.ts'
export type { QueueConvergedHandler, ZombieQueueConverger } from './reconcile.ts'

// Re-export startup orphan sweep (batch 3.5)
export {
  runStartupSweep,
} from './startup-reconciler.ts'
export type { StartupReconcilerDeps, StartupSweepResult } from './startup-reconciler.ts'

/**
 * Aggregate Cordis service that owns the cats invocation sub-services.
 *
 * Mounted at `ctx.catsInvocation` by the default plugin. Sub-services
 * (queue / tracker / mutex / progress / processor) are exposed as
 * accessors — they are registered by concrete implementation plugins
 * (batch 3.4+) via `registerQueue()`, `registerTracker()`, etc.
 *
 * Until a concrete sub-service is registered, accessing it throws —
 * this mirrors the dsh `JobRegistry` abstract-seam pattern where loading
 * the abstract package alone is a configuration error.
 */
export class CatsInvocation extends Service {
  constructor(ctx: Context) {
    // `abstract` erases at runtime — a composition row naming this package
    // would register `ctx.catsInvocation` with no sub-services and fail far
    // from the misconfiguration. Fail loud at load instead.
    if (new.target === CatsInvocation) {
      throw new Error(
        '@flowforge/cats-invocation is the abstract invocation aggregate seam; ' +
        'load a concrete implementation plugin (batch 3.4+) that mounts queue / ' +
        'tracker / mutex / progress / processor sub-services instead',
      )
    }
    super(ctx, 'catsInvocation')
  }

  /**
   * Per-thread × per-user FIFO queue (the "who is waiting" half of the
   * invocation model). Complements `tracker()` (the "who is running" half).
   *
   * Concrete plugins (batch 3.6+) register the sub-service via
   * `ctx.catsInvocationQueue` — this accessor throws until that happens.
   */
  get queue(): InvocationQueueService {
    const svc = this.ctx.get('catsInvocationQueue')
    if (!svc) {
      throw new Error(
        '@flowforge/cats-invocation: queue sub-service not registered; ' +
        'load MemoryInvocationQueueService (or a concrete backend) first',
      )
    }
    return svc as InvocationQueueService
  }

  /**
   * Per-slot mutex + AbortController tracker for live invocations.
   * Complements `queue()` — the queue admits new work, the tracker
   * serializes per-thread × per-cat execution.
   */
  get tracker(): InvocationTrackerService {
    const svc = this.ctx.get('catsInvocationTracker')
    if (!svc) {
      throw new Error(
        '@flowforge/cats-invocation: tracker sub-service not registered; ' +
        'load MemoryInvocationTrackerService (or a concrete backend) first',
      )
    }
    return svc as InvocationTrackerService
  }

  /**
   * Per-cliSessionId serialization lock preventing concurrent resume of
   * the same CLI session. Scope: process-level (same lifetime as tracker).
   */
  get mutex(): SessionMutexService {
    const svc = this.ctx.get('catsInvocationMutex')
    if (!svc) {
      throw new Error(
        '@flowforge/cats-invocation: mutex sub-service not registered; ' +
        'load MemorySessionMutexService (or a concrete backend) first',
      )
    }
    return svc as SessionMutexService
  }

  /**
   * Task progress snapshots — Cordis wrapper around `ITaskProgressStore`
   * providing owner-guarded cleanup and per-thread × per-cat snapshot reads.
   */
  get progress(): TaskProgressService {
    const svc = this.ctx.get('catsInvocationProgress')
    if (!svc) {
      throw new Error(
        '@flowforge/cats-invocation: progress sub-service not registered; ' +
        'load MemoryTaskProgressService (or a concrete backend) first',
      )
    }
    return svc as TaskProgressService
  }

  /**
   * Queue processor + zombie reconciler. Drains the queue, runs invocations
   * under the tracker's slot mutex, and reconciles zombies on startup.
   *
   * Registered by a concrete implementation plugin (batch 3.6+) at
   * `ctx.catsInvocationProcessor`.
   */
  get processor(): QueueProcessorService {
    const svc = this.ctx.get('catsInvocationProcessor')
    if (!svc) {
      throw new Error(
        '@flowforge/cats-invocation: processor sub-service not registered; ' +
        'load a concrete QueueProcessorService implementation first',
      )
    }
    return svc as QueueProcessorService
  }
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) invocation aggregate — mounted by
     * `@flowforge/cats-invocation`. Sub-services are registered by a
     * concrete implementation plugin (batch 3.4+).
     */
    catsInvocation: CatsInvocation
  }
}

export default CatsInvocation
