/**
 * Invocation Types (灵智体调用)
 *
 * 单次 agent 调用的核心数据契约。移植自 clowder-ai
 * `packages/api/src/domains/cats/services/stores/ports/InvocationRecordStore.ts`
 * 与 `services/agents/invocation/` 的相关类型定义。
 *
 * 设计要点：
 * - `InvocationId` 用 brand 保证不与 `MessageId` / `ThreadId` 等混用
 * - `InvocationStatus` 是有限状态机：queued → running → succeeded/failed/canceled
 * - `InvocationActionLeaseCarrier` 表达 CAS 守护的 lease 来源
 *   （idempotencyKey / executionId / none）
 *
 * @module @flowforge/cats-shared/types/invocation
 */

import type { CatId, ThreadId, UserId } from './ids.ts';
import type { ManagedWorkBinding } from './managed-work.ts';

// Brand for InvocationId
declare const invocationIdBrand: unique symbol;

/**
 * Branded InvocationId — distinguishes from raw string IDs at compile time.
 */
export type InvocationId = string & { readonly [invocationIdBrand]: 'InvocationId' };

/**
 * Invocation status — finite state machine.
 *
 * Transitions (validated in `invocation-state-machine.ts`):
 * - `queued → running` (dequeued by processor)
 * - `queued → failed` (rejected before run)
 * - `queued → canceled` (superseded)
 * - `running → succeeded` (terminal: success)
 * - `running → failed` (terminal: error)
 * - `running → canceled` (terminal: aborted)
 * - Same status → same status: idempotent no-op
 */
export type InvocationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** Source of the invocation (user message / external connector / agent). */
export type InvocationSource = 'user' | 'connector' | 'agent';

/**
 * Source category — coarse taxonomy used by telemetry + queue processor
 * to classify cross-thread dispatch / continuation / freshness scenarios.
 */
export type InvocationSourceCategory =
  | 'ci'
  | 'review'
  | 'conflict'
  | 'scheduled'
  | 'a2a'
  | 'continuation'
  | 'issue'
  | 'freshness';

/**
 * Action lease carrier — passed to CAS-guarded state transitions.
 * Determines how the underlying store verifies operation idempotency
 * and prevents stale concurrent writes.
 */
export type InvocationActionLeaseCarrier =
  | { readonly kind: 'none' }
  | { readonly kind: 'idempotencyKey'; readonly key: string }
  | { readonly kind: 'executionId'; readonly id: string };

/**
 * Persistent invocation record — primary audit + outcome contract.
 *
 * Stored in `IInvocationRecordStore`. Read by zombie reconciler,
 * queue processor, message delivery service.
 */
export interface InvocationRecord {
  readonly invocationId: InvocationId;
  readonly threadId: ThreadId;
  readonly userId: UserId;
  readonly catIds: readonly CatId[];
  readonly status: InvocationStatus;
  readonly source: InvocationSource;
  readonly sourceCategory?: InvocationSourceCategory | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly parentInvocationId?: InvocationId | undefined;
  readonly callerCatId?: CatId | undefined;
  readonly createdAt: number;
  readonly executionStartedAt?: number | undefined;
  readonly settledAt?: number | undefined;
  readonly error?: string | undefined;
  readonly detail?: Record<string, unknown> | undefined;
  readonly cancelReason?: string | undefined;
  readonly managedWorkBinding?: ManagedWorkBinding | undefined;
  readonly turnExecutionId?: string | undefined;
}

/** Input for `IInvocationRecordStore.create()`. */
export interface CreateInvocationInput {
  readonly threadId: ThreadId;
  readonly userId: UserId;
  readonly catIds: readonly CatId[];
  readonly source: InvocationSource;
  readonly sourceCategory?: InvocationSourceCategory | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly parentInvocationId?: InvocationId | undefined;
  readonly callerCatId?: CatId | undefined;
  readonly managedWorkBinding?: ManagedWorkBinding | undefined;
  readonly detail?: Record<string, unknown> | undefined;
}

/** Input for `IInvocationRecordStore.update()`. */
export interface UpdateInvocationInput {
  readonly invocationId: InvocationId;
  readonly status: InvocationStatus;
  readonly expectedStatus?: InvocationStatus | undefined;
  readonly error?: string | undefined;
  readonly detail?: Record<string, unknown> | undefined;
  readonly cancelReason?: string | undefined;
  readonly leaseCarrier?: InvocationActionLeaseCarrier | undefined;
}

/** Outcome of `IInvocationRecordStore.create()`. */
export type CreateInvocationOutcome =
  | { readonly outcome: 'created'; readonly invocationId: InvocationId }
  | { readonly outcome: 'deduped'; readonly invocationId: InvocationId }
  | { readonly outcome: 'conflict'; readonly reason: string };

/** Outcome of `IInvocationRecordStore.update()`. */
export type UpdateInvocationOutcome =
  | { readonly outcome: 'updated'; readonly invocationId: InvocationId }
  | { readonly outcome: 'missing'; readonly invocationId: InvocationId }
  | {
      readonly outcome: 'cas_mismatch';
      readonly invocationId: InvocationId;
      readonly expected: InvocationStatus;
      readonly actual: InvocationStatus;
    }
  | {
      readonly outcome: 'invalid_transition';
      readonly from: InvocationStatus;
      readonly to: InvocationStatus;
    };

/**
 * Create an InvocationId from a raw string.
 * Does NOT validate against any registry — runtime existence check is
 * performed by `IInvocationRecordStore.get()`.
 */
export function createInvocationId(id: string): InvocationId {
  return id as InvocationId;
}

/**
 * Generate a fresh InvocationId with `inv_` prefix.
 * Uses crypto.randomUUID when available; falls back to timestamp+random.
 */
export function generateInvocationId(): InvocationId {
  const raw =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
  return createInvocationId(`inv_${raw}`);
}
