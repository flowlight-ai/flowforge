/**
 * SqliteSessionChainStore — durable ISessionChainStore（F24 会话链，批次 6.5）.
 *
 * 语义对齐 `@flowforge/cats-stores` Memory 版（批次 6.2a）。Memory 版的三
 * 索引经 SQL 等价实现：
 * - `activeIndex`（catId:threadId → 最新 active 记录）→ `is_active` 列：
 *   create / update(status→active) 时置 1 并清掉同 (cat, thread) 的其他行，
 *   update(→非 active) 仅清本行 —— 完整复现 "activeIndex 指向谁" 的语义，
 *   包括把 active 让渡给低 seq 记录的退化路径。
 * - `cliIndex` → `cli_session_id UNIQUE` 约束 + 查询。
 * - `chainKeyIndex`（F198 写容忍）→ `chain_key` 索引列 + `ORDER BY
 *   created_at DESC LIMIT 1`（同 key 最新写入胜出，与 Map 覆盖一致）。
 *
 * seq 分配（`MAX(seq)+1`）与 update 的补丁应用（含 sealReason / sealedAt
 * 的 null 删除语义）都在 `BEGIN IMMEDIATE` 事务内完成 —— 对应 Redis Lua
 * 的原子性替代。
 *
 * 与 Memory 版的差异（持久化存储的刻意取舍）：
 * - 无容量上限：不保留 MAX_RECORDS=1000 三级驱逐（持久化血统不丢数据）。
 * - cliSessionId 冲突：Memory 版静默覆盖 cliIndex（旧行失联），本实现按
 *   表约束直接抛 UNIQUE 约束错误 —— 冲突应走 reuseExistingCliSession 路径。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CatId, SessionRecord } from '@flowforge/cats-shared'
import type {
  CreateSessionInput,
  ISessionChainStore,
  SessionRecordPatch,
  StoreReadOptions,
} from '@flowforge/cats-stores/ports'
import { throwIfStoreReadAborted } from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

/** Row shape of the `session_chain` table. */
interface SessionChainRow {
  readonly id: string
  readonly cat_id: string
  readonly thread_id: string
  readonly cli_session_id: string
  readonly chain_key: string | null
  readonly seq: number
  readonly status: string
  readonly is_active: number
  readonly created_at: number
  readonly updated_at: number
  readonly data: string
}

/**
 * Durable session chain store backed by SQLite. All mutating sequences run
 * inside `BEGIN IMMEDIATE` so seq allocation, index maintenance, and patch
 * application commit atomically.
 */
export class SqliteSessionChainStore implements ISessionChainStore {
  constructor(private readonly db: DatabaseSync) {}

  private parse(row: SessionChainRow | undefined): SessionRecord | null {
    if (row === undefined) return null
    return JSON.parse(row.data) as SessionRecord
  }

  private row(id: string): SessionChainRow | undefined {
    return this.db.prepare(
      'SELECT * FROM session_chain WHERE id = ?',
    ).get(id) as unknown as SessionChainRow | undefined
  }

