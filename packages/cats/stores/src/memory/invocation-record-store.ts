/**
 * MemoryInvocationRecordStore — in-memory IInvocationRecordStore.
 *
 * Ported from clowder-ai `InvocationRecordStore.ts`
 * (api/src/domains/cats/services/stores/ports/InvocationRecordStore.ts),
 * adapted to flowforge branded types and the batch 3.1 state-machine
 * (`isValidTransition` from `@flowforge/cats-shared`).
 *
 * Semantics preserved from clowder-ai:
 * - Bounded Map (MAX_RECORDS = 500); overflow evicts the oldest record
 *   (insertion order via Map iteration).
 * - Idempotency index keyed by `${threadId}:${userId}:${idempotencyKey}`
 *   with a 5-minute TTL; expired entries are treated as misses on read.
 * - `update()` enforces both `isValidTransition` and the CAS guards
 *   (`expectedStatus`); illegal transitions return `{ outcome: 'invalid_transition' }`,
 *   CAS mismatches return `{ outcome: 'cas_mismatch' }`, missing records
 *   return `{ outcome: 'missing' }` — no throws.
 *
 * Not durable across processes — load the Sqlite backend
 * (`@flowforge/cats-stores-sqlite`) for persistence.
 *
 * @module @flowforge/cats-stores/memory
 */

import {
  generateInvocationId,
  isValidTransition,
} from '@flowforge/cats-shared'
import type {
  CreateInvocationInput,
  InvocationId,
  InvocationRecord,
  InvocationStatus,
  ThreadId,
  UserId,
} from '@flowforge/cats-shared'
import type {
  IInvocationRecordStore,
  StoreCreateInvocationOutcome,
  StoreUpdateInvocationInput,
  StoreUpdateInvocationOutcome,
} from '../ports/invocation-record-store.ts'

/** Maximum records kept in memory before oldest is evicted. */
const MAX_RECORDS = 500

/** Idempotency key TTL — 5 minutes (matches clowder-ai). */
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000

/** Options for constructing the store (mainly for tests). */
export interface MemoryInvocationRecordStoreOptions {
  readonly maxRecords?: number
  /** Inject a clock (tests). Defaults to Date.now. */
  readonly now?: () => number
}

interface IdempotencyEntry {
  readonly invocationId: InvocationId
  readonly expiresAt: number
}

/**
 * Bounded in-memory invocation record store. Node.js single-threaded →
 * synchronous Map operations are atomically equivalent to the Redis Lua
 * scripts they replace (CAS, dedup, atomic update).
 */
export class MemoryInvocationRecordStore implements IInvocationRecordStore {
  private readonly records = new Map<InvocationId, InvocationRecord>()
  private readonly idempotencyIndex = new Map<string, IdempotencyEntry>()
  private readonly maxRecords: number
  private readonly now: () => number

  constructor(options: MemoryInvocationRecordStoreOptions = {}) {
    this.maxRecords = options.maxRecords ?? MAX_RECORDS
    this.now = options.now ?? (() => Date.now())
  }

  private compositeKey(threadId: ThreadId, userId: UserId, key: string): string {
    return `${threadId}:${userId}:${key}`
  }

  create(input: CreateInvocationInput): StoreCreateInvocationOutcome {
    const now = this.now()

    // Idempotency: deduplicate if the key still holds.
    if (input.idempotencyKey !== undefined) {
      const composite = this.compositeKey(input.threadId, input.userId, input.idempotencyKey)
      const existing = this.idempotencyIndex.get(composite)
      if (existing && existing.expiresAt > now) {
        return { outcome: 'deduped', invocationId: existing.invocationId }
      }
    }

    const invocationId = generateInvocationId()
    const record: InvocationRecord = {
      invocationId,
      threadId: input.threadId,
      userId: input.userId,
      catIds: [...input.catIds],
      status: 'queued',
      source: input.source,
      sourceCategory: input.sourceCategory,
      idempotencyKey: input.idempotencyKey,
      parentInvocationId: input.parentInvocationId,
      callerCatId: input.callerCatId,
      managedWorkBinding: input.managedWorkBinding,
      detail: input.detail,
      createdAt: now,
    }

    this.records.set(invocationId, record)
    if (input.idempotencyKey !== undefined) {
      const composite = this.compositeKey(input.threadId, input.userId, input.idempotencyKey)
      this.idempotencyIndex.set(composite, {
        invocationId,
        expiresAt: now + IDEMPOTENCY_TTL_MS,
      })
    }

    // Evict oldest if over capacity. Map preserves insertion order.
    if (this.records.size > this.maxRecords) {
      const firstKey = this.records.keys().next().value
      if (firstKey !== undefined) {
        this.records.delete(firstKey)
      }
    }

    return { outcome: 'created', invocationId }
  }

  get(id: InvocationId): InvocationRecord | null {
    return this.records.get(id) ?? null
  }

  update(input: StoreUpdateInvocationInput): StoreUpdateInvocationOutcome {
    const record = this.records.get(input.invocationId)
    if (!record) {
      return { outcome: 'missing', invocationId: input.invocationId }
    }

    // State machine guard: reject illegal transitions.
    if (!isValidTransition(record.status, input.status)) {
      return {
        outcome: 'invalid_transition',
        from: record.status,
        to: input.status,
      }
    }

    // CAS guard: reject if current status doesn't match expected.
    if (input.expectedStatus !== undefined && record.status !== input.expectedStatus) {
      return {
        outcome: 'cas_mismatch',
        invocationId: input.invocationId,
        expected: input.expectedStatus,
        actual: record.status,
      }
    }

    const now = this.now()
    const isTerminal = input.status === 'succeeded' || input.status === 'failed' || input.status === 'canceled'
    const updated: InvocationRecord = {
      ...record,
      status: input.status,
      error: input.error ?? record.error,
      detail: input.detail ?? record.detail,
      cancelReason: input.cancelReason ?? record.cancelReason,
      executionStartedAt:
        input.status === 'running' && record.executionStartedAt === undefined
          ? now
          : record.executionStartedAt,
      settledAt: isTerminal ? now : record.settledAt,
    }
    this.records.set(input.invocationId, updated)
    return { outcome: 'updated', invocationId: input.invocationId }
  }

  getByIdempotencyKey(
    threadId: ThreadId,
    userId: UserId,
    key: string,
  ): InvocationRecord | null {
    const composite = this.compositeKey(threadId, userId, key)
    const entry = this.idempotencyIndex.get(composite)
    if (!entry || entry.expiresAt <= this.now()) return null
    return this.records.get(entry.invocationId) ?? null
  }

  listRunningByThread(threadId: ThreadId, userId: UserId): readonly InvocationRecord[] {
    const out: InvocationRecord[] = []
    for (const r of this.records.values()) {
      if (r.status === 'running' && r.threadId === threadId && r.userId === userId) {
        out.push(r)
      }
    }
    return out
  }

  async scanAll(): Promise<readonly InvocationRecord[]> {
    return Array.from(this.records.values())
  }

  /** Current record count (for tests). */
  get size(): number {
    return this.records.size
  }
}

/** Helper exported for tests / type narrowing. */
export function isInvocationTerminal(status: InvocationStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}
