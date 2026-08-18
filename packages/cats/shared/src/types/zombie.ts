/**
 * Zombie Types (僵尸调用恢复)
 *
 * 移植自 clowder-ai `services/agents/invocation/reconcileZombies.ts`
 * 的输入/输出类型契约。
 *
 * 设计要点：
 * - `ZombieRecord` 标识一个可能孤立的 invocation（运行中或排队过久）
 * - `reconcileZombies` 函数幂等：底层 `IInvocationRecordStore.update` 的
 *   CAS + 状态机守护使重复调用安全
 * - `LiveInvocation` 表达"该 invocation 仍活跃"的多源证据
 *   （tracker / record_store / queue 三选一）
 *
 * @module @flowforge/cats-shared/types/zombie
 */

import type { CatId, ThreadId } from './ids.ts';
import type { InvocationId, InvocationStatus } from './invocation.ts';

/**
 * Reason a record was classified as zombie.
 * - `ttl_expired`: invocation slot TTL elapsed (default 75min in clowder-ai)
 * - `process_restart`: process restarted while invocation was running
 * - `orphaned_slot`: tracker slot disappeared while record still 'running'
 * - `stale_queued`: queued for > STALE_QUEUED_THRESHOLD_MS (default 5min)
 */
export type ZombieReason = 'ttl_expired' | 'process_restart' | 'orphaned_slot' | 'stale_queued';

/**
 * A record classified as zombie — pending reconciliation.
 */
export interface ZombieRecord {
  readonly invocationId: InvocationId;
  readonly threadId: ThreadId;
  readonly catIds: readonly CatId[];
  readonly status: InvocationStatus;
  readonly reason: ZombieReason;
  readonly detectedAt: number;
}

/**
 * Source of liveness evidence for an invocation.
 * - `tracker`: InvocationTracker has an active slot
 * - `record_store`: IInvocationRecordStore returned a non-terminal record
 * - `queue`: InvocationQueue still has the entry
 */
export type LivenessSource = 'tracker' | 'record_store' | 'queue';

/**
 * Reason an invocation is considered live.
 * - `active`: tracker has an active slot
 * - `recently_settled`: settled in last N seconds (still being processed)
 * - `pending_completion`: queued but within freshness threshold
 */
export type LivenessReason = 'active' | 'recently_settled' | 'pending_completion';

/**
 * Live invocation evidence — opposite of zombie.
 */
export interface LiveInvocation {
  readonly invocationId: InvocationId;
  readonly threadId: ThreadId;
  readonly catIds: readonly CatId[];
  readonly source: LivenessSource;
  readonly reason: LivenessReason;
}

/**
 * Per-zombie outcome — one entry per zombie in {@link ReconcileZombieResult.details}.
 */
export interface PerZombieOutcome {
  readonly invocationId: InvocationId;
  readonly outcome:
    | 'reconciled'
    | 'already_terminal'
    | 'task_progress_cleared'
    | 'queue_converged'
    | 'error';
  readonly error?: string | undefined;
}

/**
 * Aggregate result of `reconcileZombies()`.
 */
export interface ReconcileZombieResult {
  readonly reconciled: number;
  readonly alreadyTerminal: number;
  readonly taskProgressCleared: number;
  readonly queueConverged: number;
  readonly errors: number;
  readonly details: readonly PerZombieOutcome[];
}

/**
 * Recovery status classification used by `StartupReconciler`.
 * - `live`: invocation is active (within TTL)
 * - `zombie_running`: running too long without heartbeat (TTL exceeded)
 * - `zombie_queued`: queued past stale threshold
 * - `terminal`: invocation already settled
 */
export type InvocationRecoveryStatus = 'live' | 'zombie_running' | 'zombie_queued' | 'terminal';

/**
 * Input for `reconcileZombies()`. Pure data — functions are injected by caller.
 */
export interface ReconcileZombieDeps {
  /** Update store to terminal status (CAS-guarded). */
  readonly updateInvocation: (
    invocationId: InvocationId,
    input: {
      readonly status: InvocationStatus;
      readonly expectedStatus?: InvocationStatus | undefined;
      readonly error?: string | undefined;
    },
  ) => Promise<{ readonly outcome: 'updated' | 'missing' | 'cas_mismatch' | 'invalid_transition' }>;
  /** Clear task progress snapshot (if any). */
  readonly clearTaskProgress?: (
    threadId: ThreadId,
    catId: CatId,
  ) => Promise<boolean> | undefined;
  /** Remove stale queue entry (if any). */
  readonly convergeQueueEntry?: (
    invocationId: InvocationId,
  ) => Promise<{ readonly converged: number; readonly errors: number }> | undefined;
  /** Optional callback fired after a zombie is successfully reconciled. */
  readonly onReconciledZombie?: ((event: {
    readonly invocationId: InvocationId;
    readonly threadId: ThreadId;
    readonly catIds: readonly CatId[];
    readonly from: InvocationStatus;
    readonly to: InvocationStatus;
  }) => void | Promise<void>) | undefined;
  /** Optional logger. */
  readonly log?: {
    readonly info: (msg: string) => void;
    readonly warn: (msg: string) => void;
  } | undefined;
}

/**
 * Re-export InvocationRecord for caller convenience (the reconciler reads
 * the existing record before deciding to mark it terminal).
 */
export type { InvocationRecord } from './invocation.ts';
