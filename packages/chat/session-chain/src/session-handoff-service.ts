/**
 * ChatSessionHandoffService — F225 cat-initiated session handoff Cordis 服务
 * （阶段5 批次6，ctx.chatSessionHandoff）。
 *
 * 移植自 clowder-ai `routes/callback-propose-session-handoff-routes.ts` 与
 * `routes/session-handoff-approve-routes.ts`（全量移植，R13 一切皆插件）：
 * - `propose`：cat-side dock 提议（A4 gate + dedup 幂等 fast-path/reserve +
 *   确认卡发布 + publication envelope commit）
 * - `approve` / `recoverStale`：user-side 审批（ownership → status switch →
 *   commit-point 事务；crash-stale 'approving' 续跑）
 * - `reject`：user-side 驳回（F281 human-disposition feedback 原子固化）
 * - `get` / `listPending` / `listSettled`：状态查询
 *
 * 状态与持久化纯函数在 {@link ./handoff.ts}（proposeSessionHandoff /
 * approveSessionHandoff / recoverStaleHandoffProposal）；本服务只负责
 * 鉴权、dedup、卡片发布、Sealer/队列/广播等基础设施编排，保持薄层。
 *
 * @module @flowforge/chat-session-chain/handoff-service
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  ApprovalEnvelope,
  CatId,
  HumanDispositionFeedbackInput,
  SessionHandoffProposal,
  UserId,
} from '@flowforge/cats-shared'
import type { ISessionChainStore, ISessionHandoffProposalStore } from '@flowforge/cats-stores'
import {
  approveSessionHandoff,
  buildHandoffProposalCardBlock,
  proposeSessionHandoff,
  recoverStaleHandoffProposal,
  type SessionHandoffApproveDeps,
} from './handoff.ts'
import { APPROVE_STALE_MS, HANDOFF_CONTINUATION_PROMPT, HANDOFF_LIST_LIMIT } from './invariant.ts'

/** 业务错误码（对齐 clowder route codes）。 */
export const SessionHandoffErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  PROPOSAL_NOT_FOUND: 'PROPOSAL_NOT_FOUND',
  PROPOSAL_NOT_PENDING: 'PROPOSAL_NOT_PENDING',
  PROPOSAL_IN_PROGRESS: 'PROPOSAL_IN_PROGRESS',
  PROPOSAL_ALREADY_SETTLED: 'PROPOSAL_ALREADY_SETTLED',
  NOT_ANCHORED: 'NOT_ANCHORED',
  INVALID_FEEDBACK: 'INVALID_FEEDBACK',
} as const

export class ChatSessionHandoffError extends Error {
  readonly code: (typeof SessionHandoffErrorCode)[keyof typeof SessionHandoffErrorCode]
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof SessionHandoffErrorCode)[keyof typeof SessionHandoffErrorCode],
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatSessionHandoffError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** propose 输入（cat-side 五件套 + dedup key）。 */
export interface ProposeHandoffServiceInput {
  sourceCatId: CatId
  sourceThreadId: string
  /** Exact trigger message id（publication originRef 锚点）。 */
  sourceMessageId: string
  userId: string
  note: {
    done: string
    nextSteps: string
    worktreeBranch?: string
    commits?: string[]
    gotchas?: string
  }
}

/** propose 处理结果。 */
export interface ProposeHandoffServiceResult {
  proposalId: string
  status: SessionHandoffProposal['status']
  cardMessageId?: string
  deduped?: boolean
}

/** 驳回输入（可选 F281 feedback）。 */
export interface RejectHandoffServiceInput {
  proposalId: string
  userId: UserId
  feedback?: HumanDispositionFeedbackInput
}

/** 服务选项（注入适配器，便于测试）。 */
export interface SessionHandoffServiceOptions {
  /** approving 卡住多久视为 crash-stale（缺省 30s，健康事务秒级完成）。 */
  approveStaleMs?: number
  /**
   * 续接入队适配器（缺省经 `ctx.catsInvocationQueue` 懒解析）。返回 continuation
   * 队列入口 id（幂等 key = proposalId）。抛错表示入队失败。
   */
  enqueueContinuation?: (input: {
    proposalId: string
    sourceSessionId: string
    threadId: string
    catId: CatId
    userId: UserId
  }) => Promise<{ entryId: string }>
}

