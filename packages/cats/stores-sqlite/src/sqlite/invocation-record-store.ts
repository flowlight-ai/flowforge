/**
 * SqliteInvocationRecordStore — durable IInvocationRecordStore (批次 6.5).
 *
 * 语义对齐 `@flowforge/cats-stores` Memory 版（批次 3.2），持久化到
 * `invocation_records` 表。Redis Lua 脚本的原子性由 `BEGIN IMMEDIATE`
 * 事务替代：dedup-then-insert（create）与 read-check-write（update 的
 * 状态机 + CAS 守卫）要么整体提交、要么整体回滚。
 *
 * 与 Memory 版的差异（持久化存储的刻意取舍，见文件头约定）：
 * - 无容量上限：不保留 MAX_RECORDS=500 的最旧驱逐（持久化审计日志不丢数据）。
 * - 幂等索引 `(thread_id, user_id, idempotency_key)` 由 SQL 索引列承担，
 *   `created_at DESC LIMIT 1` 复现 "同 key 最新写入胜出" 的 Map 覆盖语义；
 *   TTL 5 分钟由 `idempotency_expires_at` 列承载。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import {
  generateInvocationId,
  isValidTransition,
} from '@flowforge/cats-shared'
import type {
  CreateInvocationInput,
  InvocationId,
  InvocationRecord,
  ThreadId,
  UserId,
} from '@flowforge/cats-shared'
import type { DatabaseSync } from 'node:sqlite'
import type {
  IInvocationRecordStore,
  StoreCreateInvocationOutcome,
  StoreUpdateInvocationInput,
  StoreUpdateInvocationOutcome,
} from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

/** Idempotency key TTL — 5 minutes (matches Memory / clowder-ai). */
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000

/** Row shape of the `invocation_records` table. */
interface InvocationRow {
  readonly id: string
  readonly thread_id: string
  readonly user_id: string
  readonly status: string
  readonly idempotency_key: string | null
  readonly idempotency_expires_at: number | null
  readonly created_at: number
  readonly data: string
}

/**
 * Durable invocation record store backed by SQLite. `DatabaseSync` is
 * synchronous and the backend serializes writers through `BEGIN IMMEDIATE`,
 * so CAS / dedup / state-machine decisions are atomically equivalent to the
 * Redis Lua scripts they replace.
 */
export class SqliteInvocationRecordStore implements IInvocationRecordStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private parse(row: InvocationRow | undefined): InvocationRecord | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as InvocationRecord
  }

  /** Latest live idempotency row for (thread, user, key) — TTL honored in SQL. */
  private liveIdempotencyRow(
    threadId: string,
    userId: string,
    key: string,
  ): InvocationRow | undefined {
    return this.db.prepare(
      `SELECT * FROM invocation_records
       WHERE thread_id = ? AND user_id = ? AND idempotency_key = ?
         AND idempotency_expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    ).get(threadId, userId, key, this.now()) as unknown as InvocationRow | undefined
  }

  create(input: CreateInvocationInput): StoreCreateInvocationOutcome {
    return inImmediateTransaction(this.db, () => {
      // Idempotency: deduplicate if the key still holds (atomic with insert).
      if (input.idempotencyKey !== undefined) {
        const existing = this.liveIdempotencyRow(
          input.threadId,
          input.userId,
          input.idempotencyKey,
        )
        if (existing !== undefined) {
          return { outcome: 'deduped', invocationId: existing.id as InvocationId }
        }
      }

      const now = this.now()
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

      this.db.prepare(`
        INSERT INTO invocation_records
          (id, thread_id, user_id, status, idempotency_key, idempotency_expires_at, created_at, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invocationId,
        input.threadId,
        input.userId,
        record.status,
        input.idempotencyKey ?? null,
        input.idempotencyKey !== undefined ? now + IDEMPOTENCY_TTL_MS : null,
        now,
        JSON.stringify(record),
      )

      return { outcome: 'created', invocationId }
    })
  }

  get(id: InvocationId): InvocationRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM invocation_records WHERE id = ?',
    ).get(id) as unknown as InvocationRow | undefined
    return this.parse(row)
  }

  update(input: StoreUpdateInvocationInput): StoreUpdateInvocationOutcome {
    return inImmediateTransaction(this.db, () => {
      const row = this.db.prepare(
        'SELECT * FROM invocation_records WHERE id = ?',
      ).get(input.invocationId) as unknown as InvocationRow | undefined
      const record = this.parse(row)
      if (record === null) {
        return { outcome: 'missing', invocationId: input.invocationId }
      }

      // State machine guard: reject illegal transitions (checked before CAS,
      // matching Memory semantics).
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
      const isTerminal =
        input.status === 'succeeded' || input.status === 'failed' || input.status === 'canceled'
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
      this.db.prepare(`
        UPDATE invocation_records SET status = ?, data = ? WHERE id = ?
      `).run(updated.status, JSON.stringify(updated), input.invocationId)
      return { outcome: 'updated', invocationId: input.invocationId }
    })
  }

  getByIdempotencyKey(
    threadId: ThreadId,
    userId: UserId,
    key: string,
  ): InvocationRecord | null {
    const row = this.liveIdempotencyRow(threadId, userId, key)
    return this.parse(row)
  }

  listRunningByThread(threadId: ThreadId, userId: UserId): readonly InvocationRecord[] {
    const rows = this.db.prepare(
      `SELECT * FROM invocation_records
       WHERE thread_id = ? AND user_id = ? AND status = 'running'
       ORDER BY created_at ASC`,
    ).all(threadId, userId) as unknown as InvocationRow[]
    return rows.map((row) => JSON.parse(row.data) as InvocationRecord)
  }

  async scanAll(): Promise<readonly InvocationRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM invocation_records ORDER BY created_at ASC',
    ).all() as unknown as InvocationRow[]
    return rows.map((row) => JSON.parse(row.data) as InvocationRecord)
  }
}
