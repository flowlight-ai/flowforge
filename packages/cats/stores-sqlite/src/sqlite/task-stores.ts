/**
 * SqliteTaskProgressStore + SqliteTaskManagedWorkRegistrationStore（批次52）.
 *
 * - TaskProgressStore：每 (thread, cat) 任务进度快照；deleteSnapshotIfOwner
 *   为事务内 CAS（zombie 清理不覆盖新快照）。
 * - TaskManagedWorkRegistrationStore：taskId → ManagedWorkBinding 绑定索引；
 *   upsert 冲突事务内拒绝；(workId, attemptId) 反查。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import type {
  CatId,
  InvocationId,
  ManagedWorkBinding,
  ThreadId,
} from '@flowforge/cats-shared'
import type {
  ITaskManagedWorkRegistrationStore,
  ITaskProgressStore,
  TaskProgressSnapshot,
  UpsertManagedWorkBindingOutcome,
} from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

// ── TaskProgressStore ───────────────────────────────────────

interface TaskProgressRow {
  readonly thread_id: string
  readonly cat_id: string
  readonly status: string
  readonly last_invocation_id: string | null
  readonly data: string
}

export class SqliteTaskProgressStore implements ITaskProgressStore {
  constructor(private readonly db: DatabaseSync) {}

  async getSnapshot(threadId: ThreadId, catId: CatId): Promise<TaskProgressSnapshot | null> {
    const row = this.db.prepare(
      'SELECT * FROM task_progress WHERE thread_id = ? AND cat_id = ?',
    ).get(threadId, catId) as unknown as TaskProgressRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as TaskProgressSnapshot)
  }

  async setSnapshot(snapshot: TaskProgressSnapshot): Promise<void> {
    this.db.prepare(`
      INSERT INTO task_progress (thread_id, cat_id, status, last_invocation_id, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, cat_id) DO UPDATE SET
        status = excluded.status, last_invocation_id = excluded.last_invocation_id,
        updated_at = excluded.updated_at, data = excluded.data
    `).run(
      snapshot.threadId,
      snapshot.catId,
      snapshot.status,
      snapshot.lastInvocationId ?? null,
      snapshot.updatedAt,
      JSON.stringify(snapshot),
    )
  }

  async deleteSnapshot(threadId: ThreadId, catId: CatId): Promise<void> {
    this.db.prepare('DELETE FROM task_progress WHERE thread_id = ? AND cat_id = ?')
      .run(threadId, catId)
  }

  async deleteSnapshotIfOwner(
    threadId: ThreadId,
    catId: CatId,
    invocationId: InvocationId,
  ): Promise<boolean> {
    return inImmediateTransaction(this.db, () => {
      const row = this.db.prepare(
        'SELECT last_invocation_id FROM task_progress WHERE thread_id = ? AND cat_id = ?',
      ).get(threadId, catId) as unknown as { last_invocation_id: string | null } | undefined
      if (row === undefined || row.last_invocation_id !== invocationId) return false
      this.db.prepare('DELETE FROM task_progress WHERE thread_id = ? AND cat_id = ?')
        .run(threadId, catId)
      return true
    })
  }

  async getThreadSnapshots(threadId: ThreadId): Promise<Readonly<Record<string, TaskProgressSnapshot>>> {
    const rows = this.db.prepare(
      'SELECT * FROM task_progress WHERE thread_id = ?',
    ).all(threadId) as unknown as TaskProgressRow[]
    const result: Record<string, TaskProgressSnapshot> = {}
    for (const row of rows) {
      result[row.cat_id] = JSON.parse(row.data) as TaskProgressSnapshot
    }
    return result
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    this.db.prepare('DELETE FROM task_progress WHERE thread_id = ?').run(threadId)
  }
}

// ── TaskManagedWorkRegistrationStore ────────────────────────

interface ManagedWorkRow {
  readonly task_id: string
  readonly work_id: string
  readonly attempt_id: string
  readonly data: string
}

export class SqliteTaskManagedWorkRegistrationStore implements ITaskManagedWorkRegistrationStore {
  constructor(private readonly db: DatabaseSync) {}

  async upsert(taskId: string, binding: ManagedWorkBinding): Promise<UpsertManagedWorkBindingOutcome> {
    return inImmediateTransaction(this.db, () => {
      const existing = this.getSync(taskId)
      if (existing === null) {
        this.bindSync(taskId, binding)
        return { outcome: 'bound', taskId, binding }
      }
      // Idempotent when the binding is identical; otherwise surface the conflict.
      if (JSON.stringify(existing) === JSON.stringify(binding)) {
        return { outcome: 'bound', taskId, binding }
      }
      return {
        outcome: 'conflict',
        conflict: { kind: 'managed_work_binding_conflict', taskId, existing, incoming: binding },
      }
    })
  }

  async bind(taskId: string, binding: ManagedWorkBinding): Promise<ManagedWorkBinding> {
    return inImmediateTransaction(this.db, () => this.bindSync(taskId, binding))
  }

  async get(taskId: string): Promise<ManagedWorkBinding | null> {
    return this.getSync(taskId)
  }

  async getByWorkAttempt(workId: string, attemptId: string): Promise<string | null> {
    const row = this.db.prepare(
      'SELECT task_id FROM task_managed_work WHERE work_id = ? AND attempt_id = ?',
    ).get(workId, attemptId) as unknown as { task_id: string } | undefined
    return row === undefined ? null : row.task_id
  }

  async delete(taskId: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM task_managed_work WHERE task_id = ?')
      .run(taskId).changes > 0
  }

  private getSync(taskId: string): ManagedWorkBinding | null {
    const row = this.db.prepare('SELECT * FROM task_managed_work WHERE task_id = ?')
      .get(taskId) as unknown as ManagedWorkRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as ManagedWorkBinding)
  }

  private bindSync(taskId: string, binding: ManagedWorkBinding): ManagedWorkBinding {
    this.db.prepare(`
      INSERT INTO task_managed_work (task_id, work_id, attempt_id, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        work_id = excluded.work_id, attempt_id = excluded.attempt_id, data = excluded.data
    `).run(taskId, binding.workId, binding.attemptId, JSON.stringify(binding))
    return binding
  }
}
