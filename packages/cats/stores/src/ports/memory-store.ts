/**
 * IMemoryStore — Forgekin long-term memory store port (per-CatId dossier memories).
 *
 * Ported from clowder-ai `MemoryStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2.
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId } from '@flowforge/cats-shared'

/** A stored memory entry. */
export interface StoredMemory {
  readonly id: string
  readonly catId: CatId
  readonly kind: 'episode' | 'preference' | 'skill' | 'fact' | 'event'
  readonly content: string
  readonly importance: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt?: number
  readonly metadata?: Record<string, unknown>
  /** Vector embedding for similarity retrieval (deferred to batch with vector backend). */
  readonly embedding?: readonly number[]
}

/** Input for creating a memory entry. */
export type CreateMemoryInput = Omit<
  StoredMemory,
  'id' | 'createdAt' | 'updatedAt'
> & {
  readonly id?: string
}

/** Update patch. */
export interface UpdateMemoryPatch {
  readonly content?: string
  readonly importance?: number
  readonly expiresAt?: number
  readonly metadata?: Record<string, unknown>
}

/** Common interface for memory stores. */
export interface IMemoryStore {
  create(input: CreateMemoryInput): StoredMemory | Promise<StoredMemory>
  getById(id: string): StoredMemory | null | Promise<StoredMemory | null>
  listForCat(catId: CatId, options?: {
    readonly kind?: StoredMemory['kind']
    readonly limit?: number
  }): StoredMemory[] | Promise<StoredMemory[]>
  update(id: string, patch: UpdateMemoryPatch): StoredMemory | null | Promise<StoredMemory | null>
  delete(id: string): boolean | Promise<boolean>
  /** Similarity search (returns [] until vector backend lands). */
  searchSimilar(
    catId: CatId,
    embedding: readonly number[],
    options?: { readonly limit?: number; readonly threshold?: number },
  ): StoredMemory[] | Promise<StoredMemory[]>
}

export type { CatId }
