/**
 * Zombie reconciliation — orphan invocation cleanup pure functions.
 *
 * Ported from clowder-ai `reconcileZombies.ts` + `convergeZombieQueue.ts`
 * (api/src/domains/cats/services/agents/invocation/), adapted to:
 * - Dependency-injection style (dsh 范式): all external touchpoints (store
 *   updates, task-progress cleanup, queue convergence, logging, side-effect
 *   hooks) are injected as callbacks — this module is a **pure** orchestrator
 *   with no Cordis / store / socket coupling.
 * - Branded types (`InvocationId` / `ThreadId` / `CatId` / `UserId`) and the
 *   `ReconcileZombieDeps` / `ReconcileZombieResult` / `ZombieRecord` contracts
 *   from `@flowforge/cats-shared`.
 *
 * Semantics preserved:
 * - Idempotent: `IInvocationRecordStore.update` CAS + state-machine guards make
 *   repeated sweeps of the same zombie a safe no-op.
 * - Running zombies → `failed(error='zombie_record_detected')`.
 * - TaskProgress snapshots cleared per-cat (owner-guarded).
 * - F220 Phase 2a (#972): stale `processing` queue entries for the dead
 *   invocation are converged so later user work stops queuing behind a corpse.
 *
 * @module @flowforge/cats-invocation/reconcile
 */

import type {
  CatId,
  InvocationId,
  PerZombieOutcome,
  QueueEntry,
  ReconcileZombieDeps,
  ReconcileZombieResult,
  ThreadId,
  UserId,
  ZombieRecord,
} from '@flowforge/cats-shared'

/** Error reason stamped onto zombie records when reconciled. */
const ZOMBIE_ERROR = 'zombie_record_detected'

// ---------------------------------------------------------------------------
// Queue convergence (F220 Phase 2a, clowder-ai#972)
// ---------------------------------------------------------------------------

/**
 * Minimal queue surface needed to converge a dead invocation's stale entry.
 *
 * Deliberately scoped (not the full {@link InvocationQueueService}) so the
 * reconciler stays decoupled — a caller wires the real queue into this seam.
 */
export interface ZombieQueueConverger {
  list(threadId: ThreadId, userId: UserId): readonly QueueEntry[]
  /** Remove a `processing` entry; returns the entry or null if absent/already terminal. */
  removeProcessed(threadId: ThreadId, userId: UserId, entryId: string): QueueEntry | null
}

/** Fired once per thread whose queue actually changed (side-effect hook). */
export type QueueConvergedHandler = (info: {
  readonly threadId: ThreadId
  readonly userId: UserId
  readonly removedEntryIds: readonly string[]
}) => void

/**
 * Remove the dead invocation's stale `processing` queue entry.
 *
 * QueueEntry has no invocation id, so the trigger user-message id is the join
 * key: it matches `entry.userMessageId` or `entry.mergedMessageIds`. Removal is
 * exact-id and processing-only — a concurrent replacement tombstone degrades
 * to `null` without a duplicate broadcast.
 */