/** 统一入口服务。 */
export class ChatSessionHandoffService extends Service {
  static inject = ['catStores'] as const

  private readonly approveStaleMs: number
  private readonly enqueueContinuation: NonNullable<SessionHandoffServiceOptions['enqueueContinuation']>

  constructor(ctx: Context, options: SessionHandoffServiceOptions = {}) {
    super(ctx, 'chatSessionHandoff')
    this.approveStaleMs = options.approveStaleMs ?? APPROVE_STALE_MS
    this.enqueueContinuation =
      options.enqueueContinuation ?? this.defaultEnqueueContinuation.bind(this)
  }

  private get handoffs(): ISessionHandoffProposalStore {
    return this.ctx.catStores.sessionHandoffProposals()
  }

  private get chains(): ISessionChainStore {
    return this.ctx.catStores.sessionChains()
  }

  private sealer(): { requestSeal(a: { sessionId: string; reason: string }): Promise<{ accepted: boolean }> } | undefined {
    return this.ctx.get('catsSessionSealer', false) as
      | { requestSeal(a: { sessionId: string; reason: string }): Promise<{ accepted: boolean }> }
      | undefined
  }

  // ── propose ─────────────────────────────────────────────────────────

  /**
   * cat-side 提议 handoff：dedup fast-path/reserve → A4 gate create → 确认卡
   * 发布 + publication envelope commit。gate 驳回返回 `{ ok:false, reason }`。
   */
  async propose(input: ProposeHandoffServiceInput & { clientRequestId?: string }): Promise<
    | { ok: true; proposalId: string; status: 'pending'; cardMessageId: string; deduped?: boolean }
    | { ok: false; reason: 'no_active_session' | 'already_pending' | 'cooldown' | 'hourly_limit'; message: string }
  > {
    const store = this.handoffs
    const { clientRequestId, ...core } = input

    // Dedup fast-path：已知 clientRequestId 回溯到原 proposal。
    if (clientRequestId) {
      const cachedId = await store.getDedupProposalId(input.userId, clientRequestId)
      if (cachedId) {
        const deduped = await this.resolveDedup(cachedId, input.userId, clientRequestId)
        if (deduped.kind === 'hit') return deduped.body
        // in-flight / 未持久化 → 按 503 语义降级：视为 gate 'hourly_limit'（调用方重试）。
        return { ok: false, reason: 'hourly_limit', message: 'handoff 提议处理中，请稍后重试。' }
      }
      // Reserve BEFORE create（SET NX）：并发重试的 loser 不再创建第二个 proposal。
      const candidate = this.newProposalId()
      const winningId = await store.reserveDedup(input.userId, clientRequestId, candidate)
      if (winningId !== candidate) {
        const deduped = await this.resolveDedup(winningId, input.userId, clientRequestId)
        if (deduped.kind === 'hit') return deduped.body
        return { ok: false, reason: 'hourly_limit', message: 'handoff 提议处理中，请稍后重试。' }
      }
      return this.createAndPublish({ ...core, proposalId: candidate, clientRequestId })
    }
    return this.createAndPublish(core)
  }

  /** 审批 gate 理由文案（对齐 clowder GATE_REASON_MESSAGE）。 */
  static gateReason(reason: 'no_active_session' | 'already_pending' | 'cooldown' | 'hourly_limit'): string {
    return {
      no_active_session: '当前没有可封印接力的活跃 session。',
      already_pending: '已有一个待确认的 session 接力提议（每个 active session 最多 1 个）。',
      cooldown: '刚提议过 session 接力，冷却中，请稍后再发起。',
      hourly_limit: '本 thread 最近一小时的 handoff 提议已达上限，请稍后再发起。',
    }[reason]
  }

  // ── approve / recoverStale ───────────────────────────────────────────

