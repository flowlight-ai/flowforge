/**
 * ReadStateService — 线程读取状态 Cordis 服务（阶段5 批次1，ctx.chatReadState）。
 *
 * 移植自 clowder-ai `routes/threads.ts` 的 F069/#1200/#1269/#1304 读状态族：
 * - ack：校验 upToMessageId 属于线程 → durable-slot 门控 → 单调 CAS ack
 * - pre-reconcile：写 v2 前将存量 v1 游标原子升级（#1200 跨格式 CAS 对齐）
 * - ackLatest：服务端取最新可见消息原子 ack（F069-R5 消除前端竞态）
 * - markAllRead：F072 全部已读
 * - caughtUp：#1304 区分"游标已达"与"落后/不可比"
 *
 * @module @flowforge/chat-threads/read-state
 */

import { Context, Service } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import type { ThreadReadState, ThreadUnreadSummary } from '@flowforge/cats-stores'
import { gateForDurableSlot } from './cursor-gate.ts'
import { ThreadErrorCode } from './invariant.ts'
import { ChatThreadsError } from './thread-service.ts'

/** Result of a read-state ack (PATCH /api/threads/:id/read semantics). */
export interface ReadAckResult {
  /** True when the stored cursor advanced this call. */
  readonly advanced: boolean
  /** #1304: cursor at/beyond target vs stale/uncomparable. */
  readonly caughtUp: boolean
}

/** Result of markAllRead (POST /api/threads/read/mark-all). */
export interface MarkAllReadResult {
  readonly advancedCount: number
  readonly totalThreads: number
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat read-state service — mounted by `@flowforge/chat-threads`. */
    chatReadState: ReadStateService
  }
}

/**
 * Cordis service exposing per-user/per-thread read cursors at `ctx.chatReadState`.
 */
export class ReadStateService extends Service {
  static inject = ['catStores'] as const

  constructor(ctx: Context) {
    super(ctx, 'chatReadState')
  }

  private get readStates() {
    return this.ctx.catStores.readStates()
  }

  private get messages() {
    return this.ctx.catStores.messages()
  }

  /**
   * #1200: Pre-reconcile stored read cursor before CAS ack — converts stored
   * v1 → v2 atomically so the monotonic CAS compares same-format tokens.
   * Best-effort: failures are silent; the ack itself fails closed.
   */
  private async preReconcileReadCursor(
    userId: string,
    threadId: string,
    incomingCursor: string,
  ): Promise<void> {
    if (!incomingCursor.startsWith('v2:')) return
    if (!this.readStates.reconcileReadCursor) return
    const stored = await Promise.resolve(this.readStates.get(userId, threadId))
    if (!stored || stored.lastReadMessageId.startsWith('v2:')) return
    // Without a canonicalizeCursor authority (visibilitySeq lands with the
    // realtime batch), reconcile only when the v2 token's raw id matches —
    // a pure format upgrade that cannot advance the cursor.
    const secondColon = incomingCursor.indexOf(':', 3)
    const rawId = secondColon > 0 ? incomingCursor.slice(secondColon + 1) : null
    if (rawId && rawId === stored.lastReadMessageId) {
      await Promise.resolve(
        this.readStates.reconcileReadCursor(userId, threadId, stored.lastReadMessageId, incomingCursor),
      ).catch(() => {})
    }
  }

  /**
   * #1269: Gated read-state ack — reads the existing cursor to decide format,
   * conditionally pre-reconciles, then acks with the gated cursor value.
   */
  private async gatedAck(userId: string, threadId: string, cursorToken: string): Promise<boolean> {
    const existing = await Promise.resolve(this.readStates.get(userId, threadId))
    const existingCursor = existing?.lastReadMessageId ?? null
    const gated = gateForDurableSlot(cursorToken, existingCursor)
    if (gated.startsWith('v2:')) {
      await this.preReconcileReadCursor(userId, threadId, gated)
    }
    return Promise.resolve(this.readStates.ack(userId, threadId, gated))
  }

  /** F069: ack read up to `upToMessageId` (P1-3 thread-membership validated). */
  async ack(userId: UserId, threadId: string, upToMessageId: string): Promise<ReadAckResult> {
    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(threadId))
    if (!thread) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
    // P1-3: upToMessageId must belong to this thread
    const msg = await Promise.resolve(this.messages.getById(upToMessageId))
    if (!msg || msg.threadId !== threadId) {
      throw new ChatThreadsError(
        ThreadErrorCode.INVALID_INPUT,
        'upToMessageId does not belong to this thread',
      )
    }
    const advanced = await this.gatedAck(userId, threadId, upToMessageId)
    // #1304 caughtUp — cursor at/beyond target vs stale
    const afterState = await Promise.resolve(this.readStates.get(userId, threadId))
    const caughtUp =
      advanced ||
      (!!afterState && afterState.lastReadMessageId === upToMessageId)
    return { advanced, caughtUp }
  }

  /**
   * F069-R5: ack to the latest visible message server-side — the server finds
   * the latest message and acks it in one operation, eliminating frontend
   * timing races around which id to send.
   */
  async ackLatest(userId: UserId, threadId: string): Promise<ReadAckResult & { reason?: string }> {
    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(threadId))
    if (!thread) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
    // Latest visible message — Memory/Sqlite stores return newest-first here
    // (getByThread(limit=1) is the flowforge authority; clowder-ai uses
    // getLatestVisibleCursor which lands with the realtime batch).
    const latest = (await Promise.resolve(this.messages.getByThread(threadId, 1, userId)))[0] ?? null
    if (!latest) {
      return { advanced: false, caughtUp: true, reason: 'no messages' }
    }
    const advanced = await this.gatedAck(userId, threadId, latest.id)
    const afterState = await Promise.resolve(this.readStates.get(userId, threadId))
    const caughtUp =
      advanced || (!!afterState && afterState.lastReadMessageId === latest.id)
    return { advanced, caughtUp }
  }

  /** F072: mark all of a user's threads as read. */
  async markAllRead(userId: UserId): Promise<MarkAllReadResult> {
    const threads = await Promise.resolve(
      this.ctx.catStores.threads().listForUser(userId, { includeArchived: true, limit: 1000 }),
    )
    let advancedCount = 0
    for (const thread of threads) {
      if (thread.archivedAt !== undefined) continue
      const latest = (await Promise.resolve(this.messages.getByThread(thread.id, 1, userId)))[0] ?? null
      if (!latest) continue
      const advanced = await this.gatedAck(userId, thread.id, latest.id)
      if (advanced) advancedCount++
    }
    return { advancedCount, totalThreads: threads.length }
  }

  /** F069: unread badge summaries for the given (or all active) threads. */
  async getUnreadSummaries(userId: UserId, threadIds?: readonly string[]): Promise<ThreadUnreadSummary[]> {
    const ids = threadIds ?? (
      await Promise.resolve(this.ctx.catStores.threads().listForUser(userId, { limit: 200 }))
    )
      .filter((t) => t.archivedAt === undefined)
      .map((t) => t.id)
    return Promise.resolve(this.readStates.getUnreadSummaries(userId, ids, this.messages))
  }

  /** Raw cursor access (for projections that need ThreadReadState directly). */
  async get(userId: UserId, threadId: string): Promise<ThreadReadState | null> {
    return Promise.resolve(this.readStates.get(userId, threadId))
  }
}
