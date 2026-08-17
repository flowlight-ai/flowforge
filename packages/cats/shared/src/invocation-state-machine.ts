/**
 * Invocation State Machine (调用状态机纯函数)
 *
 * 移植自 clowder-ai `services/stores/ports/invocation-state-machine.ts`。
 *
 * 这两个纯函数被 `IInvocationRecordStore.update()` 的 Memory/Sqlite
 * 实现用来做 CAS 守护前的状态合法性检查。Lua 脚本里冗余守护一份，
 * 但 TS 层守卫是真正的 single source of truth（Lua 只是优化）。
 *
 * @module @flowforge/cats-shared/invocation-state-machine
 */

import type { InvocationStatus } from './types/invocation.ts';

/**
 * Valid forward transitions from each status.
 *
 * Same-status transitions are allowed (idempotent no-op).
 * Terminal statuses (succeeded/failed/canceled) have no outgoing transitions.
 */
const VALID_TRANSITIONS: Readonly<Record<InvocationStatus, readonly InvocationStatus[]>> = {
  queued: ['running', 'failed', 'canceled'],
  running: ['succeeded', 'failed', 'canceled'],
  succeeded: [],
  failed: [],
  canceled: [],
};

/**
 * Check whether transitioning from `from` to `to` is valid.
 *
 * Rules:
 * - Same status → valid (idempotent replay of CAS update)
 * - `from` is terminal → invalid (no resurrection)
 * - `to` is in `VALID_TRANSITIONS[from]` → valid
 * - Otherwise → invalid
 *
 * @param from - current record status
 * @param to - requested new status
 * @returns true if the transition is allowed by the state machine
 */
export function isValidTransition(from: InvocationStatus, to: InvocationStatus): boolean {
  if (from === to) return true; // idempotent
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Recovery status — used by `StartupReconciler` to classify records
 * discovered after process restart.
 *
 * @param status - invocation record status
 * @param ageMs - age of the record in milliseconds (now - createdAt)
 * @param staleQueuedThresholdMs - threshold for stale queued entries (default 5min)
 * @param ttlRunningMs - TTL for running invocations (default 75min)
 * @returns one of 'live' | 'zombie_running' | 'zombie_queued' | 'terminal'
 */
export function classifyInvocationRecoveryStatus(
  status: InvocationStatus,
  ageMs: number,
  staleQueuedThresholdMs: number = 5 * 60 * 1000,
  ttlRunningMs: number = 75 * 60 * 1000,
): 'live' | 'zombie_running' | 'zombie_queued' | 'terminal' {
  if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
    return 'terminal';
  }
  if (status === 'queued') {
    return ageMs > staleQueuedThresholdMs ? 'zombie_queued' : 'live';
  }
  // status === 'running'
  if (ageMs > ttlRunningMs) {
    return 'zombie_running';
  }
  return 'live';
}

/**
 * Default TTL for an invocation slot (75 minutes).
 * Matches clowder-ai `DEFAULT_INVOCATION_SLOT_TTL_MS`.
 */
export const DEFAULT_INVOCATION_SLOT_TTL_MS = 75 * 60_000;

/**
 * Abort reason used by InvocationTracker when TTL fires.
 */
export const INVOCATION_SLOT_TTL_ABORT_REASON = 'invocation_slot_ttl_expired';

/**
 * Stale queued threshold (5 minutes).
 * Matches clowder-ai `STALE_QUEUED_THRESHOLD_MS`.
 */
export const STALE_QUEUED_THRESHOLD_MS = 5 * 60 * 1000;