  /**
   * user-side approve：ownership → status switch → commit-point 事务。
   * - approved → 幂等重放 deduped
   * - approving → stale 阈值判定：live in-flight → PROPOSAL_IN_PROGRESS；crash-stale → 续跑
   * - pending → 全量 commit-point
   */
  async approve(proposalId: string, userId: UserId): Promise<{
    proposalId: string
    status: SessionHandoffProposal['status']
    sealedSessionId?: string
    continuationEntryId?: string
    deduped?: boolean
    recovered?: boolean
  }> {
    const proposal = await this.resolveOwned(proposalId, userId)

    switch (proposal.status) {
      case 'rejected':
      case 'expired':
        throw new ChatSessionHandoffError(
          SessionHandoffErrorCode.PROPOSAL_ALREADY_SETTLED,
          `Proposal already ${proposal.status}`,
          409,
          { status: proposal.status },
        )
      case 'approved':
        return {
          proposalId: proposal.proposalId,
          status: proposal.status,
          ...(proposal.sealedSessionId ? { sealedSessionId: proposal.sealedSessionId } : {}),
          deduped: true,
        }
      case 'approving':
        return this.respondToApproving(proposal, userId)
      default:
        return this.approveAndRespond(proposal, userId)
    }
  }

  /** GET /api/session-handoff/:proposalId — 状态查询。 */
  async get(proposalId: string, userId: UserId): Promise<{
    proposalId: string
    status: SessionHandoffProposal['status']
    sealedSessionId?: string
  }> {
    const proposal = await this.resolveOwned(proposalId, userId)
    return {
      proposalId: proposal.proposalId,
      status: proposal.status,
      ...(proposal.sealedSessionId ? { sealedSessionId: proposal.sealedSessionId } : {}),
    }
  }

  /** user-side 待审批列表（pending）。 */
  async listPending(userId: UserId, limit = HANDOFF_LIST_LIMIT): Promise<SessionHandoffProposal[]> {
    return this.handoffs.listPendingByUser(userId, limit)
  }

  /** user-side 已决列表。 */
  async listSettled(userId: UserId, limit = HANDOFF_LIST_LIMIT): Promise<SessionHandoffProposal[]> {
    return this.handoffs.listSettledByUser(userId, limit)
  }

