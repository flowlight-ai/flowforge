import type { CatId } from './runtime-session-types.ts'
import {
  normalizeRuntimeSessionMetadata,
  type RuntimeSessionLifecycleState,
  type RuntimeSessionMetadata,
  type RuntimeSessionRuntime,
  type RuntimeSessionSurface,
} from './runtime-session-metadata.ts'

export interface RuntimeSessionRecentFilter {
  runtime?: RuntimeSessionRuntime
  catId?: CatId
  surface?: RuntimeSessionSurface
  limit?: number
  offset?: number
}

export interface IRuntimeSessionStore {
  upsert(metadata: RuntimeSessionMetadata): RuntimeSessionMetadata | Promise<RuntimeSessionMetadata>
  getBySessionId(sessionId: string): RuntimeSessionMetadata | null | Promise<RuntimeSessionMetadata | null>
  getByRuntimeSession(runtime: RuntimeSessionRuntime, runtimeSessionId: string): RuntimeSessionMetadata | null | Promise<RuntimeSessionMetadata | null>
  getActiveByThreadCat(runtime: RuntimeSessionRuntime, threadId: string, catId: CatId): RuntimeSessionMetadata | null | Promise<RuntimeSessionMetadata | null>
  listByLifecycleState(state: RuntimeSessionLifecycleState): RuntimeSessionMetadata[] | Promise<RuntimeSessionMetadata[]>
  listRecent(filter: RuntimeSessionRecentFilter): RuntimeSessionMetadata[] | Promise<RuntimeSessionMetadata[]>
  updateLifecycle(sessionId: string, patch: Partial<RuntimeSessionMetadata['lifecycle']>): RuntimeSessionMetadata | null | Promise<RuntimeSessionMetadata | null>
}

export class MemoryRuntimeSessionStore implements IRuntimeSessionStore {
  private records = new Map<string, RuntimeSessionMetadata>()
  private runtimeIndex = new Map<string, string>()
  private stateIndex = new Map<RuntimeSessionLifecycleState, Set<string>>()

  upsert(metadata: RuntimeSessionMetadata): RuntimeSessionMetadata {
    const normalized = normalizeRuntimeSessionMetadata(metadata)
    const existing = this.records.get(normalized.sessionId)
    if (existing) {
      this.runtimeIndex.delete(runtimeKey(existing.runtime, existing.runtimeSessionId))
      this.removeFromStateIndex(existing.lifecycle.state, existing.sessionId)
    }
    this.records.set(normalized.sessionId, cloneMetadata(normalized))
    this.runtimeIndex.set(runtimeKey(normalized.runtime, normalized.runtimeSessionId), normalized.sessionId)
    this.addToStateIndex(normalized.lifecycle.state, normalized.sessionId)
    return cloneMetadata(normalized)
  }

  getBySessionId(sessionId: string): RuntimeSessionMetadata | null {
    const record = this.records.get(sessionId)
    return record ? cloneMetadata(record) : null
  }

  getByRuntimeSession(runtime: RuntimeSessionRuntime, runtimeSessionId: string): RuntimeSessionMetadata | null {
    const sessionId = this.runtimeIndex.get(runtimeKey(runtime, runtimeSessionId))
    return sessionId ? this.getBySessionId(sessionId) : null
  }

  getActiveByThreadCat(runtime: RuntimeSessionRuntime, threadId: string, catId: CatId): RuntimeSessionMetadata | null {
    const active = Array.from(this.records.values())
      .filter(
        (record) =>
          record.runtime === runtime &&
          record.threadId === threadId &&
          record.catId === catId &&
          record.lifecycle.state === 'active',
      )
      .sort((a, b) => {
        const delta = b.lifecycle.lastObservedAt - a.lifecycle.lastObservedAt
        return delta !== 0 ? delta : a.sessionId.localeCompare(b.sessionId)
      })
    return active[0] ? cloneMetadata(active[0]) : null
  }

