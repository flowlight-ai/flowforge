/**
 * MemoryTaskStore — in-memory implementation of {@link ITaskStore}.
 *
 * Ported from clowder-ai `TaskStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2.
 *
 * @module @flowforge/cats-stores/memory
 */

import { generateId, type CatId } from '@flowforge/cats-shared'
import type {
  CreateTaskInput,
  ITaskStore,
  StoredTask,
  UpdateTaskPatch,
} from '../ports/task-store.ts'

/**
 * In-memory task store. Not durable across processes — use the Sqlite backend
 * (`@flowforge/cats-stores-sqlite`) for persistence.
 */
export class MemoryTaskStore implements ITaskStore {
  private tasks = new Map<string, StoredTask>()

  create(input: CreateTaskInput): StoredTask {
    const id = input.id ?? generateId('task')
    const now = Date.now()
    if (this.tasks.has(id)) {
      throw new Error(`task "${id}" already exists`)
    }
    const stored: StoredTask = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(id, stored)
    return stored
  }

  getById(id: string): StoredTask | null {
    return this.tasks.get(id) ?? null
  }

  listForThread(threadId: string, options?: {
    readonly status?: StoredTask['status']
    readonly kind?: StoredTask['kind']
  }): StoredTask[] {
    const matches: StoredTask[] = []
    for (const task of this.tasks.values()) {
      if (task.threadId !== threadId) continue
      if (options?.status && task.status !== options.status) continue
      if (options?.kind && task.kind !== options.kind) continue
      matches.push(task)
    }
    matches.sort((a, b) => a.createdAt - b.createdAt)
    return matches
  }

  listForCat(catId: CatId, options?: {
    readonly status?: StoredTask['status']
    readonly kind?: StoredTask['kind']
  }): StoredTask[] {
    const matches: StoredTask[] = []
    for (const task of this.tasks.values()) {
      if (task.catId !== catId) continue
      if (options?.status && task.status !== options.status) continue
      if (options?.kind && task.kind !== options.kind) continue
      matches.push(task)
    }
    matches.sort((a, b) => a.createdAt - b.createdAt)
    return matches
  }

  listForUser(userId: string, options?: {
    readonly status?: StoredTask['status']
  }): StoredTask[] {
    const matches: StoredTask[] = []
    for (const task of this.tasks.values()) {
      if (task.userId !== userId) continue
      if (options?.status && task.status !== options.status) continue
      matches.push(task)
    }
    matches.sort((a, b) => b.updatedAt - a.updatedAt)
    return matches
  }

  update(id: string, patch: UpdateTaskPatch): StoredTask | null {
    const existing = this.tasks.get(id)
    if (!existing) return null
    const updated: StoredTask = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.tasks.set(id, updated)
    return updated
  }

  delete(id: string): boolean {
    return this.tasks.delete(id)
  }
}
