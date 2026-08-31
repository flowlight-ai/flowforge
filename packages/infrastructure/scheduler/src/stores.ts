/**
 * C33 scheduler 域 stores — node:sqlite 后端。
 *
 * TS 移植自 clowder-ai `infrastructure/scheduler/*`（better-sqlite3 → node:sqlite，
 * dsh 范式）。RunLedger / DynamicTaskStore / EmissionStore / GlobalControlStore /
 * PackTemplateStore 五 store 共用一个 DatabaseSync 句柄。
 */

import type { DatabaseSync } from 'node:sqlite';

import type {
  DynamicTaskDef,
  EmissionRecord,
  EmissionRow,
  GlobalControl,
  PackTemplateDef,
  RunLedgerRow,
  RunStats,
  TaskDisplayMeta,
  TaskOverride,
  TriggerSpec,
} from './types.ts';
import { isF255PresentLoopBuiltinRef } from './f255-template-boundary.ts';

/** node:sqlite run() 返回 changes: number | bigint — 统一为 boolean。 */
function changed(result: { changes: number | bigint }): boolean {
  return Number(result.changes) > 0;
}

// ── RunLedger ───────────────────────────────────────────────

/** 运行台账：每次 gate→execute 记一行，支持按任务/subject 查询与统计。 */
export class RunLedger {
  constructor(private db: DatabaseSync) {}

  record(row: RunLedgerRow): void {
    this.db
      .prepare(
        `INSERT INTO task_run_ledger (
           task_id, subject_key, outcome, signal_summary, duration_ms, started_at,
           assigned_cat_id, error_summary, scheduled_at, fired_at, lateness_ms,
           missed_slots, trigger_kind, misfire_policy
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.task_id,
        row.subject_key,
        row.outcome,
        row.signal_summary,
        row.duration_ms,
        row.started_at,
        row.assigned_cat_id,
        row.error_summary ?? null,
        row.scheduled_at ?? null,
        row.fired_at ?? null,
        row.lateness_ms ?? null,
        row.missed_slots ?? null,
        row.trigger_kind ?? null,
        row.misfire_policy ?? null,
      );
  }

  query(taskId: string, limit: number): RunLedgerRow[] {
    return this.db
      .prepare(
        `SELECT task_id, subject_key, outcome, signal_summary, duration_ms, started_at,
                assigned_cat_id, error_summary, scheduled_at, fired_at, lateness_ms,
                missed_slots, trigger_kind, misfire_policy
         FROM task_run_ledger WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(taskId, limit) as unknown as RunLedgerRow[];
  }