  /** Upsert the full row; `isActive` preserves/maintains the active-index column. */
  private writeRow(record: SessionRecord, isActive: boolean): void {
    this.db.prepare(`
      INSERT INTO session_chain
        (id, cat_id, thread_id, cli_session_id, chain_key, seq, status, is_active, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cat_id = excluded.cat_id,
        thread_id = excluded.thread_id,
        cli_session_id = excluded.cli_session_id,
        chain_key = excluded.chain_key,
        seq = excluded.seq,
        status = excluded.status,
        is_active = excluded.is_active,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      record.id,
      record.catId,
      record.threadId,
      record.cliSessionId,
      record.chainKey ?? null,
      record.seq,
      record.status,
      isActive ? 1 : 0,
      record.createdAt,
      record.updatedAt,
      JSON.stringify(record),
    )
  }

  /** Demote every OTHER row of the (cat, thread) chain — activeIndex.set语义. */
  private demoteOthers(catId: string, threadId: string, keepId: string): void {
    this.db.prepare(
      'UPDATE session_chain SET is_active = 0 WHERE cat_id = ? AND thread_id = ? AND id != ?',
    ).run(catId, threadId, keepId)
  }

  create(input: CreateSessionInput): SessionRecord {
    return inImmediateTransaction(this.db, () => {
      if (input.reuseExistingCliSession) {
        const existing = this.db.prepare(
          'SELECT * FROM session_chain WHERE cli_session_id = ?',
        ).get(input.cliSessionId) as unknown as SessionChainRow | undefined
        if (existing !== undefined) {
          return JSON.parse(existing.data) as SessionRecord
        }
      }

      const now = Date.now()
      const seq = (this.db.prepare(
        'SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM session_chain WHERE cat_id = ? AND thread_id = ?',
      ).get(input.catId, input.threadId) as unknown as { n: number }).n

      const record: SessionRecord = {
        id: randomUUID(),
        cliSessionId: input.cliSessionId,
        ...(input.workingDirectory !== undefined ? { workingDirectory: input.workingDirectory } : {}),
        ...(input.workspaceFingerprint !== undefined ? { workspaceFingerprint: input.workspaceFingerprint } : {}),
        threadId: input.threadId,
        catId: input.catId,
        userId: input.userId,
        seq,
        status: 'active',
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
        ...(input.chainKey !== undefined ? { chainKey: input.chainKey } : {}),
      }

      this.writeRow(record, true)
      this.demoteOthers(record.catId, record.threadId, record.id)
      return record
    })
  }

  get(id: string): SessionRecord | null {
    return this.parse(this.row(id))
  }

  getActive(catId: CatId, threadId: string): SessionRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM session_chain WHERE cat_id = ? AND thread_id = ? AND is_active = 1 LIMIT 1',
    ).get(catId, threadId) as unknown as SessionChainRow | undefined
    const record = this.parse(row)
    if (record === null || record.status !== 'active') return null
    return record
  }

  getChain(catId: CatId, threadId: string): SessionRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM session_chain WHERE cat_id = ? AND thread_id = ? ORDER BY seq ASC',
    ).all(catId, threadId) as unknown as SessionChainRow[]
    return rows.map((row) => JSON.parse(row.data) as SessionRecord)
  }

  getChainByThread(threadId: string, options?: StoreReadOptions): SessionRecord[] {
    throwIfStoreReadAborted(options)
    const rows = this.db.prepare(
      'SELECT * FROM session_chain WHERE thread_id = ? ORDER BY cat_id ASC, seq ASC',
    ).all(threadId) as unknown as SessionChainRow[]
    return rows.map((row) => JSON.parse(row.data) as SessionRecord)
  }

  update(id: string, patch: SessionRecordPatch): SessionRecord | null {
    return inImmediateTransaction(this.db, () => {
      const existing = this.row(id)
      const record = this.parse(existing)
      if (existing === undefined || record === null) return null

      // Apply the patch exactly like the Memory version (field-by-field,
      // preserving sealReason / sealedAt null-deletion semantics on the JSON
      // round-trip object).
      const next: SessionRecord = { ...record }
      if (patch.cliSessionId !== undefined) next.cliSessionId = patch.cliSessionId
      if (patch.workingDirectory !== undefined) next.workingDirectory = patch.workingDirectory
      if (patch.workspaceFingerprint !== undefined) next.workspaceFingerprint = patch.workspaceFingerprint
      if (patch.status !== undefined) next.status = patch.status
      if (patch.contextHealth !== undefined) next.contextHealth = patch.contextHealth
      if (patch.lastUsage !== undefined) next.lastUsage = patch.lastUsage
      if (patch.messageCount !== undefined) next.messageCount = patch.messageCount
      if ('sealReason' in patch) {
        if (patch.sealReason === null) delete next.sealReason
        else if (patch.sealReason !== undefined) next.sealReason = patch.sealReason
      }
      if ('sealedAt' in patch) {
        if (patch.sealedAt === null) delete next.sealedAt
        else if (patch.sealedAt !== undefined) next.sealedAt = patch.sealedAt
      }
      if (patch.compressionCount !== undefined) next.compressionCount = patch.compressionCount
      if (patch.continuityCapsule !== undefined) next.continuityCapsule = patch.continuityCapsule
      if (patch.consecutiveRestoreFailures !== undefined) {
        next.consecutiveRestoreFailures = patch.consecutiveRestoreFailures
      }
      if (patch.latestResumeSessionId !== undefined) next.latestResumeSessionId = patch.latestResumeSessionId
      if (patch.catHandoffNote !== undefined) next.catHandoffNote = patch.catHandoffNote
      next.updatedAt = patch.updatedAt ?? Date.now()

      // activeIndex maintenance: status→active claims the slot (demoting the
      // previous owner); status→non-active releases it only for THIS row.
      let isActive = existing.is_active === 1
      if (patch.status !== undefined) {
        if (patch.status === 'active') {
          isActive = true
        } else {
          isActive = false
        }
      }

      this.writeRow(next, isActive)
      if (isActive) {
        this.demoteOthers(next.catId, next.threadId, next.id)
      }
      return next
    })
  }

  getByCliSessionId(cliSessionId: string): SessionRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM session_chain WHERE cli_session_id = ?',
    ).get(cliSessionId) as unknown as SessionChainRow | undefined
    return this.parse(row)
  }

  getByChainKey(chainKey: string): SessionRecord | null {
    // No status filter (unlike getActive): a sealed record must remain
    // reachable for F198 write tolerance; latest write wins (Map覆盖语义).
    const row = this.db.prepare(
      'SELECT * FROM session_chain WHERE chain_key = ? ORDER BY created_at DESC LIMIT 1',
    ).get(chainKey) as unknown as SessionChainRow | undefined
    return this.parse(row)
  }

  incrementCompressionCount(id: string): number | null {
    return inImmediateTransaction(this.db, () => {
      const existing = this.row(id)
      const record = this.parse(existing)
      if (existing === undefined || record === null) return null
      if (record.status !== 'active') return null
      const next: SessionRecord = {
        ...record,
        compressionCount: (record.compressionCount ?? 0) + 1,
        updatedAt: Date.now(),
      }
      this.writeRow(next, existing.is_active === 1)
      return next.compressionCount ?? null
    })
  }

  listSealingSessions(): string[] {
    const rows = this.db.prepare(
      "SELECT id FROM session_chain WHERE status = 'sealing'",
    ).all() as unknown as Array<{ id: string }>
    return rows.map((row) => row.id)
  }
}
