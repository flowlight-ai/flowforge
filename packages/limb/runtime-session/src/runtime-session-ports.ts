import type { CatId } from './runtime-session-types.ts'

/**
 * Limb-Runtime-Session 边界端口（源 clowder-ai `../stores/ports/*` 与
 * `../session/SessionSealer`）。均为注入式 seam，测试用内存实现做真实契约测试。
 */

export const DEFAULT_THREAD_ID = 'system'

export type SessionRecordStatus = 'active' | 'sealed'

export interface SessionRecord {
  id: string
  cliSessionId: string
  threadId: string
  catId: CatId
  userId: string
  status: SessionRecordStatus
  sealReason?: string | null
  sealedAt?: number | null
}

export interface ISessionChainStore {
  get(sessionId: string): Promise<SessionRecord | null>
  create(input: {
    cliSessionId: string
    threadId: string
    catId: CatId
    userId: string
    reuseExistingCliSession: boolean
  }): Promise<SessionRecord>
  update(sessionId: string, patch: Partial<Omit<SessionRecord, 'id'>>): Promise<SessionRecord | null>
}

export interface ThreadRecord {
  id: string
  createdBy: string
}

export interface IThreadStore {
  get(threadId: string): Promise<ThreadRecord | null>
  ensureExternalRuntimeAnchorThread(runtime: string, userId: string): Promise<ThreadRecord>
}

export type SealReason = string

export interface SessionSealPolicies {
  accepted?: boolean
  status: 'sealing' | 'sealed' | 'requested'
}

export interface ISessionSealer {
  requestSeal(input: { sessionId: string; reason: SealReason }): Promise<SessionSealPolicies>
  finalize(input: { sessionId: string }): Promise<void>
}

// ── 内存实现（测试/宿主绑定用）───────────────────────────────────

export class MemorySessionChainStore implements ISessionChainStore {
  private records = new Map<string, SessionRecord>()
  private seq = 0

  async get(sessionId: string): Promise<SessionRecord | null> {
    return this.records.get(sessionId) ?? null
  }

  async create(input: { cliSessionId: string; threadId: string; catId: CatId; userId: string; reuseExistingCliSession: boolean }): Promise<SessionRecord> {
    const id = `sess-${++this.seq}`
    const record: SessionRecord = { id, ...input, status: 'active' }
    this.records.set(id, record)
    return record
  }

  async update(sessionId: string, patch: Partial<Omit<SessionRecord, 'id'>>): Promise<SessionRecord | null> {
    const existing = this.records.get(sessionId)
    if (!existing) return null
    const next = { ...existing, ...patch }
    this.records.set(sessionId, next)
    return next
  }
}

export class MemoryThreadStore implements IThreadStore {
  private threads = new Map<string, ThreadRecord>()

  constructor() {
    this.threads.set(DEFAULT_THREAD_ID, { id: DEFAULT_THREAD_ID, createdBy: 'system' })
  }

  async get(threadId: string): Promise<ThreadRecord | null> {
    return this.threads.get(threadId) ?? null
  }

  async ensureExternalRuntimeAnchorThread(runtime: string, userId: string): Promise<ThreadRecord> {
    const id = `anchor:${runtime}:${userId}`
    const existing = this.threads.get(id)
    if (existing) return existing
    const record: ThreadRecord = { id, createdBy: userId }
    this.threads.set(id, record)
    return record
  }
}

export class MemorySessionSealer implements ISessionSealer {
  private sealed = new Set<string>()

  async requestSeal(input: { sessionId: string; reason: SealReason }): Promise<SessionSealPolicies> {
    return this.sealed.has(input.sessionId) ? { status: 'sealed' } : { accepted: true, status: 'sealing' }
  }

  async finalize(input: { sessionId: string }): Promise<void> {
    this.sealed.add(input.sessionId)
  }
}