  queryBySubject(taskId: string, subjectKey: string, limit: number): RunLedgerRow[] {
    return this.db
      .prepare(
        `SELECT task_id, subject_key, outcome, signal_summary, duration_ms, started_at,
                assigned_cat_id, error_summary, scheduled_at, fired_at, lateness_ms,
                missed_slots, trigger_kind, misfire_policy
         FROM task_run_ledger WHERE task_id = ? AND subject_key = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(taskId, subjectKey, limit) as unknown as RunLedgerRow[];
  }

  stats(taskId: string): RunStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN outcome = 'RUN_DELIVERED' THEN 1 ELSE 0 END) as delivered,
           SUM(CASE WHEN outcome = 'RUN_FAILED' THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN outcome IN ('SKIP_NO_SIGNAL','SKIP_DISABLED','SKIP_OVERLAP') THEN 1 ELSE 0 END) as skipped
         FROM task_run_ledger WHERE task_id = ?`,
      )
      .get(taskId) as { total: number; delivered: number; failed: number; skipped: number } | undefined;
    return {
      total: row?.total ?? 0,
      delivered: row?.delivered ?? 0,
      failed: row?.failed ?? 0,
      skipped: row?.skipped ?? 0,
    };
  }
}

// ── DynamicTaskStore ────────────────────────────────────────

interface DynamicRawRow {
  id: string;
  template_id: string;
  trigger_json: string;
  params_json: string;
  display_json: string;
  delivery_thread_id: string | null;
  enabled: number;
  created_by: string;
  created_at: string;
}

function toDynamicDef(row: DynamicRawRow): DynamicTaskDef {
  return {
    id: row.id,
    templateId: row.template_id,
    trigger: JSON.parse(row.trigger_json) as TriggerSpec,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    display: JSON.parse(row.display_json) as TaskDisplayMeta,
    deliveryThreadId: row.delivery_thread_id,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** 动态任务定义 CRUD（Phase 3A AC-G3）。 */
export class DynamicTaskStore {
  constructor(private db: DatabaseSync) {}

  insert(def: DynamicTaskDef): void {
    this.db
      .prepare(
        `INSERT INTO dynamic_task_defs (id, template_id, trigger_json, params_json, display_json, delivery_thread_id, enabled, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        def.id,
        def.templateId,
        JSON.stringify(def.trigger),
        JSON.stringify(def.params),
        JSON.stringify(def.display),
        def.deliveryThreadId,
        def.enabled ? 1 : 0,
        def.createdBy,
        def.createdAt,
      );
  }

  /** 替换稳定 id 的可执行投影（创建溯源保留，可变执行字段原子更新）。 */
  upsert(def: DynamicTaskDef): void {
    this.db
      .prepare(
        `INSERT INTO dynamic_task_defs (id, template_id, trigger_json, params_json, display_json, delivery_thread_id, enabled, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           template_id = excluded.template_id,
           trigger_json = excluded.trigger_json,
           params_json = excluded.params_json,
           display_json = excluded.display_json,
           delivery_thread_id = excluded.delivery_thread_id,
           enabled = excluded.enabled`,
      )
      .run(
        def.id,
        def.templateId,
        JSON.stringify(def.trigger),
        JSON.stringify(def.params),
        JSON.stringify(def.display),
        def.deliveryThreadId,
        def.enabled ? 1 : 0,
        def.createdBy,
        def.createdAt,
      );
  }

  getAll(): DynamicTaskDef[] {
    const rows = this.db.prepare('SELECT * FROM dynamic_task_defs ORDER BY created_at DESC').all() as unknown as DynamicRawRow[];
    return rows.map(toDynamicDef);
  }

  getById(id: string): DynamicTaskDef | null {
    const row = this.db.prepare('SELECT * FROM dynamic_task_defs WHERE id = ?').get(id) as DynamicRawRow | undefined;
    return row ? toDynamicDef(row) : null;
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM dynamic_task_defs WHERE id = ?').run(id);
    return changed(result);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.db.prepare('UPDATE dynamic_task_defs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return changed(result);
  }

  /** F167 Phase M：持久化 re-armed trigger（defer 后的新 fireAt 跨重启持久）。 */
  updateTrigger(id: string, trigger: TriggerSpec): boolean {
    const result = this.db
      .prepare('UPDATE dynamic_task_defs SET trigger_json = ? WHERE id = ?')
      .run(JSON.stringify(trigger), id);
    return changed(result);
  }

  /** F167 Phase Q：保留 hold lifecycle tombstone。 */
  updateParams(id: string, params: Record<string, unknown>): boolean {
    const result = this.db
      .prepare('UPDATE dynamic_task_defs SET params_json = ? WHERE id = ?')
      .run(JSON.stringify(params), id);
    return changed(result);
  }

  /** Compare-and-swap lifecycle projection（不引入第二个 ledger）。 */
  updateParamsIfCurrent(id: string, current: Record<string, unknown>, next: Record<string, unknown>): boolean {
    const result = this.db
      .prepare('UPDATE dynamic_task_defs SET params_json = ? WHERE id = ? AND params_json = ?')
      .run(JSON.stringify(next), id, JSON.stringify(current));
    return changed(result);
  }
}

// ── EmissionStore ───────────────────────────────────────────

/** 自回声抑制：任务发出消息后 N ms 内对该 thread 静默。 */
export class EmissionStore {
  constructor(private db: DatabaseSync) {}

  record(emission: EmissionRecord): void {
    const now = new Date();
    const suppressionUntil = new Date(now.getTime() + emission.suppressionMs);
    const emissionId = `em-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        `INSERT INTO scheduler_emissions (emission_id, origin_task_id, thread_id, message_id, suppression_until, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(emissionId, emission.originTaskId, emission.threadId, emission.messageId, suppressionUntil.toISOString(), now.toISOString());
  }

  isSuppressed(taskId: string, threadId: string): boolean {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT 1 FROM scheduler_emissions
         WHERE origin_task_id = ? AND thread_id = ? AND suppression_until > ?
         LIMIT 1`,
      )
      .get(taskId, threadId, now);
    return row !== undefined;
  }

  cleanup(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare('DELETE FROM scheduler_emissions WHERE suppression_until <= ?').run(now);
    return Number(result.changes);
  }

  listActive(): EmissionRow[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT emission_id, origin_task_id, thread_id, message_id, suppression_until, created_at
         FROM scheduler_emissions WHERE suppression_until > ? ORDER BY created_at DESC`,
      )
      .all(now) as unknown as Array<{
      emission_id: string;
      origin_task_id: string;
      thread_id: string;
      message_id: string;
      suppression_until: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      emissionId: r.emission_id,
      originTaskId: r.origin_task_id,
      threadId: r.thread_id,
      messageId: r.message_id,
      suppressionUntil: r.suppression_until,
      createdAt: r.created_at,
    }));
  }
}

// ── GlobalControlStore ──────────────────────────────────────

/** 全局暂停/恢复 + 每任务 override。 */
export class GlobalControlStore {
  constructor(private db: DatabaseSync) {}

  /** 全局开关（无记录时默认 enabled=true）。 */
  getGlobalEnabled(): boolean {
    const row = this.db.prepare('SELECT enabled FROM scheduler_global_control WHERE id = 1').get() as
      | { enabled: number }
      | undefined;
    return row ? row.enabled === 1 : true;
  }

  getGlobalState(): GlobalControl {
    const row = this.db
      .prepare('SELECT enabled, reason, updated_by, updated_at FROM scheduler_global_control WHERE id = 1')
      .get() as { enabled: number; reason: string | null; updated_by: string; updated_at: string } | undefined;
    if (!row) return { enabled: true, reason: null, updatedBy: 'system', updatedAt: new Date().toISOString() };
    return {
      enabled: row.enabled === 1,
      reason: row.reason,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }

  setGlobalEnabled(enabled: boolean, reason: string | null, updatedBy: string): void {
    this.db
      .prepare(
        `INSERT INTO scheduler_global_control (id, enabled, reason, updated_by, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, reason = excluded.reason,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(enabled ? 1 : 0, reason, updatedBy, new Date().toISOString());
  }

  getTaskOverride(taskId: string): TaskOverride | null {
    const row = this.db
      .prepare('SELECT task_id, enabled, updated_by, updated_at FROM scheduler_task_overrides WHERE task_id = ?')
      .get(taskId) as { task_id: string; enabled: number; updated_by: string; updated_at: string } | undefined;
    if (!row) return null;
    return {
      taskId: row.task_id,
      enabled: row.enabled === 1,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }

  setTaskOverride(taskId: string, enabled: boolean, updatedBy: string): void {
    this.db
      .prepare(
        `INSERT INTO scheduler_task_overrides (task_id, enabled, updated_by, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(taskId, enabled ? 1 : 0, updatedBy, new Date().toISOString());
  }

  removeTaskOverride(taskId: string): boolean {
    const result = this.db.prepare('DELETE FROM scheduler_task_overrides WHERE task_id = ?').run(taskId);
    return changed(result);
  }

  listOverrides(): TaskOverride[] {
    const rows = this.db
      .prepare('SELECT task_id, enabled, updated_by, updated_at FROM scheduler_task_overrides ORDER BY updated_at DESC')
      .all() as unknown as Array<{ task_id: string; enabled: number; updated_by: string; updated_at: string }>;
    return rows.map((r) => ({
      taskId: r.task_id,
      enabled: r.enabled === 1,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
    }));
  }
}

// ── PackTemplateStore ───────────────────────────────────────

interface PackTemplateRawRow {
  template_id: string;
  pack_id: string;
  label: string;
  description: string;
  category: string;
  subject_kind: string;
  default_trigger_json: string;
  param_schema_json: string;
  builtin_template_ref: string;
  created_at: string;
}

function toPackTemplateDef(row: PackTemplateRawRow): PackTemplateDef {
  return {
    templateId: row.template_id,
    packId: row.pack_id,
    label: row.label,
    description: row.description,
    category: row.category as PackTemplateDef['category'],
    subjectKind: row.subject_kind as PackTemplateDef['subjectKind'],
    defaultTrigger: JSON.parse(row.default_trigger_json) as TriggerSpec,
    paramSchema: JSON.parse(row.param_schema_json) as PackTemplateDef['paramSchema'],
    builtinTemplateRef: row.builtin_template_ref,
    createdAt: row.created_at,
  };
}

/** Pack 模板定义 store（F255 pack delegate，命名空间 pack:{packId}:{name}）。 */
export class PackTemplateStore {
  constructor(private db: DatabaseSync) {}

  install(def: PackTemplateDef): void {
    if (isF255PresentLoopBuiltinRef(def.builtinTemplateRef)) {
      throw new Error('Present Loop is owned by F255 cat-life settings and cannot be installed as a pack delegate');
    }
    if (!def.templateId.startsWith('pack:')) {
      throw new Error(`Pack template ID must start with pack: — got "${def.templateId}"`);
    }
    const parts = def.templateId.split(':');
    if (parts.length < 3 || parts[1] !== def.packId) {
      throw new Error(`Namespace mismatch: templateId "${def.templateId}" does not match packId "${def.packId}"`);
    }
    const existing = this.get(def.templateId);
    if (existing) {
      throw new Error(`Pack template "${def.templateId}" already installed`);
    }
    const now = def.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO pack_template_defs
         (template_id, pack_id, label, description, category, subject_kind,
          default_trigger_json, param_schema_json, builtin_template_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        def.templateId,
        def.packId,
        def.label,
        def.description,
        def.category,
        def.subjectKind,
        JSON.stringify(def.defaultTrigger),
        JSON.stringify(def.paramSchema),
        def.builtinTemplateRef,
        now,
      );
  }

  get(templateId: string): PackTemplateDef | null {
    const row = this.db.prepare('SELECT * FROM pack_template_defs WHERE template_id = ?').get(templateId) as
      | PackTemplateRawRow
      | undefined;
    return row ? toPackTemplateDef(row) : null;
  }

  uninstall(templateId: string): boolean {
    const result = this.db.prepare('DELETE FROM pack_template_defs WHERE template_id = ?').run(templateId);
    return changed(result);
  }

  listByPack(packId: string): PackTemplateDef[] {
    const rows = this.db
      .prepare('SELECT * FROM pack_template_defs WHERE pack_id = ? ORDER BY created_at')
      .all(packId) as unknown as PackTemplateRawRow[];
    return rows.map(toPackTemplateDef);
  }

  listAll(): PackTemplateDef[] {
    const rows = this.db.prepare('SELECT * FROM pack_template_defs ORDER BY created_at').all() as unknown as PackTemplateRawRow[];
    return rows.map(toPackTemplateDef);
  }
}