  /**
   * user-side reject：ownership → status guard → F281 feedback 原子 markRejected。
   * **不 seal**（reject 只驳回提案，不触碰 session 生命周期）。
   */
  async reject(input: RejectHandoffServiceInput): Promise<{
    proposalId: string
    status: SessionHandoffProposal['status']
  }> {
    const store = this.handoffs
    const proposal = await this.resolveOwned(input.proposalId, input.userId)
    if (proposal.status === 'approved') {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_ALREADY_SETTLED,
        'Proposal already approved (commit point passed)',
        409,
        { status: proposal.status },
      )
    }
    if (proposal.status === 'expired') {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_ALREADY_SETTLED,
        'Proposal already expired',
        409,
        { status: proposal.status },
      )
    }
    const transition = await store.markRejected(input.proposalId, {
      decidedAt: Date.now(),
      ...(input.feedback ? { feedback: input.feedback } : {}),
    })
    if (transition.outcome !== 'applied') {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_NOT_PENDING,
        'Proposal is not rejectable in its current state',
        409,
        { outcome: transition.outcome },
      )
    }
    const rejected = transition.proposal
    if (!rejected) {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_NOT_PENDING,
        'Proposal rejection succeeded without a resulting snapshot',
        409,
        { outcome: transition.outcome },
      )
    }
    this.emitProposalUpdated(input.userId, rejected)
    return {
      proposalId: rejected.proposalId,
      status: rejected.status,
    }
  }

  // ── internals ────────────────────────────────────────────────────────

  /** 读 + ownership 校验（404/403 语义）。 */
  private async resolveOwned(proposalId: string, userId: UserId): Promise<SessionHandoffProposal> {
    const proposal = await this.handoffs.get(proposalId)
    if (!proposal) {
      throw new ChatSessionHandoffError(SessionHandoffErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found', 404)
    }
    if (proposal.userId !== userId) {
      throw new ChatSessionHandoffError(SessionHandoffErrorCode.FORBIDDEN, 'Proposal does not belong to the current user', 403)
    }
    return proposal
  }

  /** 确认卡必须已 anchored（approve/reject gate 前校验）。 */
  private async requireAnchored(proposalId: string): Promise<void> {
    const publication = await this.handoffs.getPublication(proposalId)
    if (!publication || publication.state !== 'anchored') {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.NOT_ANCHORED,
        'Handoff proposal is not yet anchored to a visible card',
        409,
      )
    }
  }

  /** build commit-point txn deps（requestSeal/enqueueContinuation 基础设施适配器）。 */
  private buildTxnDeps(userId: UserId): SessionHandoffApproveDeps {
    const sealer = this.sealer()
    return {
      handoffProposalStore: this.handoffs,
      sessionChainStore: {
        get: (id) => this.chains.get(id),
        getActive: (catId, threadId) => this.chains.getActive(catId, threadId),
        update: (id, patch) => this.chains.update(id, patch),
      },
      requestSeal: async (sessionId, reason) => {
        if (!sealer) return { accepted: false }
        const r = await sealer.requestSeal({ sessionId, reason })
        return { accepted: r.accepted }
      },
      enqueueContinuation: async (input) => {
        return this.enqueueContinuation({
          proposalId: input.proposalId,
          sourceSessionId: input.sourceSessionId,
          threadId: input.threadId,
          catId: input.catId,
          userId,
        })
      },
    }
  }

  /** pending → 全量 commit-point 事务。 */
  private async approveAndRespond(
    proposal: SessionHandoffProposal,
    userId: UserId,
  ): Promise<{
    proposalId: string
    status: SessionHandoffProposal['status']
    sealedSessionId?: string
    continuationEntryId?: string
  }> {
    await this.requireAnchored(proposal.proposalId)
    const deps = this.buildTxnDeps(userId)
    const result = await approveSessionHandoff(deps, proposal.proposalId)
    if (!result.ok) {
      // pre-commit gate failure → 已 markExpired；广播结算状态让已挂卡片感知。
      const settled = await this.handoffs.get(proposal.proposalId)
      if (settled) this.emitProposalUpdated(userId, settled)
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_NOT_PENDING,
        `Handoff approve failed before commit point (${result.stage}:${result.reason})`,
        409,
        { stage: result.stage, reason: result.reason, ...(settled ? { status: settled.status } : {}) },
      )
    }
    // Commit point crossed → finalize session（保 cat_initiated_handoff reason 防 reaper 覆盖）。
    await this.finalizeSeal(result.proposal.sealedSessionId)
    await this.kickQueue(result.proposal.sourceThreadId, userId)
    this.emitProposalUpdated(userId, result.proposal)
    return {
      proposalId: result.proposal.proposalId,
      status: result.proposal.status,
      ...(result.proposal.sealedSessionId ? { sealedSessionId: result.proposal.sealedSessionId } : {}),
      ...(result.proposal.continuationEntryId ? { continuationEntryId: result.proposal.continuationEntryId } : {}),
    }
  }

  /** 'approving' 可能是 live in-flight 或 crash-stale。 */
  private async respondToApproving(
    proposal: SessionHandoffProposal,
    userId: UserId,
  ): Promise<{
    proposalId: string
    status: SessionHandoffProposal['status']
    sealedSessionId?: string
    continuationEntryId?: string
    recovered?: boolean
  }> {
    if (Date.now() - proposal.updatedAt < this.approveStaleMs) {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_IN_PROGRESS,
        'Approve already in progress for this proposal',
        409,
        { status: 'approving', retryable: true },
      )
    }
    // crash-stale → recover-forward，idempotent。
    await this.requireAnchored(proposal.proposalId)
    const deps = this.buildTxnDeps(userId)
    const rec = await recoverStaleHandoffProposal(deps, proposal.proposalId)
    const settled = await this.handoffs.get(proposal.proposalId)
    if (rec.outcome === 'expired') {
      throw new ChatSessionHandoffError(
        SessionHandoffErrorCode.PROPOSAL_ALREADY_SETTLED,
        'Handoff expired during recovery (commit point never reached)',
        409,
        { status: 'expired' },
      )
    }
    await this.finalizeSeal(settled?.sealedSessionId)
    await this.kickQueue(settled?.sourceThreadId, userId)
    if (settled) this.emitProposalUpdated(userId, settled)
    return {
      proposalId: proposal.proposalId,
      status: settled?.status ?? 'approved',
      ...(settled?.sealedSessionId ? { sealedSessionId: settled.sealedSessionId } : {}),
      ...(settled?.continuationEntryId ? { continuationEntryId: settled.continuationEntryId } : {}),
      recovered: true,
    }
  }

  /** create（A4 gate）→ 发布确认卡 + publication envelope commit。 */
  private async createAndPublish(args: ProposeHandoffServiceInput & { proposalId?: string; clientRequestId?: string }): Promise<
    | { ok: true; proposalId: string; status: 'pending'; cardMessageId: string; deduped?: boolean }
    | { ok: false; reason: 'no_active_session' | 'already_pending' | 'cooldown' | 'hourly_limit'; message: string }
  > {
    const store = this.handoffs
    const { clientRequestId, proposalId, ...rest } = args
    const result = await proposeSessionHandoff(
      { handoffProposalStore: store, sessionChainStore: this.chains },
      {
        sourceCatId: rest.sourceCatId,
        sourceThreadId: rest.sourceThreadId,
        sourceMessageId: rest.sourceMessageId,
        userId: rest.userId,
        note: rest.note,
        ...(proposalId ? { proposalId } : {}),
      },
    )
    if (!result.ok) {
      if (clientRequestId && proposalId) await this.releaseDedupQuietly(rest.userId, clientRequestId, proposalId)
      return { ok: false, reason: result.reason, message: ChatSessionHandoffService.gateReason(result.reason) }
    }
    try {
      const cardMessageId = await this.publishCard(result.proposal)
      // 持久化 cardMessageId checkpoint：dedup fast-path / 后续路由依赖它定位确认卡。
      store.recordCheckpoint(result.proposal.proposalId, { cardMessageId })
      store.commitEnvelope(result.proposal.proposalId, this.buildEnvelope(result.proposal, cardMessageId))
      this.emitProposalUpdated(result.proposal.userId as UserId, result.proposal)
      return { ok: true, proposalId: result.proposal.proposalId, status: result.proposal.status as 'pending', cardMessageId }
    } catch (err) {
      // 发布失败 → abort staged（tombstone）+ release dedup key（云端 P2）。
      store.abortStaged(result.proposal.proposalId, err instanceof Error ? err.message : String(err))
      if (clientRequestId && proposalId) await this.releaseDedupQuietly(rest.userId, clientRequestId, proposalId)
      throw err instanceof ChatSessionHandoffError ? err : new ChatSessionHandoffError(
        SessionHandoffErrorCode.INVALID_REQUEST,
        `Handoff card publish failed: ${err instanceof Error ? err.message : String(err)}`,
        500,
      )
    }
  }

  /** 发布确认卡到 source thread（cat 侧 gated 卡片，contentBlocks 承载 RichCardBlock）。 */
  private async publishCard(proposal: SessionHandoffProposal): Promise<string> {
    const card = buildHandoffProposalCardBlock(proposal)
    const message = await Promise.resolve(
      this.ctx.catStores.messages().append({
        userId: proposal.userId,
        catId: proposal.sourceCatId,
        content: card.bodyMarkdown ?? card.title,
        contentBlocks: [card as never],
        mentions: [],
        origin: 'callback',
        timestamp: proposal.createdAt,
        threadId: proposal.sourceThreadId,
      }),
    )
    return message.id
  }

  /** 构建 ApprovalEnvelope（F225，originRef = source message）。 */
  private buildEnvelope(proposal: SessionHandoffProposal, cardMessageId: string): ApprovalEnvelope {
    if (!proposal.sourceMessageId) {
      throw new ChatSessionHandoffError(SessionHandoffErrorCode.INVALID_REQUEST, 'F225 proposal is missing its source message', 400)
    }
    return {
      canonicalProposalId: proposal.proposalId,
      sourceFeatureId: 'F225',
      ownerUserId: proposal.userId,
      requesterCatId: proposal.sourceCatId,
      originRef: { kind: 'message', threadId: proposal.sourceThreadId, messageId: proposal.sourceMessageId },
      approvalCardRef: { threadId: proposal.sourceThreadId, messageId: cardMessageId },
      createdAt: proposal.createdAt,
    }
  }

  /** dedup fast-path 命中/自愈判定。 */
  private async resolveDedup(
    proposalId: string,
    _userId: string,
    _clientRequestId: string,
  ): Promise<{ kind: 'hit'; body: { ok: true; proposalId: string; status: 'pending'; cardMessageId: string; deduped: true } } | { kind: 'pending' }> {
    const proposal = await this.handoffs.get(proposalId)
    // 命中需已稳定 publish 出卡片（cardMessageId）；in-flight 未落卡 → 视为 pending 让调用方重试。
    if (!proposal || !proposal.cardMessageId || proposal.status !== 'pending') return { kind: 'pending' }
    return {
      kind: 'hit',
      body: {
        ok: true,
        proposalId: proposal.proposalId,
        status: 'pending',
        deduped: true,
        cardMessageId: proposal.cardMessageId,
      },
    }
  }

  /** 释放 dedup key（best-effort）。 */
  private async releaseDedupQuietly(userId: string, clientRequestId: string, proposalId: string): Promise<void> {
    try {
      await this.handoffs.releaseDedup(userId, clientRequestId, proposalId)
    } catch {
      // best-effort
    }
  }

  private emitProposalUpdated(userId: UserId, proposal: SessionHandoffProposal): void {
    const realtime = this.ctx.get('chatRealtime', false) as
      | { emitToUser(userId: string, event: string, data: unknown): void }
      | undefined
    realtime?.emitToUser(userId, 'proposal_updated', proposal)
  }

  private async finalizeSeal(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return
    const sealer = this.ctx.get('catsSessionSealer', false) as { finalize(a: { sessionId: string }): Promise<unknown> } | undefined
    if (!sealer) return
    try {
      await sealer.finalize({ sessionId })
    } catch {
      // swallow — reaper 兜底。
    }
  }

  private async kickQueue(threadId: string | undefined, userId: string): Promise<void> {
    if (!threadId) return
    const processor = this.ctx.get('catsQueueProcessor', false) as
      | { processNext(threadId: string, userId: string): Promise<unknown> }
      | undefined
    if (!processor) return
    try {
      await processor.processNext(threadId, userId)
    } catch {
      // best-effort
    }
  }

  /** 缺省 continuation 入队：经 `ctx.catsInvocationQueue`，幂等 key = proposalId（④ B5）。 */
  private async defaultEnqueueContinuation(input: {
    proposalId: string
    sourceSessionId: string
    threadId: string
    catId: CatId
    userId: UserId
  }): Promise<{ entryId: string }> {
    const queue = this.ctx.get('catsInvocationQueue', false) as
      | {
          enqueue(a: {
            threadId: string
            userId: string
            targetCatIds: readonly CatId[]
            source: string
            sourceCategory?: string
            callerCatId?: CatId
            content?: string
            idempotencyKey?: string
          }): { outcome: 'created' | 'deduped' | 'full'; entry?: { id: string } }
        }
      | undefined
    if (!queue) throw new Error('continuation enqueue unavailable: catsInvocationQueue not mounted')
    const result = queue.enqueue({
      threadId: input.threadId,
      userId: input.userId,
      targetCatIds: [input.catId],
      source: 'agent',
      sourceCategory: 'continuation',
      callerCatId: input.catId,
      content: HANDOFF_CONTINUATION_PROMPT,
      idempotencyKey: input.proposalId,
    })
    if (result.outcome !== 'created' || !result.entry) {
      throw new Error(`continuation enqueue failed: outcome=${result.outcome}`)
    }
    return { entryId: result.entry.id }
  }

  /** 生成 proposalId（dedup reserve 用，避免依赖外部 ID 生成器）。 */
  private newProposalId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    return `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}