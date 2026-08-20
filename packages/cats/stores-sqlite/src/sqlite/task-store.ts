/**
 * SqliteTaskStore — SQLite implementation of {@link ITaskStore}.
 *
 * 行为基准：`@flowforge/cats-stores/memory/task-store.ts`（语义 1:1）：
 * store-owned id、重复 id 抛错、listForThread/listForCat 按 createdAt 升序、
 * listForUser 按 updatedAt 倒序、status/kind 过滤走提取索引列、update patch
 * 合并、delete。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateId, type CatId } from '@flowforge/cats-shared'
import type {
  CreateTaskInput,
  ITaskStore,
  StoredTask,
  UpdateTaskPatch,
} from '@flowforge/cats-stores/ports'

/** A row of the `tasks` table (`data` holds the full record JSON). */
interface TaskRow {
  readonly id: string
  readonly data: string
}

/** SQLite task store — durable across processes. */
export class SqliteTaskStore implements ITaskStore {
  constructor(private readonly db: DatabaseSync) {}

  private parse(row: TaskRow | undefined): StoredTask | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as StoredTask
  }

  private writeRow(task: StoredTask): void {
    this.db.prepare(`
      INSERT INTO tasks (id, thread_id, cat_id, user_id, status, kind, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thread_id = excluded.thread_id,
        cat_id = excluded.cat_id,
        user_id = excluded.user_id,
        status = excluded.status,
        kind = excluded.kind,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      task.id,
      task.threadId,
      task.catId,
      task.userId,
      task.status,
      task.kind,
      task.createdAt,
      task.updatedAt,
      JSON.stringify(task),
    )
  }

  create(input: CreateTaskInput): StoredTask {
    const id = input.id ?? generateId('task')
    const now = Date.now()
    if (this.getById(id) !== null) {
      throw new Error(`task "${id}" already exists`)
    }
    const stored: StoredTask = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.writeRow(stored)
    return stored
  }

  getById(id: string): StoredTask | null {
    return this.parse(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined)
  }

  private list(sql: string, params: readonly string[]): StoredTask[] {
    const rows = this.db.prepare(sql).all(...params) as unknown as TaskRow[]
    return rows.map(row => JSON.parse(row.data) as StoredTask)
  }

  listForThread(threadId: string, options?: {
    readonly status?: StoredTask['status']
    readonly kind?: StoredTask['kind']
  }): StoredTask[] {
    const clauses = ['thread_id = ?']
    const params: string[] = [threadId]
    if (options?.status) {
      clauses.push('status = ?')
      params.push(options.status)
    }
    if (options?.kind) {
      clauses.push('kind = ?')
      params.push(options.kind)
    }
    return this.list(
      `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC`,
      params,
    )
  }

  listForCat(catId: CatId, options?: {
    readonly status?: StoredTask['status']
    readonly kind?: StoredTask['kind']
  }): StoredTask[] {
    const clauses = ['cat_id = ?']
    const params: string[] = [catId]
    if (options?.status) {
      clauses.push('status = ?')
      params.push(options.status)
    }
    if (options?.kind) {
      clauses.push('kind = ?')
      params.push(options.kind)
    }
    return this.list(
      `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC`,
      params,
    )
  }

  listForUser(userId: string, options?: {
    readonly status?: StoredTask['status']
  }): StoredTask[] {
    const clauses = ['user_id = ?']
    const params: string[] = [userId]
    if (options?.status) {
      clauses.push('status = ?')
      params.push(options.status)
    }
    return this.list(
      `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`,
      params,
    )
  }

  update(id: string, patch: UpdateTaskPatch): StoredTask | null {
    const existing = this.getById(id)
    if (!existing) return null
    const updated: StoredTask = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }
    this.writeRow(updated)
    return updated
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes) > 0
  }
}
