/**
 * MemoryDeliveryCursorStore — in-memory IDeliveryCursorStore (F254).
 *
 * Ported from clowder-ai `DeliveryCursorStore`. The delivery and seen cursor
 * namespaces are backed by independent maps so writes to one can never leak
 * into the other (AC-A9 independence). Message IDs are lexicographically
 * sortable strings — plain string comparison is monotonic (no v2 visibility
 * sequence needed in flowforge).
 *
 * @module @flowforge/cats-stores/memory
 */

import type { CatId, ThreadId, UserId } from '@flowforge/cats-shared'
import type { IDeliveryCursorStore } from '../ports/delivery-cursor-store.ts'

function cursorKey(userId: UserId, catId: CatId, threadId: ThreadId): string {
  return `${userId}::${catId}::${threadId}`
}

/** In-memory implementation for tests and single-process dev. */
export class MemoryDeliveryCursorStore implements IDeliveryCursorStore {
  private readonly deliveryCursors = new Map<string, string>()
  private readonly seenCursors = new Map<string, string>()

  getDeliveryCursor(userId: UserId, catId: CatId, threadId: ThreadId): string | null {
    return this.deliveryCursors.get(cursorKey(userId, catId, threadId)) ?? null
  }

  setDeliveryCursor(userId: UserId, catId: CatId, threadId: ThreadId, cursor: string): void {
    this.deliveryCursors.set(cursorKey(userId, catId, threadId), cursor)
  }

  getSeenCursor(userId: UserId, catId: CatId, threadId: ThreadId): string | null {
    return this.seenCursors.get(cursorKey(userId, catId, threadId)) ?? null
  }

  setSeenCursor(userId: UserId, catId: CatId, threadId: ThreadId, cursor: string): void {
    this.seenCursors.set(cursorKey(userId, catId, threadId), cursor)
  }
}
