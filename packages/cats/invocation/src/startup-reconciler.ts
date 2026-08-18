/**
 * StartupReconciler — orphan invocation sweep on process startup.
 *
 * Ported from clowder-ai `StartupReconciler.ts`
 * (api/src/domains/cats/services/agents/invocation/), F048 Phase A + A+.
 *
 * On API/process startup, this sweeps invocation records orphaned by a crash or
 * restart and converges them to a stable terminal status:
 * - `running` → `failed(error='zombie_record_detected')`
 * - stale `queued` (> threshold) → `failed(error='stale_queued')`
 *
 * Rather than re-implementing the per-record mark-failed logic, this composes
 * the pure `reconcileZombies()` orchestrator ({@link ./reconcile}): it scans
 * live non-terminal records, maps them to `ZombieRecord[]`, and delegates.
 * Message recovery / socket notification / durable queue custody are postponed
 * to later batches (they depend on the message store + socket manager).
 *
 * 对齐 dsh 范式：注入式依赖 — all external touchpoints (record scan/read/mark,
 * task-progress cleanup, queue convergence, logging) arrive as callbacks via
 * `ReconcileZombieDeps`, so this module is framework-agnostic (no Cordis
 * import) and unit-testable in isolation.
 *
 * @module @flowforge/cats-invocation/startup-reconciler
 */

import { STALE_QUEUED_THRESHOLD_MS } from '@flowforge/cats-shared'
import type {
  InvocationId,
  InvocationRecord,
  ReconcileZombieDeps,
  ZombieRecord,
} from '@flowforge/cats-shared'
import { reconcileZombies } from './reconcile.ts'

/** Result of a startup orphan sweep. */
export interface StartupSweepResult {
  readonly swept: number
  readonly running: number
  readonly queued: number
  /** Records already terminal when the sweep touched them (idempotent no-op). */
  readonly alreadyTerminal: number
  readonly taskProgressCleared: number
  readonly queueConverged: number
  readonly errors: number
  readonly durationMs: number
}

/**
 * Start-up sweep dependencies. Extends {@link ReconcileZombieDeps} (mark-failed
 * + cleanup callbacks) with the scan/read surface needed to discover orphans.
 */
export interface StartupReconcilerDeps extends ReconcileZombieDeps {
  /** Enumerate invocation ids currently in the given non-terminal status. */
  scanIdsByStatus(status: 'running' | 'queued'): Promise<readonly InvocationId[]>
  /** Read a full record (for cutoff filtering + ZombieRecord mapping). */
  getRecord(invocationId: InvocationId): Promise<InvocationRecord | null>
  /**
   * Only sweep records created before this timestamp — prevents sweeping
   * invocations started by the freshly-launched process itself.
   */
  processStartAt?: number
  /** Stale queued threshold. Defaults to 5 minutes (matches clowder-ai). */
  staleQueuedThresholdMs?: number
}

/** Log helper defaulting to console.warn (matches reconcile's fallback). */
type SweepLog = NonNullable<ReconcileZombieDeps['log']>

function buildLog(deps: StartupReconcilerDeps): SweepLog {
  return deps.log ?? {
    info: (): void => {},
    warn: (msg: string): void => console.warn(msg),
  }
}

/**
 * Run the startup orphan sweep. Returns aggregate counters.
 *
 * Flow:
 * 1. Scan `running` + `queued` records.
 * 2. Filter out records younger than `processStartAt`; filter out fresh queued
 *    records (age < stale threshold).
 * 3. Map survivors to `ZombieRecord[]` and delegate to {@link reconcileZombies}.
 * 4. Report running/queued/swept/terminal/cleanup counters.
 */
export async function runStartupSweep(deps: StartupReconcilerDeps): Promise<StartupSweepResult> {
  const start = Date.now()
  const log = buildLog(deps)
  const processStartAt = deps.processStartAt ?? 0
  const staleQueuedThresholdMs = deps.staleQueuedThresholdMs ?? STALE_QUEUED_THRESHOLD_MS
  const now = Date.now()
  const staleQueuedCutoff = now - staleQueuedThresholdMs

  let running = 0
  let queued = 0
  const zombies: ZombieRecord[] = []

  for (const status of ['running', 'queued'] as const) {
    let ids: readonly InvocationId[]
    try {
      ids = await deps.scanIdsByStatus(status)
    } catch (err) {
      log.warn(
        `[startup-reconciler] failed to scan status ${status}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    for (const id of ids) {
      let record: InvocationRecord | null
      try {
        record = await deps.getRecord(id)
      } catch (err) {
        log.warn(`[startup-reconciler] failed to read invocation ${id}: ${String(err)}`)
        continue
      }
      if (!record) continue

      // Never sweep invocations started by the current process.
      if (record.createdAt >= processStartAt) continue

      if (status === 'running') {
        running += 1
      } else {
        // Fresh queued records are not orphans — only stale ones are swept.
        if (record.createdAt > staleQueuedCutoff) continue
        queued += 1
      }

      zombies.push({
        invocationId: record.invocationId,
        threadId: record.threadId,
        catIds: record.catIds,
        status: record.status,
        reason: status === 'running' ? 'process_restart' : 'stale_queued',
        detectedAt: now,
      })
    }
  }

  const result = await reconcileZombies(zombies, deps)
  const swept = result.reconciled
  const durationMs = Date.now() - start

  log.info(
    `[startup-reconciler] sweep complete: ${swept} orphans ` +
      `(${running} running, ${queued} stale queued), ${result.alreadyTerminal} already-terminal, ` +
      `${result.taskProgressCleared} task-progress cleared, ${result.queueConverged} queue entries converged, ` +
      `${result.errors} errors, ${durationMs}ms`,
  )

  return {
    swept,
    running,
    queued,
    alreadyTerminal: result.alreadyTerminal,
    taskProgressCleared: result.taskProgressCleared,
    queueConverged: result.queueConverged,
    errors: result.errors,
    durationMs,
  }
}

// Re-export reconcile internals for caller convenience.
export type { InvocationId, InvocationRecord, ZombieRecord }