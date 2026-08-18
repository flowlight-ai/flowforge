/**
 * IThreadStore — Forgekin thread store port.
 *
 * Ported from clowder-ai `ThreadStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2: create / get / list / archive.
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId, ThreadId, UserId } from '@flowforge/cats-shared'

/** A stored thread. */
export interface StoredThread {
  readonly id: string
  readonly userId: string
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly archivedAt?: number
  readonly lastMessageAt?: number
  readonly lastMessageId?: string
  readonly assignedCatIds?: readonly CatId[]
  readonly labels?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/** Input for creating a thread (id/createdAt/updatedAt are store-owned). */
export type CreateThreadInput = Omit<
  StoredThread,
  'id' | 'createdAt' | 'updatedAt'
> & {
  readonly id?: string
}

/** Update patch — only mutable fields. */
export interface UpdateThreadPatch {
  readonly title?: string
  readonly archivedAt?: number
  readonly lastMessageAt?: number
  readonly lastMessageId?: string
  readonly assignedCatIds?: readonly CatId[]
  readonly labels?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/** Common interface for thread stores. */
export interface IThreadStore {
  create(input: CreateThreadInput): StoredThread | Promise<StoredThread>
  getById(id: string): StoredThread | null | Promise<StoredThread | null>
  listForUser(userId: UserId, options?: {
    readonly includeArchived?: boolean
    readonly limit?: number
  }): StoredThread[] | Promise<StoredThread[]>
  update(id: string, patch: UpdateThreadPatch): StoredThread | null | Promise<StoredThread | null>
  archive(id: string, archivedBy: string): StoredThread | null | Promise<StoredThread | null>
  unarchive(id: string): StoredThread | null | Promise<StoredThread | null>
  /** Bump the thread's lastMessageAt/lastMessageId. Returns null if not found. */
  touchLastMessage(id: string, messageId: string, at: number): StoredThread | null | Promise<StoredThread | null>
  delete(id: string): boolean | Promise<boolean>
}

export type { CatId, ThreadId }
