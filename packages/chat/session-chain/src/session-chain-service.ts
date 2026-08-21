/**
 * ChatSessionChainService — F24 session-chain 管理 Cordis 服务（阶段5 批次6，ctx.chatSessionChain）。
 *
 * 移植自 clowder-ai `routes/session-chain.ts`（全量移植，R13 一切皆插件）：
 * - `listSessions`：thread 内按 cat 的 session 血统列表（F24）
 * - `getSession`：单 session 记录
 * - `unsealSession`：#F062 手动解封（re-open sealed/sealing 成 fresh active）
 * - `bindCliSession`：#72 手动绑定 CLI session ID（active 更新 / 无则新建）
 *
 * HTTP 面抽离为方法调用；鉴权语义（thread 归属 / session 归属）保留在本服务内
 * （`canAccessThread` / `canAccessSessionRecord` 对齐 clowder 的 guide-state-access）。
 * 会话封存生命周期委托 `ctx.catStores.sessionChains()`（状态存储）+ 可选
 * `ctx.catsSessionSealer`（解封位移时用 Sealer.requestSeal 保证一致语义）。
 *
 * @module @flowforge/chat-session-chain/service
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, SessionRecord, UserId } from '@flowforge/cats-shared'
import type { ISessionChainStore, IThreadStore, StoredThread } from '@flowforge/cats-stores'

/** 会话链业务错误码（对齐 clowder route codes）。 */
export const SessionChainErrorCode = {
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CAT_ID: 'INVALID_CAT_ID',
  SESSION_NOT_REOPENABLE: 'SESSION_NOT_REOPENABLE',
  ACTIVE_SESSION_EXISTS: 'ACTIVE_SESSION_EXISTS',
  DISPLACE_FAILED: 'DISPLACE_FAILED',
  CONCURRENT_MODIFIED: 'CONCURRENT_MODIFIED',
} as const

export class ChatSessionChainError extends Error {
  readonly code: (typeof SessionChainErrorCode)[keyof typeof SessionChainErrorCode]
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof SessionChainErrorCode)[keyof typeof SessionChainErrorCode],
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatSessionChainError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** SessionChainService 选项（可注入 test 探测/定时器等）。 */
export interface SessionChainServiceOptions {
  /** 可访问线程校验覆盖（缺省：thread.userId === userId）。 */
  canAccessThread?: (thread: StoredThread | null, userId: string) => boolean
  /** 已结算会话归属校验覆盖（缺省：thread 归属或 session.userId === userId）。 */
  canAccessSessionRecord?: (
    thread: StoredThread | null,
    session: Pick<SessionRecord, 'userId'> | null,
    userId: string,
  ) => boolean
  /**
   * 列表可见性过滤（clowder isSharedDefaultThread 的用户级过滤语义）。缺省
   * 不过滤（返回全部）；默认 thread（share 到全用户）时传 `sessions.filter(s =>
   * s.userId === userId)`。
   */
  filterVisible?: (sessions: SessionRecord[], userId: string) => SessionRecord[]
}

/** 手动解封后的返回。 */
export interface UnsealResult {
  mode: 'already_active' | 'reopened'
  fromSessionId?: string
  session?: SessionRecord
}

/** 绑定 CLI session 的返回。 */
export interface BindCliSessionResult {
  session: SessionRecord
  mode: 'updated' | 'created'
}

/**
 * 会话链服务（mount at ctx.chatSessionChain）。
 */
export class SessionChainService extends Service {
  static inject = ['catStores'] as const

  private readonly opts: SessionChainServiceOptions

  constructor(ctx: Context, options: SessionChainServiceOptions = {}) {
    super(ctx, 'chatSessionChain')
    this.opts = options
  }

  private get chains(): ISessionChainStore {
    return this.ctx.catStores.sessionChains()
  }

  private get threads(): IThreadStore {
    return this.ctx.catStores.threads()
  }

  private accessThread(thread: StoredThread | null, userId: string): boolean {
    if (this.opts.canAccessThread) return this.opts.canAccessThread(thread, userId)
    return !!thread && (thread.userId === userId || thread.userId === 'system')
  }

  private accessSessionRecord(
    thread: StoredThread | null,
    session: Pick<SessionRecord, 'userId'> | null,
    userId: string,
  ): boolean {
    if (this.opts.canAccessSessionRecord) return this.opts.canAccessSessionRecord(thread, session, userId)
    if (!thread || !session) return false
    if (thread.userId === userId) return true
    return session.userId === userId
  }

  /** 解析 Sealer（可选依赖）：同包/宿主未装载时返回 undefined（语义降级不启用 Sealer）。 */
  private sealer(): { requestSeal(a: { sessionId: string; reason: string }): Promise<{ accepted: boolean }> } | undefined {
    return this.ctx.get('catsSessionSealer', false) as
      | { requestSeal(a: { sessionId: string; reason: string }): Promise<{ accepted: boolean }> }
      | undefined
  }

  /** GET /api/threads/:threadId/sessions — 列出会话链（可选 catId 过滤）。 */
  async listSessions(input: {
    threadId: string
    userId: UserId
    catId?: CatId
  }): Promise<SessionRecord[]> {
    const { threadId, userId, catId } = input
    const thread = await Promise.resolve(this.threads.getById(threadId))
    if (!this.accessThread(thread, userId)) {
      throw new ChatSessionChainError(SessionChainErrorCode.FORBIDDEN, '无权访问此对话的会话', 403)
    }
    if (catId) {
      const sessions = await Promise.resolve(this.chains.getChain(catId, threadId))
      return this.opts.filterVisible ? this.opts.filterVisible(sessions, userId) : sessions
    }
    const sessions = await Promise.resolve(this.chains.getChainByThread(threadId))
    return this.opts.filterVisible ? this.opts.filterVisible(sessions, userId) : sessions
  }

