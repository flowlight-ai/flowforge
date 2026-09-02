/**
 * Schema + open-time helpers for the SQLite scheduler backend（dsh 范式，
 * 对齐 `@flowforge/cats-stores-sqlite/src/schema.ts`）。
 *
 * 移植自 clowder-ai `infrastructure/scheduler/*`（better-sqlite3 → node:sqlite）。
 *
 * @module @flowforge/infrastructure-scheduler/schema
 */

import { DatabaseSync } from 'node:sqlite';

/** The on-disk schema version. */
export const SCHEMA_VERSION = 1;

/** SQLite application id protecting unrelated databases from scheduler writes. */
export const SCHEDULER_SQLITE_APPLICATION_ID = 0x53434844; // 'SCHD'

const DDL = `
CREATE TABLE IF NOT EXISTS task_run_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  signal_summary TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  assigned_cat_id TEXT,
  error_summary TEXT,
  scheduled_at INTEGER,
  fired_at INTEGER,
  lateness_ms INTEGER,
  missed_slots INTEGER,
  trigger_kind TEXT,
  misfire_policy TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_ledger_task ON task_run_ledger (task_id, id);
CREATE TABLE IF NOT EXISTS dynamic_task_defs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  params_json TEXT NOT NULL,
  display_json TEXT NOT NULL,
  delivery_thread_id TEXT,
  enabled INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduler_emissions (
  emission_id TEXT PRIMARY KEY,
  origin_task_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  suppression_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emissions_task_thread ON scheduler_emissions (origin_task_id, thread_id);
CREATE TABLE IF NOT EXISTS scheduler_global_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL,
  reason TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduler_task_overrides (
  task_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pack_template_defs (
  template_id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  default_trigger_json TEXT NOT NULL,
  param_schema_json TEXT NOT NULL,
  builtin_template_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pack_template_pack ON pack_template_defs (pack_id);
`;

/**
 * Open the database and apply its schema and pragmas.
 * @param path - SQLite 文件路径；`:memory:` 打开进程内数据库。
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA journal_mode = wal; PRAGMA application_id = ${SCHEDULER_SQLITE_APPLICATION_ID};`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(DDL);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return db;
  } catch (error: unknown) {
    db.close();
    throw error;
  }
}
