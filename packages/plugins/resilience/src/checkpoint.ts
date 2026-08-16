/**
 * CheckpointManager — task state checkpointing.
 *
 * Compact core mapped from flowforge Python legacy core/checkpoint_manager.py
 * (F25). The legacy manager is sqlite-backed; here persistence sits behind
 * an injected CheckpointStore (in-memory implementation bundled) so hosts
 * can bind sqlite/redis/file backends. Semantics preserved: per-(task,step)
 * versioning for save(), global versioning for saveFull()/saveIncremental(),
 * incremental state/messages merging, retention via deleteOldVersions().
 */

import { randomUUID } from 'node:crypto'

export interface CheckpointRecord {
  id: string
  taskId: string
  stepName: string
  state: Record<string, unknown>
  messages: unknown[]
  version: number
  label: string
  createdAt: number
}

export interface CheckpointStore {
  insert(record: CheckpointRecord): Promise<void>
  /** Latest record for a task, optionally narrowed to a step. */
  latest(taskId: string, stepName?: string): Promise<CheckpointRecord | null>
  list(taskId: string): Promise<CheckpointRecord[]>
  byId(id: string): Promise<CheckpointRecord | null>
  deleteTask(taskId: string): Promise<void>
  deleteIds(ids: string[]): Promise<number>
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private records: CheckpointRecord[] = []

  async insert(record: CheckpointRecord): Promise<void> {
    this.records.push({ ...record })
  }

  async latest(taskId: string, stepName?: string): Promise<CheckpointRecord | null> {
    const matches = this.records.filter(
      record => record.taskId === taskId && (stepName === undefined || record.stepName === stepName),
    )
    if (matches.length === 0) return null
    return [...matches].sort((a, b) => b.createdAt - a.createdAt || b.version - a.version)[0] ?? null
  }

  async list(taskId: string): Promise<CheckpointRecord[]> {
    return this.records
      .filter(record => record.taskId === taskId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async byId(id: string): Promise<CheckpointRecord | null> {
    return this.records.find(record => record.id === id) ?? null
  }

  async deleteTask(taskId: string): Promise<void> {
    this.records = this.records.filter(record => record.taskId !== taskId)
  }

  async deleteIds(ids: string[]): Promise<number> {
    const idSet = new Set(ids)
    const kept = this.records.filter(record => !idSet.has(record.id))
    const deleted = this.records.length - kept.length
    this.records = kept
    return deleted
  }
}

export interface CheckpointManagerOptions {
  idFactory?: () => string
  /** Injectable clock (epoch seconds). */
  now?: () => number
}

export class CheckpointManager {
  private readonly store: CheckpointStore
  private readonly idFactory: () => string
  private readonly now: () => number

  constructor(store: CheckpointStore = new InMemoryCheckpointStore(), options: CheckpointManagerOptions = {}) {
    this.store = store
    this.idFactory = options.idFactory ?? randomUUID
    this.now = options.now ?? (() => Date.now() / 1000)
  }

  /** Save per-step state; version increments per (task, step). */
  async save(taskId: string, stepName: string, state: Record<string, unknown>): Promise<void> {
    const existing = await this.store.latest(taskId, stepName)
    const version = existing ? existing.version + 1 : 1
    await this.store.insert({
      id: this.idFactory(),
      taskId,
      stepName,
      state,
      messages: [],
      version,
      label: '',
      createdAt: this.now(),
    })
  }

  /** Save a full checkpoint (state + messages); returns the new id. */
  async saveFull(
    taskId: string,
    state: Record<string, unknown>,
    messages: unknown[],
    label = '',
  ): Promise<string> {
    const records = await this.store.list(taskId)
    const maxVersion = records.reduce((max, record) => Math.max(max, record.version), 0)
    const id = this.idFactory()
    await this.store.insert({
      id,
      taskId,
      stepName: '',
      state,
      messages,
      version: maxVersion + 1,
      label,
      createdAt: this.now(),
    })
    return id
  }

  /** Merge state/messages over the latest checkpoint; returns the new id. */
  async saveIncremental(
    taskId: string,
    state: Record<string, unknown>,
    messages: unknown[],
    label = '',
  ): Promise<string> {
    const latest = await this.getLatest(taskId)
    const mergedState = latest ? { ...latest.state, ...state } : { ...state }
    const mergedMessages = latest ? [...latest.messages, ...messages] : [...messages]
    return this.saveFull(taskId, mergedState, mergedMessages, label)
  }

  /** Restore state+messages by checkpoint id, or the latest checkpoint. */
  async restore(
    taskId: string,
    checkpointId?: string,
  ): Promise<{ state: Record<string, unknown>; messages: unknown[] } | null> {
    const record = checkpointId
      ? await this.store.byId(checkpointId)
      : await this.store.latest(taskId)
    if (!record) return null
    return { state: record.state, messages: record.messages }
  }

  /** Latest per-step state, or null. */
  async load(taskId: string, stepName: string): Promise<Record<string, unknown> | null> {
    const record = await this.store.latest(taskId, stepName)
    return record ? record.state : null
  }

  /** Latest state across the task, or null. */
  async loadLatest(taskId: string): Promise<Record<string, unknown> | null> {
    const record = await this.store.latest(taskId)
    return record ? record.state : null
  }

  async getLatest(taskId: string): Promise<CheckpointRecord | null> {
    return this.store.latest(taskId)
  }

  async delete(taskId: string): Promise<void> {
    await this.store.deleteTask(taskId)
  }

  /** Keep only the newest `keepLatest` checkpoints; returns deleted count. */
  async deleteOldVersions(taskId: string, keepLatest = 5): Promise<number> {
    const records = await this.store.list(taskId)
    const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt || b.version - a.version)
    const toDelete = sorted.slice(keepLatest)
    if (toDelete.length === 0) return 0
    return this.store.deleteIds(toDelete.map(record => record.id))
  }

  async listCheckpoints(taskId: string): Promise<CheckpointRecord[]> {
    return this.store.list(taskId)
  }
}
