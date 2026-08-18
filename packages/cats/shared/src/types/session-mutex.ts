/**
 * Session Mutex Types (会话互斥锁)
 *
 * Per-session serialization primitive. 移植自 clowder-ai
 * `services/agents/invocation/SessionMutex.ts` 的接口契约.
 *
 * 设计要点:
 * - 一个 sessionId 同时只能持有一把锁（同 session 串行化）
 * - contention 入队等待（FIFO），可通过 AbortSignal 取消等待
 * - `forceReleaseByScope` 允许 REST/WS 适配器按 (threadId, userId, catId?) 批量释放
 * - `preserveHolderExecutionIds` 防止误释放刚 abort 但仍在 finally 中的 holder
 *
 * @module @flowforge/cats-shared/types/session-mutex
 */

import type { CatId, ThreadId, UserId } from './ids.ts'

/**
 * Lock owner metadata — captures who holds the lock and why.
 * Used by `forceReleaseByScope` to identify locks for targeted release.
 */
export interface SessionLockOwner {
  readonly sessionId: string
  readonly threadId: ThreadId
  readonly userId: UserId
  readonly catId?: CatId | undefined
  /** Execution ID (if this lock is associated with a specific QueueProcessor execution). */
  readonly executionId?: string | undefined
  /** Acquisition timestamp (epoch ms). */
  readonly acquiredAt: number
}

/**
 * Lock scope — used by `forceReleaseByScope` to identify locks to release.
 * All present fields must match; absent fields are wildcards.
 */
export interface SessionLockScope {
  readonly threadId: ThreadId
  readonly userId?: UserId | undefined
  readonly catId?: CatId | undefined
}

/**
 * Options for `forceReleaseByScope`.
 * `preserveHolderExecutionIds` prevents releasing holders whose execution
 * is in the middle of an abort cleanup (avoids double-release races).
 */
export interface ForceReleaseOptions {
  readonly preserveHolderExecutionIds?: readonly string[] | undefined
}

/**
 * Result of `forceReleaseByScope`.
 *
 * 对齐 clowder-ai `SessionMutex.forceReleaseByScope` 返回契约:
 * - `releasedHolders`: 被释放的持有者数量
 * - `rejectedWaiters`: 被拒绝的等待者数量（其 acquire() promise 将 reject）
 * - `catIds`: 涉及的猫猫 ID 列表, 用于 terminal UI/slot 清理
 */
export interface ForceReleaseResult {
  /** Holders that were released. */
  readonly releasedHolders: number
  /** Waiters that were canceled (their acquire() promise will reject). */
  readonly rejectedWaiters: number
  /** Cats whose holder or waiter was force-released, for terminal UI/slot cleanup. */
  readonly catIds?: readonly string[]
}

/**
 * Reason for canceling a waiting `acquire()` call.
 */
export type SessionLockCancelReason = 'aborted' | 'force_released' | 'session_disposed'
