/**
 * ISessionChainStore — session chain store port（F24 会话链：thread 内每个
 * cat 的 N 段 session 血统 + context health 追踪）。
 *
 * 移植自 clowder-ai `stores/ports/SessionChainStore.ts`（批次 6.2a — 从
 * permissive stub 提升为完整契约，接口语义 1:1 保留）：F198 chainKey 写容忍
 * 查找、F118 sealing 全局 reaper 列表、sealReason/sealedAt 的 null 删除
 * 语义均照搬源码。品牌类型 CatId / SessionRecord 由 @flowforge/cats-shared
 * 导入，本文件不重导出。
 *
 * clowder-ai 的 StoreReadOptions 在 flowforge cats-stores 内尚无对应物，
 * 此处内联最小版本（signal + throwIfStoreReadAborted 辅助）。
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId, SessionRecord } from '@flowforge/cats-shared'

/** Minimal abort-aware read options (移植自 clowder-ai StoreReadOptions)。 */
export interface StoreReadOptions {
  signal?: AbortSignal
}

/** Throw if the caller's read has been aborted (no-op without a signal). */
export function throwIfStoreReadAborted(options: StoreReadOptions | undefined): void {
  options?.signal?.throwIfAborted()
}

export interface CreateSessionInput {
  cliSessionId: string
  workingDirectory?: string
  workspaceFingerprint?: string
  threadId: string
  catId: CatId
  userId: string
  reuseExistingCliSession?: boolean
  /**
   * F198 Bug #3: stable conversation anchor for bg carrier
   * (`bg:${threadId}:${catId}`). When set, the record is indexed by chainKey
   * so session_init can reuse it across daemon sessionId rotation instead of
   * seal+create. Undefined for non-bg providers.
   */
  chainKey?: string
}

export type SessionRecordPatch = Partial<
  Pick<
    SessionRecord,
    | 'cliSessionId'
    | 'workingDirectory'
    | 'workspaceFingerprint'
    | 'status'
    | 'contextHealth'
    | 'lastUsage'
    | 'messageCount'
    | 'updatedAt'
    | 'compressionCount'
    | 'continuityCapsule'
    | 'consecutiveRestoreFailures'
    | 'latestResumeSessionId'
    | 'catHandoffNote'
  >
> & {
  sealReason?: SessionRecord['sealReason'] | null
  sealedAt?: number | null
}

export interface ISessionChainStore {
  /** Create SessionRecord (seq auto-increments, status=active) */
  create(input: CreateSessionInput): SessionRecord | Promise<SessionRecord>
  /** Get by internal ID */
  get(id: string): SessionRecord | null | Promise<SessionRecord | null>
  /** Get active session for a cat in a thread */
  getActive(catId: CatId, threadId: string): SessionRecord | null | Promise<SessionRecord | null>
  /** Get full session chain (sorted by seq) */
  getChain(catId: CatId, threadId: string): SessionRecord[] | Promise<SessionRecord[]>
  /** Get all cats' sessions for a thread */
  getChainByThread(threadId: string, options?: StoreReadOptions): SessionRecord[] | Promise<SessionRecord[]>
  /** Update partial fields */
  update(id: string, patch: SessionRecordPatch): SessionRecord | null | Promise<SessionRecord | null>
  /** Look up by CLI session ID */
  getByCliSessionId(cliSessionId: string): SessionRecord | null | Promise<SessionRecord | null>
  /**
   * F198 Bug #3: Look up by chainKey (stable bg conversation anchor). Returns
   * the record regardless of status (unlike getActive) so a sealed record is
   * still reachable for write-tolerance during concurrent edges.
   */
  getByChainKey(chainKey: string): SessionRecord | null | Promise<SessionRecord | null>
  /** Atomically increment compressionCount and return the new value. Returns null if session not found. */
  incrementCompressionCount(id: string): number | null | Promise<number | null>
  /** F118: List IDs of all sessions currently in 'sealing' status (for global reaper). */
  listSealingSessions(): string[] | Promise<string[]>
}
