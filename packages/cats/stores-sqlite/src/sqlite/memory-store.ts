/**
 * SqliteMemoryStore — SQLite implementation of {@link IMemoryStore}.
 *
 * 行为基准：`@flowforge/cats-stores/memory/memory-store.ts`（语义 1:1）：
 * store-owned id、listForCat 按 createdAt 倒序 + kind 过滤 + limit、
 * update patch 合并、delete；searchSimilar 返回 []（向量后端落地前与
 * memory 版一致）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateId, type CatId } from '@flowforge/cats-shared'
import type {
  CreateMemoryInput,
  IMemoryStore,
  StoredMemory,
  UpdateMemoryPatch,
} from '@flowforge/cats-stores/ports'

/** A row of the `cat_memories` table (`data` holds the full record JSON). */
interface MemoryRow {
  readonly id: string
  readonly data: string
}

/** SQLite long-term memory (dossier) store — durable across processes. */
export class SqliteMemoryStore implements IMemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  private parse(row: MemoryRow | undefined): StoredMemory | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as StoredMemory
  }

  private writeRow(memory: StoredMemory): void {
    this.db.prepare(`
      INSERT INTO cat_memories (id, cat_id, kind, created_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cat_id = excluded.cat_id,
        kind = excluded.kind,
        created_at = excluded.created_at,
        data = excluded.data
    `).run(memory.id, memory.catId, memory.kind, memory.createdAt, JSON.stringify(memory))
  }

  create(input: CreateMemoryInput): StoredMemory {
    const id = input.id ?? generateId('memory')
    const now = Date.now()
    if (this.getById(id) !== null) {
      throw new Error(`memory "${id}" already exists`)
    }
    const stored: StoredMemory = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.writeRow(stored)
    return stored
  }

  getById(id: string): StoredMemory | null {
    return this.parse(this.db.prepare('SELECT * FROM cat_memories WHERE id = ?').get(id) as unknown as MemoryRow | undefined)
  }

  listForCat(catId: CatId, options?: {
    readonly kind?: StoredMemory['kind']
    readonly limit?: number
  }): StoredMemory[] {
    const limit = options?.limit ?? 100
    const rows = (options?.kind
      ? this.db.prepare('SELECT * FROM cat_memories WHERE cat_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?')
        .all(catId, options.kind, limit)
      : this.db.prepare('SELECT * FROM cat_memories WHERE cat_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(catId, limit)) as unknown as MemoryRow[]
    return rows.map(row => JSON.parse(row.data) as StoredMemory)
  }

  update(id: string, patch: UpdateMemoryPatch): StoredMemory | null {
    const existing = this.getById(id)
    if (!existing) return null
    const updated: StoredMemory = {
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
    return Number(this.db.prepare('DELETE FROM cat_memories WHERE id = ?').run(id).changes) > 0
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
