/**
 * SessionHooksService — F24/F33 session hooks Cordis 服务（阶段5 批次6，ctx.chatSessionHooks）。
 *
 * 移植自 clowder-ai `routes/session-hooks.ts`（Claude Code CLI hooks 调用面）：
 * - `sealByCliSessionId`：PreCompact 触发的 strategy-aware session seal（compress/hybrid/
 *   handoff 三策略分支 + 原子 incrementCompressionCount 防 TOCTOU）
 * - `latestDigest`：SessionStart 读取最近 sealed session 的摘要（continuity 优先，
 *   sealed 摘要兜底；transcript 能力经 `ctx.catsTranscriptReader` 可选取用）
 * - `setSopBookmark` / `getSopBookmark`：F073 P4 in-process SOP stage bookmark（24h TTL）
 *
 * 会话封存生命周期委托 `ctx.catStores.sessionChains()` + 可选 `ctx.catsSessionSealer`。
 *
 * @module @flowforge/chat-session-chain/hooks-service
 */

import { Context, Service } from '@flowforge/cordis'
import type { SessionRecord } from '@flowforge/cats-shared'
import { handleHookSealStrategy } from './session-hooks.ts'
import { SOP_BOOKMARK_TTL_MS } from './invariant.ts'

/** sealHook 处理结果（对齐 clowder POST /api/sessions/seal 三态）。 */
export type HookSealResult =
  | {
      action: 'compress_allowed'
      sessionId: string
      compressionCount: number
      maxCompressions?: number
      strategy: 'compress' | 'hybrid'
    }
  | {
      action: 'sealed'
      sessionId: string
      threadId: string
      catId: string
      status: 'sealing'
    }

/** strategy-aware seal 决策的 store/sealer 依赖（供纯函数 {@link handleHookSealStrategy}）。 */
export interface HookSealDeps {
  getByCliSessionId(cliSessionId: string): SessionRecord | null
  incrementCompressionCount(id: string): number | Promise<number | null> | null
  requestSeal(sessionId: string, reason: string): Promise<{ accepted: boolean }>
}

/** digest 返回（continuity 优先，sealed digest 兜底）。 */
export interface LatestDigestResult {
  sessionId: string
  status: SessionRecord['status']
  seq: number
  catId: string
  threadId: string
  digest?: Record<string, unknown>
}

/** 服务选项。 */
export interface SessionHooksServiceOptions {
  /** 覆盖 store 访问（测试注入）。缺省走 this.chains。 */
  store?: {
    getByCliSessionId(cliSessionId: string): SessionRecord | null
    getChain(catId: string, threadId: string): SessionRecord[]
    get(id: string): SessionRecord | null
    incrementCompressionCount(id: string): number | Promise<number | null> | null
  }
  /** 覆盖 sealer 访问（测试注入）。缺省走 ctx.catsSessionSealer（未装载时 seal 拒绝）。 */
  sealer?: { requestSeal(sessionId: string, reason: string): Promise<{ accepted: boolean }> }
}

/** Session hooks 业务错误。 */
export class SessionHooksError extends Error {
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined
  constructor(status: number, message: string, detail?: Record<string, unknown>) {
    super(message)
    this.name = 'SessionHooksError'
    this.status = status
    this.detail = detail
  }
}

/**
 * Session hooks 服务（mount at ctx.chatSessionHooks）。
 */
export class SessionHooksService extends Service {
  private readonly opts: SessionHooksServiceOptions
  private readonly sopBookmarks = new Map<string, { skill: string; sopStage: string; recordedAt: number }>()

  constructor(ctx: Context, options: SessionHooksServiceOptions = {}) {
    super(ctx, 'chatSessionHooks')
    this.opts = options
  }

  private get store(): Required<NonNullable<SessionHooksServiceOptions['store']>> {
    if (this.opts.store) return this.opts.store
    const chains = this.ctx.catStores.sessionChains()
    return {
      getByCliSessionId: (id) => chains.getByCliSessionId(id) as SessionRecord | null,
      getChain: (catId, threadId) => chains.getChain(catId as never, threadId) as readonly SessionRecord[] as unknown as SessionRecord[],
      get: (id) => chains.get(id) as SessionRecord | null,
      incrementCompressionCount: (id) => chains.incrementCompressionCount(id),
    }
  }

  private sealer(): { requestSeal(a: { sessionId: string; reason: string }): Promise<{ accepted: boolean }> } {
    if (this.opts.sealer) {
      // opts.sealer 用位置参数（sessionId, reason）声明，统一适配为对象参数形式。
      return { requestSeal: async (a) => this.opts.sealer!.requestSeal(a.sessionId, a.reason) }
    }
    const s = this.ctx.get('catsSessionSealer', false) as
      | { requestSeal(a: { sessionId: string; reason: string }): Promise<{ accepted: boolean }> }
      | undefined
    if (s) return s
    return { requestSeal: async () => ({ accepted: false }) }
  }

