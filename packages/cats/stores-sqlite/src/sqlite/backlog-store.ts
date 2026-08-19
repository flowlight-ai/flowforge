/**
 * SqliteBacklogStore — SQLite implementation of {@link IBacklogStore}.
 *
 * 行为基准：`@flowforge/cats-stores/memory/backlog-store.ts`（语义 1:1）：
 * store-owned id、create 附带空 audit、listForThread 按 dispatchedThreadId
 * 归属、listForCat 按 lease.ownerCatId 归属、appendAudit 追加、
 * addClaimSuggestion 单条替换、setLease set/null 清除。lease 归属列
 * `lease_cat_id` 在 null lease 时清空（与 memory 版 stripField 语义一致）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateId } from '@flowforge/cats-shared'
import type { CatId } from '@flowforge/cats-shared'
import type {
  BacklogAuditEntry,
  BacklogClaimSuggestion,
  BacklogItem,
  BacklogLease,
  CreateBacklogInput,
  IBacklogStore,
  UpdateBacklogPatch,
} from '@flowforge/cats-stores/ports'

/** A row of the `backlogs` table (`data` holds the full record JSON). */
interface BacklogRow {
  readonly id: string
  readonly data: string
}

/**
 * Return a shallow copy of `value` with `key` removed, preserving the rest.
 * Used to clear optional readonly fields without `delete`.
 */
function stripField<T, K extends keyof T>(value: T, key: K): T {
  const { [key]: _removed, ...rest } = value as Record<string, unknown>
  void _removed
  return rest as T
}

/** SQLite backlog store — durable across processes. */
export class SqliteBacklogStore implements IBacklogStore {
  constructor(private readonly db: DatabaseSync) {}

  private parse(row: BacklogRow | undefined): BacklogItem | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as BacklogItem
  }

  private writeRow(item: BacklogItem): void {
    this.db.prepare(`
      INSERT INTO backlogs (id, dispatched_thread_id, lease_cat_id, status, priority, created_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        dispatched_thread_id = excluded.dispatched_thread_id,
        lease_cat_id = excluded.lease_cat_id,
        status = excluded.status,
        priority = excluded.priority,
        created_at = excluded.created_at,
        data = excluded.data
    `).run(
      item.id,
      item.dispatchedThreadId ?? null,
      item.lease?.ownerCatId ?? null,
      item.status,
      item.priority,
      item.createdAt,
      JSON.stringify(item),
    )
  }

  create(input: CreateBacklogInput): BacklogItem {
    const id = input.id ?? generateId('backlog')
    const now = Date.now()
    if (this.getById(id) !== null) {
      throw new Error(`backlog item "${id}" already exists`)
    }
    const stored: BacklogItem = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      audit: [],
    }
    this.writeRow(stored)
    return stored
  }

  getById(id: string): BacklogItem | null {
    return this.parse(this.db.prepare('SELECT * FROM backlogs WHERE id = ?').get(id) as unknown as BacklogRow | undefined)
  }

  private list(sql: string, params: readonly string[]): BacklogItem[] {
    const rows = this.db.prepare(sql).all(...params) as unknown as BacklogRow[]
    return rows.map(row => JSON.parse(row.data) as BacklogItem)
  }

  listForThread(threadId: string, options?: {
    readonly status?: BacklogItem['status']
    readonly priority?: BacklogItem['priority']
  }): BacklogItem[] {
    // An item belongs to a thread once it has been dispatched there.
    const clauses = ['dispatched_thread_id = ?']
    const params: string[] = [threadId]
    if (options?.status) {
      clauses.push('status = ?')
      params.push(options.status)
    }
    if (options?.priority) {
      clauses.push('priority = ?')
      params.push(options.priority)
    }
    return this.list(
      `SELECT * FROM backlogs WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC`,
      params,
    )
  }

  listForCat(catId: CatId, options?: {
    readonly status?: BacklogItem['status']
  }): BacklogItem[] {
    // A cat "owns" an item iff it currently holds the lease.
    const clauses = ['lease_cat_id = ?']
    const params: string[] = [catId]
    if (options?.status) {
      clauses.push('status = ?')
      params.push(options.status)
    }
    return this.list(
      `SELECT * FROM backlogs WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC`,
      params,
    )
  }

  private patch(id: string, mutate: (existing: BacklogItem) => BacklogItem): BacklogItem | null {
    const existing = this.getById(id)
    if (!existing) return null
    const updated = mutate(existing)
    this.writeRow(updated)
    return updated
  }

  update(id: string, patch: UpdateBacklogPatch): BacklogItem | null {
    return this.patch(id, existing => ({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }))
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM backlogs WHERE id = ?').run(id).changes) > 0
  }

  appendAudit(id: string, entry: BacklogAuditEntry): BacklogItem | null {
    return this.patch(id, existing => ({
      ...existing,
      audit: [...existing.audit, entry],
      updatedAt: Date.now(),
    }))
  }

  addClaimSuggestion(id: string, suggestion: BacklogClaimSuggestion): BacklogItem | null {
    return this.patch(id, existing => ({
      ...existing,
      suggestion,
      updatedAt: Date.now(),
    }))
  }

  setLease(id: string, lease: BacklogLease | null): BacklogItem | null {
    return this.patch(id, (existing) => {
      // `null` clears the lease (field omitted); a lease overrides it.
      const updated: BacklogItem = {
        ...existing,
        ...(lease ? { lease } : {}),
        updatedAt: Date.now(),
      }
      return lease ? updated : stripField(updated, 'lease')
    })
  }
}