  listByLifecycleState(state: RuntimeSessionLifecycleState): RuntimeSessionMetadata[] {
    const ids = this.stateIndex.get(state)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.records.get(id))
      .filter((record): record is RuntimeSessionMetadata => record !== undefined)
      .sort((a, b) => {
        const delta = a.lifecycle.lastObservedAt - b.lifecycle.lastObservedAt
        return delta !== 0 ? delta : a.sessionId.localeCompare(b.sessionId)
      })
      .map((record) => cloneMetadata(record))
  }

  listRecent(filter: RuntimeSessionRecentFilter): RuntimeSessionMetadata[] {
    const limit = normalizeLimit(filter.limit)
    const offset = normalizeOffset(filter.offset)
    return Array.from(this.records.values())
      .filter((record) => {
        if (filter.runtime && record.runtime !== filter.runtime) return false
        if (filter.catId && record.catId !== filter.catId) return false
        if (filter.surface && record.surface !== filter.surface) return false
        return true
      })
      .sort((a, b) => {
        const delta = b.lifecycle.lastObservedAt - a.lifecycle.lastObservedAt
        return delta !== 0 ? delta : a.sessionId.localeCompare(b.sessionId)
      })
      .slice(offset, offset + limit)
      .map((record) => cloneMetadata(record))
  }

  updateLifecycle(sessionId: string, patch: Partial<RuntimeSessionMetadata['lifecycle']>): RuntimeSessionMetadata | null {
    const existing = this.records.get(sessionId)
    if (!existing) return null
    return this.upsert({ ...existing, lifecycle: { ...existing.lifecycle, ...patch } })
  }

  private addToStateIndex(state: RuntimeSessionLifecycleState, sessionId: string): void {
    const ids = this.stateIndex.get(state) ?? new Set<string>()
    ids.add(sessionId)
    this.stateIndex.set(state, ids)
  }

  private removeFromStateIndex(state: RuntimeSessionLifecycleState, sessionId: string): void {
    const ids = this.stateIndex.get(state)
    if (!ids) return
    ids.delete(sessionId)
    if (ids.size === 0) this.stateIndex.delete(state)
  }
}

// ── Redis 抽象：注入式 Key/Value 端口 + 内存实现 ──────────────────

export interface IKeyValueStore {
  set(key: string, value: string): Promise<void> | void
  get(key: string): Promise<string | null> | string | null
  delete(key: string): Promise<void> | void
  zadd(key: string, score: number, member: string): Promise<void> | void
  zrange(key: string, options?: { reverse?: boolean; start?: number; stop?: number }): Promise<string[]> | string[]
}

/** 内存 KeyValue 实现（替换 RedisRuntimeSessionStore 的 Redis 依赖）。 */
export class MemoryKeyValueStore implements IKeyValueStore {
  private kv = new Map<string, string>()
  private sorted = new Map<string, Map<string, number>>()

  set(key: string, value: string): void {
    this.kv.set(key, value)
  }
  get(key: string): string | null {
    return this.kv.get(key) ?? null
  }
  delete(key: string): void {
    this.kv.delete(key)
  }
  zadd(key: string, score: number, member: string): void {
    const set = this.sorted.get(key) ?? new Map<string, number>()
    set.set(member, score)
    this.sorted.set(key, set)
  }
  zrange(key: string, options?: { reverse?: boolean; start?: number; stop?: number }): string[] {
    const set = this.sorted.get(key)
    if (!set) return []
    let entries = Array.from(set.entries())
    entries = options?.reverse ? entries.sort((a, b) => b[1] - a[1]) : entries.sort((a, b) => a[1] - b[1])
    const start = options?.start ?? 0
    const stop = options?.stop ?? entries.length - 1
    return entries.slice(start, stop + 1).map(([member]) => member)
  }
}

const DETAIL_PREFIX = 'runtime-session:detail:'
const RUNTIME_PREFIX = 'runtime-session:runtime:'
const STATE_PREFIX = 'runtime-session:lifecycle:'
const RECENT_PREFIX = 'runtime-session:recent:'

/** 基于注入式 KV 端口的运行时会话 store（替代 Redis 实现）。 */
export class KeyValueRuntimeSessionStore implements IRuntimeSessionStore {
  constructor(private readonly kv: IKeyValueStore) {}

  async upsert(metadata: RuntimeSessionMetadata): Promise<RuntimeSessionMetadata> {
    const normalized = normalizeRuntimeSessionMetadata(metadata)
    const existing = await this.kv.get(DETAIL_PREFIX + normalized.sessionId)
    if (existing) {
      const parsed = normalizeRuntimeSessionMetadata(JSON.parse(existing))
      await this.kv.delete(RUNTIME_PREFIX + runtimeKey(parsed.runtime, parsed.runtimeSessionId))
    }
    await this.kv.set(DETAIL_PREFIX + normalized.sessionId, JSON.stringify(normalized))
    await this.kv.set(RUNTIME_PREFIX + runtimeKey(normalized.runtime, normalized.runtimeSessionId), normalized.sessionId)
    await this.kv.zadd(STATE_PREFIX + normalized.lifecycle.state, normalized.lifecycle.lastObservedAt, normalized.sessionId)
    await this.indexRecent(normalized)
    return normalized
  }