  /**
   * POST /api/sessions/seal — Hook-triggered strategy-aware seal。
   * PreCompact 调用；compress/hybrid 允许压缩时不 seal（原子 increment 防并发 P1 race）。
   */
  async sealByCliSessionId(cliSessionId: string, reason: string): Promise<HookSealResult> {
    const record = this.store.getByCliSessionId(cliSessionId)
    if (!record) {
      throw new SessionHooksError(404, 'No session found for this CLI session ID')
    }
    if (record.status !== 'active') {
      throw new SessionHooksError(409, `Session already ${record.status}`, { sessionId: record.id, status: record.status })
    }
    return handleHookSealStrategy(
      {
        getByCliSessionId: this.store.getByCliSessionId,
        incrementCompressionCount: this.store.incrementCompressionCount,
        requestSeal: (sessionId, r) => this.sealer().requestSeal({ sessionId, reason: r }),
        getStrategy: (catId) => this.resolveStrategy(catId),
      },
      { cliSessionId, reason },
    )
  }

  /**
   * GET /api/sessions/latest-digest — 读取续接摘要。
   * active 且有压缩历史 → 返回 active continuity；否则取该 cat/thread 最近 sealed session 的 digest。
   */
  async latestDigest(cliSessionId: string): Promise<LatestDigestResult> {
    const store = this.store
    const record = store.getByCliSessionId(cliSessionId)
    if (!record) {
      throw new SessionHooksError(404, 'No session found for this CLI session ID')
    }
    const activeCompressionCount = (record.compressionCount ?? 0)
    if (record.status === 'active' && activeCompressionCount > 0) {
      return {
        sessionId: record.id,
        status: record.status,
        seq: record.seq,
        catId: record.catId,
        threadId: record.threadId,
      }
    }
    const chain = store.getChain(record.catId, record.threadId)
    const sealed = chain
      .filter((s) => s.status === 'sealed' && s.sealedAt != null)
      .sort((a, b) => (b.sealedAt ?? 0) - (a.sealedAt ?? 0))
    if (sealed.length === 0) {
      throw new SessionHooksError(404, 'No sealed sessions found')
    }
    const latest = sealed[0]!
    return {
      sessionId: latest.id,
      status: latest.status,
      seq: latest.seq,
      catId: latest.catId,
      threadId: latest.threadId,
      ...(await this.readDigestBestEffort(latest)),
    }
  }

  /** F073 P4 — 写 SOP 阶段书签（随写随做 24h TTL 清扫）。 */
  setSopBookmark(cliSessionId: string, skill: string, sopStage: string): { ok: true } {
    this.sopBookmarks.set(cliSessionId, { skill, sopStage, recordedAt: Date.now() })
    const cutoff = Date.now() - SOP_BOOKMARK_TTL_MS
    for (const [key, val] of this.sopBookmarks) {
      if (val.recordedAt < cutoff) this.sopBookmarks.delete(key)
    }
    return { ok: true }
  }

  /** F073 P4 — 读 SOP 阶段书签。 */
  getSopBookmark(cliSessionId: string): { skill: string; sopStage: string; recordedAt: number } {
    const bookmark = this.sopBookmarks.get(cliSessionId)
    if (!bookmark) {
      throw new SessionHooksError(404, 'No SOP bookmark found for this session')
    }
    return bookmark
  }

  private async readDigestBestEffort(
    latest: SessionRecord,
  ): Promise<{ digest?: Record<string, unknown> }> {
    const reader = this.ctx.get('catsTranscriptReader', false) as
      | { readDigest(sessionId: string, threadId: string, catId: string): Promise<Record<string, unknown> | null> }
      | undefined
    if (!reader) return {}
    try {
      const digest = await reader.readDigest(latest.id, latest.threadId, latest.catId)
      return digest ? { digest } : {}
    } catch {
      return {}
    }
  }

  /** 解析 cat 策略（缺省 handoff）。经 ctx.chatSessionStrategy 可选取用。 */
  private resolveStrategy(catId: string): { strategy: 'handoff' | 'compress' | 'hybrid'; hybrid?: { maxCompressions: number } } {
    const strategy = this.ctx.get('chatSessionStrategy', false) as
      | { get(catId: string): { strategy: 'handoff' | 'compress' | 'hybrid'; hybrid?: { maxCompressions: number } } }
      | undefined
    return strategy?.get(catId) ?? { strategy: 'handoff' }
  }
}