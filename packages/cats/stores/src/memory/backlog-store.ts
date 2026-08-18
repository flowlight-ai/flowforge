/**
 * MemoryBacklogStore — in-memory implementation of {@link IBacklogStore}.
 *
 * Ported from clowder-ai `BacklogStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2.
 *
 * BacklogItem field semantics (per `@flowforge/cats-shared/types/backlog.ts`):
 * - `dispatchedThreadId` — the thread an item has been dispatched to (for `listForThread`)
 * - `lease?.ownerCatId` — current lease holder (for `listForCat`)
 * - `suggestion` — single pending claim suggestion (for `addClaimSuggestion`)
 *
 * @module @flowforge/cats-stores/memory
 */

import { generateId } from '@flowforge/cats-shared'
import type {
  BacklogAuditEntry,
  BacklogClaimSuggestion,
  BacklogItem,
  BacklogLease,
  CatId,
  CreateBacklogInput,
  IBacklogStore,
  UpdateBacklogPatch,
} from '../ports/backlog-store.ts'

/**
 * In-memory backlog store. Not durable across processes — use the Sqlite backend
 * (`@flowforge/cats-stores-sqlite`) for persistence.
 */
export class MemoryBacklogStore implements IBacklogStore {
  private items = new Map<string, BacklogItem>()

  create(input: CreateBacklogInput): BacklogItem {
    const id = input.id ?? generateId('backlog')
    const now = Date.now()
    if (this.items.has(id)) {
      throw new Error(`backlog item "${id}" already exists`)
    }
    const stored: BacklogItem = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      audit: [],
    }
    this.items.set(id, stored)
    return stored
  }

  getById(id: string): BacklogItem | null {
    return this.items.get(id) ?? null
  }

  listForThread(threadId: string, options?: {
    readonly status?: BacklogItem['status']
    readonly priority?: BacklogItem['priority']
  }): BacklogItem[] {
    const matches: BacklogItem[] = []
    for (const item of this.items.values()) {
      // An item belongs to a thread once it has been dispatched there.
      if (item.dispatchedThreadId !== threadId) continue
      if (options?.status && item.status !== options.status) continue
      if (options?.priority && item.priority !== options.priority) continue
      matches.push(item)
    }
    matches.sort((a, b) => a.createdAt - b.createdAt)
    return matches
  }

  listForCat(catId: CatId, options?: {
    readonly status?: BacklogItem['status']
  }): BacklogItem[] {
    const matches: BacklogItem[] = []
    for (const item of this.items.values()) {
      // A cat "owns" an item iff it currently holds the lease.
      if (item.lease?.ownerCatId !== catId) continue
      if (options?.status && item.status !== options.status) continue
      matches.push(item)
    }
    matches.sort((a, b) => a.createdAt - b.createdAt)
    return matches
  }

  update(id: string, patch: UpdateBacklogPatch): BacklogItem | null {
    const existing = this.items.get(id)
    if (!existing) return null
    const updated: BacklogItem = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.items.set(id, updated)
    return updated
  }

  delete(id: string): boolean {
    return this.items.delete(id)
  }

  appendAudit(id: string, entry: BacklogAuditEntry): BacklogItem | null {
    const existing = this.items.get(id)
    if (!existing) return null
    const updated: BacklogItem = {
      ...existing,
      audit: [...existing.audit, entry],
      updatedAt: Date.now(),
    }
    this.items.set(id, updated)
    return updated
  }

  addClaimSuggestion(id: string, suggestion: BacklogClaimSuggestion): BacklogItem | null {
    const existing = this.items.get(id)
    if (!existing) return null
    // BacklogItem.suggestion is a single pending claim (replaces prior suggestion).
    const updated: BacklogItem = {
      ...existing,
      suggestion,
      updatedAt: Date.now(),
    }
    this.items.set(id, updated)
    return updated
  }

  setLease(id: string, lease: BacklogLease | null): BacklogItem | null {
    const existing = this.items.get(id)
    if (!existing) return null
    // Use conditional spread so passing `null` clears the lease (omits the field),
    // and passing a lease overrides it. Avoids `delete` on readonly fields.
    const updated: BacklogItem = {
      ...existing,
      ...(lease ? { lease } : {}),
      updatedAt: Date.now(),
    }
    // When clearing, we need to produce a record without `lease`. Use destructure.
    const finalItem: BacklogItem = lease
      ? updated
      : stripField(updated, 'lease')
    this.items.set(id, finalItem)
    return finalItem
  }
}

/**
 * Return a shallow copy of `value` with `key` removed, preserving the rest.
 *
 * Used to clear optional readonly fields without using `delete` (which is
 * rejected by `exactOptionalPropertyTypes`/readonly enforcement).
 */
function stripField<T, K extends keyof T>(value: T, key: K): T {
  const { [key]: _removed, ...rest } = value as Record<string, unknown>
  void _removed
  return rest as T
}