  /** GET /api/sessions/:sessionId — 单 session 记录。 */
  async getSession(sessionId: string, userId: UserId): Promise<SessionRecord> {
    const session = await Promise.resolve(this.chains.get(sessionId))
    if (!session) {
      throw new ChatSessionChainError(SessionChainErrorCode.SESSION_NOT_FOUND, 'Session not found', 404)
    }
    const thread = await Promise.resolve(this.threads.getById(session.threadId))
    if (!this.accessSessionRecord(thread, session, userId)) {
      throw new ChatSessionChainError(SessionChainErrorCode.FORBIDDEN, '无权访问此会话', 403)
    }
    return session
  }

  /**
   * #F062 POST /api/sessions/:sessionId/unseal — 手动解封。
   * Re-open a sealed/sealing session by creating a fresh active chain record
   * bound to the same CLI session ID.
   */
  async unsealSession(sessionId: string, userId: UserId): Promise<UnsealResult> {
    const session = await Promise.resolve(this.chains.get(sessionId))
    if (!session) {
      throw new ChatSessionChainError(SessionChainErrorCode.SESSION_NOT_FOUND, 'Session not found', 404)
    }
    const thread = await Promise.resolve(this.threads.getById(session.threadId))
    if (!this.accessSessionRecord(thread, session, userId)) {
      throw new ChatSessionChainError(SessionChainErrorCode.FORBIDDEN, '无权访问此会话', 403)
    }
    if (session.status === 'active') {
      return { mode: 'already_active' }
    }
    if (session.status !== 'sealed' && session.status !== 'sealing') {
      throw new ChatSessionChainError(
        SessionChainErrorCode.SESSION_NOT_REOPENABLE,
        `Session status ${session.status} cannot be reopened`,
        409,
      )
    }

    const active = await Promise.resolve(this.chains.getActive(session.catId, session.threadId))
    if (active && active.id !== session.id) {
      // 仅当 active session 为空（messageCount 0）时才可位移；非空 active 是真实工作，拒绝摧毁。
      if ((active.messageCount ?? 0) > 0) {
        throw new ChatSessionChainError(
          SessionChainErrorCode.ACTIVE_SESSION_EXISTS,
          'Another active session with messages already exists for this cat/thread',
          409,
          { activeSessionId: active.id },
        )
      }
      // 空置换（例如 auto-seal 创建的）— 有 Sealer 时用一致封存语义，否则直接置 sealed。
      let displaced = false
      const sealer = this.sealer()
      if (sealer) {
        try {
          const result = await sealer.requestSeal({ sessionId: active.id, reason: 'unseal_displacement' })
          if (result.accepted) {
            displaced = true
          }
        } catch {
          displaced = false
        }
      } else {
        const updated = await Promise.resolve(
          this.chains.update(active.id, {
            status: 'sealed',
            sealReason: 'unseal_displacement',
            sealedAt: Date.now(),
            updatedAt: Date.now(),
          }),
        )
        displaced = updated !== null
      }
      if (!displaced) {
        throw new ChatSessionChainError(
          SessionChainErrorCode.DISPLACE_FAILED,
          'Failed to displace active session (CAS race) — retry unseal',
          409,
          { activeSessionId: active.id },
        )
      }
    }

    const reopened = await Promise.resolve(
      this.chains.create({
        cliSessionId: session.cliSessionId,
        threadId: session.threadId,
        catId: session.catId,
        userId: session.userId,
      }),
    )
    return { mode: 'reopened', fromSessionId: session.id, session: reopened }
  }

  /**
   * #72 PATCH /api/threads/:threadId/sessions/:catId/bind — 手动绑定 CLI session ID。
   * active session 存在 → 更新 cliSessionId；否则新建 session。
   */
  async bindCliSession(input: {
    threadId: string
    catId: CatId
    cliSessionId: string
    userId: UserId
  }): Promise<BindCliSessionResult> {
    const { threadId, catId, cliSessionId, userId } = input
    const thread = await Promise.resolve(this.threads.getById(threadId))
    if (!thread) {
      throw new ChatSessionChainError(SessionChainErrorCode.THREAD_NOT_FOUND, 'Thread not found', 404)
    }
    if (!this.accessThread(thread, userId)) {
      throw new ChatSessionChainError(SessionChainErrorCode.FORBIDDEN, '无权访问此对话', 403)
    }

    const active = await Promise.resolve(this.chains.getActive(catId, threadId))
    if (active && !this.accessSessionRecord(thread, active, userId)) {
      throw new ChatSessionChainError(SessionChainErrorCode.FORBIDDEN, '无权访问此会话', 403)
    }

    if (active) {
      const updated = await Promise.resolve(
        this.chains.update(active.id, { cliSessionId, updatedAt: Date.now() }),
      )
      if (!updated) {
        throw new ChatSessionChainError(
          SessionChainErrorCode.CONCURRENT_MODIFIED,
          'Session was modified concurrently, please retry',
          409,
        )
      }
      return { session: updated, mode: 'updated' }
    }

    const session = await Promise.resolve(
      this.chains.create({ cliSessionId, threadId, catId, userId }),
    )
    return { session, mode: 'created' }
  }
}