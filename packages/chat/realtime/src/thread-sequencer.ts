/**
 * ThreadSequencer — thread-scoped monotonic sequence number.
 *
 * 移植自 clowder-ai `ThreadSequencer.ts`（F183 Phase C，KD-9 2026-05-02 拍板）：
 * 选 thread-scoped 而非 global monotonic —— 每个 thread 独立编号，跨 thread
 * 不保证全局顺序（用户场景无此需求）。
 *
 * 实施约束（保持 clowder-ai 语义）：
 * - 单实例 in-memory（KD-9 拒绝 multi-instance 分布式 sequencer over-engineering）
 * - 服务重启 → counter reset；instance epoch（boot UUID）跟着重置，client 比对
 *   epoch 不一致 → 重置 lastSeq + 触发 catch-up
 * - 消息归属由 `threadId` 字段决定，跟 seq 无关
 *
 * 配套：客户端用 (epoch, seq) 做 gap detection + 触发 stream catch-up。
 *
 * @module @flowforge/chat-realtime/sequencer
 */

import { randomUUID } from 'node:crypto'

/**
 * Per-thread monotonic sequence allocator with a boot-stable epoch.
 *
 * The epoch identifies this sequencer generation（server boot UUID）。Client
 * uses it to detect server restart: if incoming epoch differs from lastSeqEpoch
 * for that thread, client resets lastSeq + triggers catch-up. Without epoch,
 * restart could leave client with high-water lastSeq=500 while server emits
 * seq=1,2,3... — gap detection would silently fail until server catches up.
 */
export class ThreadSequencer {
  private readonly threadSeqs: Map<string, number> = new Map()
  private readonly _epoch: string

  constructor(epochOverride?: string) {
    this._epoch = epochOverride ?? randomUUID()
  }

  /** Instance epoch (server boot UUID). Stable for sequencer lifetime. */
  get epoch(): string {
    return this._epoch
  }

  /** Increment + return next seq for thread. First call returns 1. */
  next(threadId: string): number {
    const next = (this.threadSeqs.get(threadId) ?? 0) + 1
    this.threadSeqs.set(threadId, next)
    return next
  }

  /** Read current seq without incrementing. Returns 0 for unseen thread. */
  peek(threadId: string): number {
    return this.threadSeqs.get(threadId) ?? 0
  }

  /**
   * Bump counter to at least `seq` for thread, preserving monotonicity when
   * a caller supplies a seq override（e.g. deterministic test fixtures）。
   * Without this, subsequent auto-assigned seqs could reuse lower numbers and
   * clients would treat fresh events as 'late'/'gap'. Idempotent —
   * bumpTo(threadId, smaller) is a no-op.
   */
  bumpTo(threadId: string, seq: number): void {
    if (typeof seq !== 'number' || seq <= 0) return
    const current = this.threadSeqs.get(threadId) ?? 0
    if (seq > current) this.threadSeqs.set(threadId, seq)
  }

  /** Test/admin only: reset a thread's seq counter to 0. */
  reset(threadId: string): void {
    this.threadSeqs.delete(threadId)
  }

  /** Test only: clear all thread seq state. */
  resetAll(): void {
    this.threadSeqs.clear()
  }
}