export function convergeZombieQueueEntry(
  queue: ZombieQueueConverger | undefined,
  record: { readonly threadId: ThreadId; readonly userId: UserId; readonly userMessageId?: string | null },
  zombie: { readonly invocationId: InvocationId; readonly reason: string },
  log: { readonly info: (msg: string) => void; readonly warn: (msg: string) => void },
  onQueueConverged: QueueConvergedHandler | undefined,
): { converged: number; errors: number } {
  if (!queue) return { converged: 0, errors: 0 }
  const messageId = record.userMessageId
  if (!messageId) return { converged: 0, errors: 0 }

  try {
    const stale = queue
      .list(record.threadId, record.userId)
      .filter(
        (entry) =>
          entry.processingStartedAt !== undefined &&
          entry.processedAt === undefined &&
          (entry.userMessageId === messageId || entry.mergedMessageIds?.includes(messageId)),
      )

    const removedEntryIds: string[] = []
    for (const entry of stale) {
      if (queue.removeProcessed(record.threadId, record.userId, entry.id)) {
        removedEntryIds.push(entry.id)
        log.info(
          `[reconcile-zombies] converged stale processing queue entry ${entry.id} ` +
            `(message ${messageId}, thread ${record.threadId}, reason ${zombie.reason})`,
        )
      }
    }

    if (removedEntryIds.length > 0) {
      onQueueConverged?.({ threadId: record.threadId, userId: record.userId, removedEntryIds })
    }
    return { converged: removedEntryIds.length, errors: 0 }
  } catch (err) {
    log.warn(
      `[reconcile-zombies] failed to converge queue entry for invocation ` +
        `${zombie.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { converged: 0, errors: 1 }
  }
}

/**
 * Wrap a {@link ZombieQueueConverger} into the deps-agnostic
 * `ReconcileZombieDeps.convergeQueueEntry` callback shape.
 *
 * Because a zombie record lacks its own user-message id (the join key lives on
 * the InvocationRecord), callers that have the record pass it here to produce a
 * self-contained callback for `reconcileZombies()`.
 */
export function makeConvergeQueueEntry(
  queue: ZombieQueueConverger | undefined,
  record: { readonly threadId: ThreadId; readonly userId: UserId; readonly userMessageId?: string | null },
  log: { readonly info: (msg: string) => void; readonly warn: (msg: string) => void },
  onQueueConverged?: QueueConvergedHandler,
): ((invocationId: InvocationId, reason: string) => Promise<{ converged: number; errors: number }>) | undefined {
  if (!queue || !record.userMessageId) return undefined
  return (invocationId, reason) =>
    Promise.resolve(convergeZombieQueueEntry(queue, record, { invocationId, reason }, log, onQueueConverged))
}

// ---------------------------------------------------------------------------
// Task progress cleanup
// ---------------------------------------------------------------------------

async function clearTaskProgress(
  deps: ReconcileZombieDeps,
  threadId: ThreadId,
  invocationId: InvocationId,
  targetCats: readonly CatId[],
  log: { readonly warn: (msg: string) => void },
): Promise<{ cleared: number; errors: number }> {
  if (!deps.clearTaskProgress) return { cleared: 0, errors: 0 }
  let cleared = 0
  let errors = 0
  for (const catId of new Set(targetCats)) {
    try {
      const deleted = await deps.clearTaskProgress(threadId, catId)
      if (deleted) cleared += 1
    } catch (err) {
      errors += 1
      log.warn(
        `[reconcile-zombies] failed to clear TaskProgress for invocation ` +
          `${invocationId} cat ${catId}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return { cleared, errors }
}

function taskProgressTargets(targetCats: readonly CatId[], detectorCatIds: readonly CatId[]): CatId[] {
  const durable = [...new Set(targetCats)]
  if (durable.length > 0) return durable
  return [...new Set(detectorCatIds)]
}

// ---------------------------------------------------------------------------
// reconcileZombies
// ---------------------------------------------------------------------------

/**
 * Clean up a list of zombie records produced by the liveness read model.
 *
 * Idempotent: safe to call multiple times for the same zombie. CAS + state
 * machine guards in the underlying store prevent double-writes.
 *
 * All external effects (store update, task-progress clear, queue convergence,
 * side-effect hook, logging) are injected via {@link ReconcileZombieDeps}, so
 * this function is pure and testable in isolation (对齐 dsh 插件范式).
 */
export async function reconcileZombies(
  zombies: readonly ZombieRecord[],
  deps: ReconcileZombieDeps,
): Promise<ReconcileZombieResult> {
  const log = deps.log ?? {
    info: (): void => {},
    warn: (msg: string): void => console.warn(msg),
  }

  let reconciled = 0
  let alreadyTerminal = 0
  let taskProgressCleared = 0
  let queueConverged = 0
  let errors = 0
  const details: PerZombieOutcome[] = []
  const start = Date.now()
  const now = (): number => Date.now()

  for (const zombie of zombies) {
    const targetCats = zombie.catIds
    try {
      const update = await deps.updateInvocation(zombie.invocationId, {
        status: 'failed',
        // CAS-guard against the zombie's recorded current status — a `queued`
        // zombie and a `running` zombie target different prior states.
        expectedStatus: zombie.status === 'queued' ? 'queued' : 'running',
        error: zombie.status === 'queued' ? 'stale_queued' : ZOMBIE_ERROR,
      })

      if (update.outcome !== 'updated') {
        // CAS/recovery path: either the record is already terminal (a concurrent
        // reconcile flipped it), missing, or still alive. For terminal records,
        // re-attempt best-effort cleanup; the store guards prevent double-writes.
        const settled = update.outcome === 'missing' || update.outcome === 'cas_mismatch'
        alreadyTerminal += 1
        details.push({ invocationId: zombie.invocationId, outcome: 'already_terminal' })
        if (settled) {
          const tp = await clearTaskProgress(deps, zombie.threadId, zombie.invocationId, targetCats, log)
          taskProgressCleared += tp.cleared
          errors += tp.errors
        }
        // invalid_transition: record is terminal by state machine — also count as settled
        continue
      }

      reconciled += 1
      taskProgressCleared += (await clearTaskProgress(deps, zombie.threadId, zombie.invocationId, targetCats, log)).cleared

      // F220 Phase 2a: converge the now-dead invocation's stale queue entry.
      if (deps.convergeQueueEntry) {
        try {
          const qc = await deps.convergeQueueEntry(zombie.invocationId)
          queueConverged += qc.converged
          errors += qc.errors
        } catch (err) {
          errors += 1
          log.warn(
            `[reconcile-zombies] failed to converge queue entry for invocation ` +
              `${zombie.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      details.push({ invocationId: zombie.invocationId, outcome: 'reconciled' })

      if (deps.onReconciledZombie) {
        try {
          await deps.onReconciledZombie({
            invocationId: zombie.invocationId,
            threadId: zombie.threadId,
            catIds: targetCats,
            from: 'running',
            to: 'failed',
          })
        } catch (err) {
          errors += 1
          log.warn(
            `[reconcile-zombies] onReconciledZombie callback failed for invocation ` +
              `${zombie.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    } catch (err) {
      errors += 1
      details.push({
        invocationId: zombie.invocationId,
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
      log.warn(
        `[reconcile-zombies] failed to reconcile invocation ${zombie.invocationId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const result: ReconcileZombieResult = {
    reconciled,
    alreadyTerminal,
    taskProgressCleared,
    queueConverged,
    errors,
    details,
  }

  if (zombies.length > 0) {
    log.info(
      `[reconcile-zombies] sweep complete: ${reconciled} reconciled, ${alreadyTerminal} already-terminal, ` +
        `${taskProgressCleared} task-progress cleared, ${queueConverged} queue entries converged, ` +
        `${errors} errors, ${now() - start}ms`,
    )
  }

  return result
}

// Re-export shared zombie types for consumer convenience.
export type {
  CatId,
  InvocationId,
  PerZombieOutcome,
  QueueEntry,
  ReconcileZombieDeps,
  ReconcileZombieResult,
  ThreadId,
  UserId,
  ZombieRecord,
}