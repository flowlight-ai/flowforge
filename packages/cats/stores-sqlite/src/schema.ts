/**
 * Schema + open-time helpers for the SQLite cats-stores backend (dsh 范式，
 * 对齐 `@flowforge/session-persistence-sqlite/src/schema.ts`)：DDL（9 张表，
 * 每 store 一表，`data` 列存完整 record JSON，查询关键列提取为索引列）、
 * 数据库打开/PRAGMA 配置、以及 version/application_id 守护。
 *
 * 初始化在单个 `BEGIN IMMEDIATE` 事务内完成（建表 + 版本写入），随后才
 * 应用 `journal_mode` PRAGMA —— 与 session-persistence-sqlite 相同的顺序。
 *
 * @module @flowforge/cats-stores-sqlite/schema
 */

import { DatabaseSync } from 'node:sqlite'

/**
 * The on-disk schema version. Bumped only on a breaking change to the table
 * layout; a database written by any other version refuses to open.
 */
export const SCHEMA_VERSION = 1

/** SQLite application id protecting unrelated databases from cats-store writes. */
export const CATS_STORES_SQLITE_APPLICATION_ID = 0x43415453 // 'CATS'

/**
 * Journal modes the backend will run under. `wal` (the default) is the
 * durability model; rollback-journal modes exist for filesystems where WAL's
 * shared-memory files do not work (network mounts). `memory`/`off` are
 * excluded: dropping journal durability silently contradicts what this
 * backend promises.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/**
 * Open the database and apply its schema and pragmas. An empty database with a
 * zero `user_version` is initialized at {@link SCHEMA_VERSION}; a nonempty
 * unversioned database and every other non-current version reject rather than
 * being migrated in place.
 * @param path - the SQLite database file to open (created when absent;
 *   `:memory:` opens an in-process database).
 * @param journalMode - validated journal pragma.
 * @returns the open handle with pragmas applied and all tables ensured.
 */
