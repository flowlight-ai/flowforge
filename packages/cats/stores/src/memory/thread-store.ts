/**
 * MemoryThreadStore — in-memory implementation of {@link IThreadStore}.
 *
 * Ported from clowder-ai `ThreadStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2.
 *
 * @module @flowforge/cats-stores/memory
 */

import { generateId } from '@flowforge/cats-shared'
import type {
  CreateThreadInput,
  IThreadStore,
  StoredThread,
  UpdateThreadPatch,
} from '../ports/thread-store.ts'

/**
 * In-memory thread store. Not durable across processes — use the Sqlite backend
 * (`@flowforge/cats-stores-sqlite`) for persistence.
 */
export class MemoryThreadStore implements IThreadStore {
  private threads = new Map<string, StoredThread>()

  create(input: CreateThreadInput): StoredThread {
    const id = input.id ?? generateId('thread')
    const now = Date.now()
    if (this.threads.has(id)) {
      throw new Error(`thread "${id}" already exists`)
    }
    const stored: StoredThread = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.threads.set(id, stored)
    return stored
  }

  getById(id: string): StoredThread | null {
    return this.threads.get(id) ?? null
  }

  listForUser(userId: string, options?: {
    readonly includeArchived?: boolean
    readonly limit?: number
  }): StoredThread[] {
    const limit = options?.limit ?? 100
    const includeArchived = options?.includeArchived ?? false
    const matches: StoredThread[] = []
    for (const thread of this.threads.values()) {
      if (thread.userId !== userId) continue
      if (!includeArchived && thread.archivedAt) continue
      matches.push(thread)
    }
    matches.sort((a, b) => b.updatedAt - a.updatedAt)
    return matches.slice(0, limit)
  }

  update(id: string, patch: UpdateThreadPatch): StoredThread | null {
    const existing = this.threads.get(id)
    if (!existing) return null
    const updated: StoredThread = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.threads.set(id, updated)
    return updated
  }

  archive(id: string, _archivedBy: string): StoredThread | null {
    return this.update(id, { archivedAt: Date.now() })
  }

  unarchive(id: string): StoredThread | null {
    const existing = this.threads.get(id)
    if (!existing) return null
    // Strip archivedAt by destructuring it out (avoids `delete` on readonly,
    // and avoids mutating updatedAt in place). Bump updatedAt via spread.
    const { archivedAt: _omit, ...rest } = existing
    void _omit
    const restored: StoredThread = {
      ...rest,
      updatedAt: Date.now(),
    } as StoredThread
    this.threads.set(id, restored)
    return restored
  }

  touchLastMessage(id: string, messageId: string, at: number): StoredThread | null {
    return this.update(id, { lastMessageAt: at, lastMessageId: messageId })
  }

  delete(id: string): boolean {
    return this.threads.delete(id)
  }
}