  async getBySessionId(sessionId: string): Promise<RuntimeSessionMetadata | null> {
    const payload = await this.kv.get(DETAIL_PREFIX + sessionId)
    return payload ? normalizeRuntimeSessionMetadata(JSON.parse(payload)) : null
  }

  async getByRuntimeSession(runtime: RuntimeSessionRuntime, runtimeSessionId: string): Promise<RuntimeSessionMetadata | null> {
    const sessionId = await this.kv.get(RUNTIME_PREFIX + runtimeKey(runtime, runtimeSessionId))
    return sessionId ? this.getBySessionId(sessionId) : null
  }

  async getActiveByThreadCat(runtime: RuntimeSessionRuntime, threadId: string, catId: CatId): Promise<RuntimeSessionMetadata | null> {
    const all = await this.listRecent({ runtime })
    const match = all
      .filter((r) => r.threadId === threadId && r.catId === catId && r.lifecycle.state === 'active')
      .sort((a, b) => b.lifecycle.lastObservedAt - a.lifecycle.lastObservedAt)[0]
    return match ?? null
  }

  async listByLifecycleState(state: RuntimeSessionLifecycleState): Promise<RuntimeSessionMetadata[]> {
    const ids = await this.kv.zrange(STATE_PREFIX + state)
    const records: RuntimeSessionMetadata[] = []
    for (const id of ids) {
      const r = await this.getBySessionId(id)
      if (r) records.push(r)
    }
    return records.sort((a, b) => {
      const delta = a.lifecycle.lastObservedAt - b.lifecycle.lastObservedAt
      return delta !== 0 ? delta : a.sessionId.localeCompare(b.sessionId)
    })
  }

  async listRecent(filter: RuntimeSessionRecentFilter): Promise<RuntimeSessionMetadata[]> {
    const runtime = filter.runtime ?? 'antigravity-desktop'
    const key = recentKeyFor(runtime, filter.surface, filter.catId)
    const limit = normalizeLimit(filter.limit)
    const offset = normalizeOffset(filter.offset)
    const ids = await this.kv.zrange(key, { reverse: true, start: offset, stop: offset + limit - 1 })
    const records: RuntimeSessionMetadata[] = []
    for (const id of ids) {
      const r = await this.getBySessionId(id)
      if (r && r.runtime === runtime) records.push(r)
    }
    return records
  }

  async updateLifecycle(sessionId: string, patch: Partial<RuntimeSessionMetadata['lifecycle']>): Promise<RuntimeSessionMetadata | null> {
    const existing = await this.getBySessionId(sessionId)
    if (!existing) return null
    return this.upsert({ ...existing, lifecycle: { ...existing.lifecycle, ...patch } })
  }

  private async indexRecent(metadata: RuntimeSessionMetadata): Promise<void> {
    const runtime = metadata.runtime
    if (!metadata.surface) return
    const lastObserved = metadata.lifecycle.lastObservedAt
    await this.kv.zadd(`${RECENT_PREFIX}${runtime}`, lastObserved, metadata.sessionId)
    await this.kv.zadd(`${RECENT_PREFIX}${runtime}:${metadata.surface}`, lastObserved, metadata.sessionId)
    if (metadata.catId) {
      await this.kv.zadd(`${RECENT_PREFIX}${runtime}:${metadata.surface}:${metadata.catId}`, lastObserved, metadata.sessionId)
    }
  }
}

export type AnyRuntimeSessionStore = MemoryRuntimeSessionStore | KeyValueRuntimeSessionStore

export function createRuntimeSessionStore(kv?: IKeyValueStore): AnyRuntimeSessionStore {
  return kv ? new KeyValueRuntimeSessionStore(kv) : new MemoryRuntimeSessionStore()
}

function recentKeyFor(runtime: RuntimeSessionRuntime, surface: RuntimeSessionSurface | undefined, catId: CatId | undefined): string {
  if (surface && catId) return `${RECENT_PREFIX}${runtime}:${surface}:${catId}`
  if (surface) return `${RECENT_PREFIX}${runtime}:${surface}`
  return `${RECENT_PREFIX}${runtime}`
}

function runtimeKey(runtime: RuntimeSessionRuntime, runtimeSessionId: string): string {
  return `${runtime}:${runtimeSessionId}`
}

function cloneMetadata(metadata: RuntimeSessionMetadata): RuntimeSessionMetadata {
  return structuredClone(metadata)
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50
  if (!Number.isInteger(limit) || limit < 1) return 50
  return Math.min(limit, 200)
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0
  if (!Number.isInteger(offset) || offset < 0) return 0
  return offset
}