export function openDatabase(path: string, journalMode: JournalMode): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    configureDatabase(db, path, journalMode)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync, path: string, journalMode: JournalMode): void {
  db.exec('PRAGMA foreign_keys = ON')
  let began = false
  try {
    db.exec('BEGIN IMMEDIATE')
    began = true
    // Validate while holding the write lock so no other connection can change
    // schema ownership between inspection and initialization.
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { count: userObjectCount } = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
    ).get() as { count: number }
    if (onDisk === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error(`cats database at "${path}" has an unversioned schema or application identity`)
    }
    if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
      throw new Error(`cats database at "${path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`)
    }
    if (onDisk === SCHEMA_VERSION && applicationId !== CATS_STORES_SQLITE_APPLICATION_ID) {
      throw new Error(
        `cats database at "${path}" has application id ${applicationId}, expected ${CATS_STORES_SQLITE_APPLICATION_ID}`,
      )
    }
    db.exec(DDL)
    if (onDisk === 0) {
      db.exec(`PRAGMA application_id = ${CATS_STORES_SQLITE_APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    db.exec('COMMIT')
    began = false
  } catch (error: unknown) {
    if (began) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // The original SQLite failure remains the actionable cause.
      }
    }
    throw error
  }
  // The validated union is safe to interpolate into a non-bindable PRAGMA.
  // Apply it only after ownership validation and initialization commit.
  db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
}

/**
 * The DDL for all 9 store tables. Every table keeps the FULL record as JSON in
 * `data` (source of truth for round-trip fidelity); query-relevant fields are
 * additionally extracted into typed columns so list/filter/CAS paths hit
 * indexes instead of parsing JSON.
 *
 * Column sketches vs the batch-6.5 plan, where the port contract required an
 * adjustment (documented deviations):
 * - `backlogs` uses `id` PRIMARY KEY (port identity is the generated
 *   `backlog_…` id; (thread, cat) is NOT unique — many items per thread, the
 *   lease owner is optional) with `dispatched_thread_id` / `lease_cat_id` as
 *   the list-index columns.
 * - `cat_memories` (plan sketch: `memory`) indexes `cat_id`/`kind` — the port
 *   (IMemoryStore) has no threadId dimension.
 * - `delivery_cursors` collapses the plan's scope-rows into one row per
 *   (user, cat, thread) with independent `delivery_cursor` / `seen_cursor`
 *   columns — the AC-A9 independence guarantee is the two nullable columns.
 */
const DDL = `
  CREATE TABLE IF NOT EXISTS messages (
    id               TEXT PRIMARY KEY,
    thread_id        TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    from_cat         TEXT,
    timestamp        INTEGER NOT NULL,
    seq_in_thread    INTEGER NOT NULL,
    deleted_at       INTEGER,
    delivery_status  TEXT,
    timeline_order_at INTEGER,
    idempotency_key  TEXT,
    data             TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_messages_thread_seq ON messages (thread_id, seq_in_thread);
  CREATE INDEX IF NOT EXISTS idx_messages_recent ON messages (user_id, timestamp);

  CREATE TABLE IF NOT EXISTS threads (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    archived_at  INTEGER,
    data         TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_threads_user_updated ON threads (user_id, updated_at);

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    cat_id      TEXT,
    user_id     TEXT NOT NULL,
    status      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    data        TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks (thread_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_cat ON tasks (cat_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id, updated_at);

  CREATE TABLE IF NOT EXISTS backlogs (
    id                    TEXT PRIMARY KEY,
    dispatched_thread_id  TEXT,
    lease_cat_id          TEXT,
    status                TEXT NOT NULL,
    priority              TEXT NOT NULL,
    created_at            INTEGER NOT NULL,
    data                  TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_backlogs_thread ON backlogs (dispatched_thread_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_backlogs_lease_cat ON backlogs (lease_cat_id, created_at);

  CREATE TABLE IF NOT EXISTS cat_memories (
    id          TEXT PRIMARY KEY,
    cat_id      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    data        TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_cat_memories_cat ON cat_memories (cat_id, created_at);

  CREATE TABLE IF NOT EXISTS invocation_records (
    id                       TEXT PRIMARY KEY,
    thread_id                TEXT NOT NULL,
    user_id                  TEXT NOT NULL,
    status                   TEXT NOT NULL,
    idempotency_key          TEXT,
    idempotency_expires_at   INTEGER,
    created_at               INTEGER NOT NULL,
    data                     TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_invocations_idem ON invocation_records (thread_id, user_id, idempotency_key, created_at);
  CREATE INDEX IF NOT EXISTS idx_invocations_running ON invocation_records (thread_id, user_id, status);

  CREATE TABLE IF NOT EXISTS session_chain (
    id              TEXT PRIMARY KEY,
    cat_id          TEXT NOT NULL,
    thread_id       TEXT NOT NULL,
    cli_session_id  TEXT NOT NULL UNIQUE,
    chain_key       TEXT,
    seq             INTEGER NOT NULL,
    status          TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    data            TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_session_chain_cat_thread ON session_chain (cat_id, thread_id, seq);
  CREATE INDEX IF NOT EXISTS idx_session_chain_chain_key ON session_chain (chain_key, created_at);

  CREATE TABLE IF NOT EXISTS delivery_cursors (
    user_id          TEXT NOT NULL,
    cat_id           TEXT NOT NULL,
    thread_id        TEXT NOT NULL,
    delivery_cursor  TEXT,
    seen_cursor      TEXT,
    PRIMARY KEY (user_id, cat_id, thread_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS summaries (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    data        TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_summaries_thread ON summaries (thread_id, created_at);
`

/**
 * Run `body` inside ONE `BEGIN IMMEDIATE` transaction — the SQLite replacement
 * for the Redis Lua scripts' atomicity: read-modify-write sequences (CAS,
 * seq allocation, dedup-then-insert) either commit entirely or roll back.
 * @param db - the shared database handle.
 * @param body - synchronous statements to run under the write lock.
 */
export function inImmediateTransaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = body()
    db.exec('COMMIT')
    return result
  } catch (error: unknown) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The original failure remains the actionable cause.
    }
    throw error
  }
}
