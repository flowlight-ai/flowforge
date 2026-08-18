/**
 * MemoryMemoryStore — in-memory implementation of {@link IMemoryStore}.
 *
 * Ported from clowder-ai `MemoryStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2. Similarity search returns []
 * until a vector backend lands in a later batch.
 *
 * @module @flowforge/cats-stores/memory
 */

import { generateId, type CatId } from '@flowforge/cats-shared'
import type {
  CreateMemoryInput,
  IMemoryStore,
  StoredMemory,
  UpdateMemoryPatch,
} from '../ports/memory-store.ts'

/**
 * In-memory long-term memory store. Not durable across processes — use the
 * Sqlite backend (`@flowforge/cats-stores-sqlite`) for persistence.
 */
export class MemoryMemoryStore implements IMemoryStore {
  private memories = new Map<string, StoredMemory>()

  create(input: CreateMemoryInput): StoredMemory {
    const id = input.id ?? generateId('memory')
    const now = Date.now()
    if (this.memories.has(id)) {
      throw new Error(`memory "${id}" already exists`)
    }
    const stored: StoredMemory = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.memories.set(id, stored)
    return stored
  }

  getById(id: string): StoredMemory | null {
    return this.memories.get(id) ?? null
  }

  listForCat(catId: CatId, options?: {
    readonly kind?: StoredMemory['kind']
    readonly limit?: number
  }): StoredMemory[] {
    const limit = options?.limit ?? 100
    const matches: StoredMemory[] = []
    for (const memory of this.memories.values()) {
      if (memory.catId !== catId) continue
      if (options?.kind && memory.kind !== options.kind) continue
      matches.push(memory)
    }
    matches.sort((a, b) => b.createdAt - a.createdAt)
    return matches.slice(0, limit)
  }

  update(id: string, patch: UpdateMemoryPatch): StoredMemory | null {
    const existing = this.memories.get(id)
    if (!existing) return null
    const updated: StoredMemory = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.memories.set(id, updated)
    return updated
  }

  delete(id: string): boolean {
    return this.memories.delete(id)
  }

  /** Returns [] until a vector backend lands in a later batch. */
  searchSimilar(
    _catId: CatId,
    _embedding: readonly number[],
    _options?: { readonly limit?: number; readonly threshold?: number },
  ): StoredMemory[] {
    return []
  }
}
