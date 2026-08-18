/**
 * Queue Entry Types (灵智体调用队列条目)
 *
 * Per-thread × per-user FIFO queue entries consumed by QueueProcessor.
 * 移植自 clowder-ai `services/agents/invocation/InvocationQueue.ts` 的
 * `QueueEntry` interface (L98 区域)，去掉耦合的旧字段。
 *
 * 设计要点：
 * - `QueueEntryId` 用 brand 隔离
 * - 队列 entry 与 `InvocationRecord` 分离：entry 是 transient 调度令牌，
 *   record 是持久化审计 + outcome 契约
 * - `EnqueueOutcome` 表达三种结果：created（新条目）、deduped（同 idempotencyKey
 *   重放，返回已存在条目）、full（达 MAX_QUEUE_DEPTH）
 *
 * @module @flowforge/cats-shared/types/queue-entry
 */

import type { CatId, MessageId, ThreadId, UserId } from './ids.ts';
import type { InvocationId, InvocationSource, InvocationSourceCategory } from './invocation.ts';

// Brand for QueueEntryId
declare const queueEntryIdBrand: unique symbol;

/** Branded QueueEntryId. */
export type QueueEntryId = string & { readonly [queueEntryIdBrand]: 'QueueEntryId' };

/** Create a QueueEntryId from a raw string. */
export function createQueueEntryId(id: string): QueueEntryId {
  return id as QueueEntryId;
}

/** Generate a fresh QueueEntryId with `q_` prefix. */
export function generateQueueEntryId(): QueueEntryId {
  const raw =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
  return createQueueEntryId(`q_${raw}`);
}

/**
 * Queue entry — transient scheduling token consumed by QueueProcessor.
 *
 * Lifecycle: `enqueued → processing → processed` (terminal).
 * Persistence: in-memory only (clowder-ai durable custody is split into
 * QueuedMessageCustodyCoordinator, out of scope for batch 3).
 */
export interface QueueEntry {
  readonly id: QueueEntryId;
  readonly threadId: ThreadId;
  readonly userId: UserId;
  /** Target cat IDs to dispatch this entry to. */
  readonly targetCatIds: readonly CatId[];
  readonly source: InvocationSource;
  readonly sourceCategory?: InvocationSourceCategory | undefined;
  /** Original user message that triggered this entry (if any). */
  readonly userMessageId?: MessageId | undefined;
  /** Messages merged into this single dispatch (F176 consolidation). */
  readonly mergedMessageIds?: readonly MessageId[] | undefined;
  /** Idempotency key — same key replays return same entry. */
  readonly idempotencyKey?: string | undefined;
  /** Parent invocation (for a2a / continuation chains). */
  readonly parentInvocationId?: InvocationId | undefined;
  /** Cat that initiated this entry (for a2a). */
  readonly callerCatId?: CatId | undefined;
  /** Continuation dedup key (suppresses duplicates within window). */
  readonly continuationKey?: string | undefined;
  /** Freshness closure id (if entry originated from freshness scan). */
  readonly freshnessClosureId?: string | undefined;
  /** Freshness supplement id (if entry originated from supplement preflight). */
  readonly freshnessSupplementId?: string | undefined;
  /** Suggested skill hint (passed to router). */
  readonly suggestedSkill?: string | undefined;
  /** Position in queue (0-indexed, FIFO order). */
  readonly position: number;
  /** Enqueue timestamp (epoch ms). */
  readonly enqueuedAt: number;
  /** Processing start timestamp (when QueueProcessor picked it up). */
  readonly processingStartedAt?: number | undefined;
  /** Terminal timestamp (when entry was processed). */
  readonly processedAt?: number | undefined;
}

/** Result of `InvocationQueue.enqueue()`. */
export type EnqueueOutcome = 'created' | 'deduped' | 'full';

export interface EnqueueResult {
  readonly outcome: EnqueueOutcome;
  /** New entry (only present when `outcome === 'created'`). */
  readonly entry?: QueueEntry | undefined;
  /** Existing entry id (only present when `outcome === 'deduped'`). */
  readonly dedupedEntryId?: QueueEntryId | undefined;
}

/** Maximum queue depth per (threadId, userId) scope. */
export const MAX_QUEUE_DEPTH = 5;
