/**
 * ITaskStore — Forgekin task store port.
 *
 * Ported from clowder-ai `TaskStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2: create / get / list / update status / delete.
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId } from '@flowforge/cats-shared'
import type { TaskKind, TaskStatus } from '@flowforge/cats-shared'

/** A stored task. */
export interface StoredTask {
  readonly id: string
  readonly threadId: string
  readonly userId: string
  readonly catId: CatId | null
  readonly title: string
  readonly description?: string
  readonly status: TaskStatus
  readonly kind: TaskKind
  readonly createdAt: number
  readonly updatedAt: number
  readonly completedAt?: number
  readonly dueAt?: number
  readonly labels?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/** Input for creating a task (id/timestamps are store-owned). */
export type CreateTaskInput = Omit<
  StoredTask,
  'id' | 'createdAt' | 'updatedAt'
> & {
  readonly id?: string
}

/** Update patch — only mutable fields. */
export interface UpdateTaskPatch {
  readonly title?: string
  readonly description?: string
  readonly status?: TaskStatus
  readonly catId?: CatId | null
  readonly dueAt?: number
  readonly labels?: readonly string[]
  readonly metadata?: Record<string, unknown>
  readonly completedAt?: number
}

/** Common interface for task stores. */
export interface ITaskStore {
  create(input: CreateTaskInput): StoredTask | Promise<StoredTask>
  getById(id: string): StoredTask | null | Promise<StoredTask | null>
  listForThread(threadId: string, options?: {
    readonly status?: TaskStatus
    readonly kind?: TaskKind
  }): StoredTask[] | Promise<StoredTask[]>
  listForCat(catId: CatId, options?: {
    readonly status?: TaskStatus
    readonly kind?: TaskKind
  }): StoredTask[] | Promise<StoredTask[]>
  listForUser(userId: string, options?: {
    readonly status?: TaskStatus
  }): StoredTask[] | Promise<StoredTask[]>
  update(id: string, patch: UpdateTaskPatch): StoredTask | null | Promise<StoredTask | null>
  delete(id: string): boolean | Promise<boolean>
}
