/**
 * IDeliveryCursorStore — per user × cat × thread delivery/seen cursor port.
 *
 * F254 批次5 裁剪说明：clowder-ai 的 DeliveryCursorStore 是带 sessionStore +
 * v1/v2 cursor canonicalizer 的具体类。flowforge 移植保留其两个核心 cursor
 * 命名空间（delivery 与 seen 相互独立，AC-A9），去掉 v2 可见性序列机制——
 * 消息 ID 本身 lexicographically sortable，字符串比较即单调。
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId, ThreadId, UserId } from '@flowforge/cats-shared'

export interface IDeliveryCursorStore {
  /** Last delivered message id (sortable-string domain). */
  getDeliveryCursor(userId: UserId, catId: CatId, threadId: ThreadId): string | null | Promise<string | null>
  setDeliveryCursor(userId: UserId, catId: CatId, threadId: ThreadId, cursor: string): void | Promise<void>
  /**
   * F254: seen cursor — what the cat READ mid-turn. MUST NOT affect the
   * delivery cursor or incremental injection (AC-A9 independence).
   */
  getSeenCursor(userId: UserId, catId: CatId, threadId: ThreadId): string | null | Promise<string | null>
  setSeenCursor(userId: UserId, catId: CatId, threadId: ThreadId, cursor: string): void | Promise<void>
}
