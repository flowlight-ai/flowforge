/**
 * ProposalService — 审批/提案/投票 Cordis 服务（阶段5 批次4，ctx.chatApproval）。
 *
 * 移植自 clowder-ai `proposal-routes.ts` / `votes.ts`，SocketManager 语义抽离：
 * - 提案面：create（cat 侧，source 溯源）/ listPending / listSettled / approve /
 *   reject / withdraw / decide（统一入口）
 * - F128 状态机：pending → approving(claim) → approved(finalize)；rejected /
 *   withdrawn 一次性；approving → pending(rollback)；stale-claim 崩溃恢复
 *   （recordCreatedThread Stage 1.5 + STALE_APPROVING_MS）
 * - 投票面：voteStart / voteCast / voteClose / voteStatus（F079，含匿名表决与
 *   指定投票人自动关闭）
 * - Approval Hub：pending / settled 聚合投影
 *
 * 存储经 `ctx.catStores.proposals()/votes()` 解析（static inject=['catStores']）；
 * realtime 广播经 `ctx.get('chatRealtime', false)` 惰性解析（可选依赖，未装载
 * 时事件面广播降级为静默）。
 *
 * @module @flowforge/chat-approval/service
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, ThreadProposal, UserId, VoteResult, VotingStateV1 } from '@flowforge/cats-shared'
import type { IProposalStore, IVoteStore } from '@flowforge/cats-stores'
import {
  CANNOT_APPROVE_NON_PENDING,
  EVENT_PROPOSAL_UPDATED,
  EVENT_VOTE_CLOSED,
  EVENT_VOTE_STARTED,
  VOTE_OPTION_MAX,
  VOTE_OPTION_MIN,
  VOTE_OPTION_MAX_COUNT,
  VOTE_QUESTION_MAX,
  VOTE_TIMEOUT_DEFAULT_SEC,
  VOTE_TIMEOUT_MAX_SEC,
  VOTE_TIMEOUT_MIN_SEC,
  VOTE_VOTERS_MAX,
  VOTE_VOTERS_MIN,
} from './invariant.ts'
import { isStaleClaim, handleApproveStaleClaim, handleRejectStaleClaim } from './stale-recovery.ts'
import { buildVoteTally, checkVoteCompletion } from './votes.ts'
import type { ApprovalItem, SettledApprovalItem } from './approval-hub.ts'
import { mergePending, mergeSettled, toApprovalItem, toSettledApprovalItem } from './approval-hub.ts'

/** 业务错误码（对齐 clowder-ai route codes）。 */
export const ProposalErrorCode = {
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  PROPOSAL_NOT_FOUND: 'PROPOSAL_NOT_FOUND',
  PROPOSAL_NOT_PENDING: 'PROPOSAL_NOT_PENDING',
  VOTE_ALREADY_ACTIVE: 'VOTE_ALREADY_ACTIVE',
  VOTE_NOT_ACTIVE: 'VOTE_NOT_ACTIVE',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const

export class ChatApprovalError extends Error {
  readonly code: (typeof ProposalErrorCode)[keyof typeof ProposalErrorCode]
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof ProposalErrorCode)[keyof typeof ProposalErrorCode],
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatApprovalError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** Cat 侧提案输入（cat_cafe_propose_thread 语义）。 */
export interface ProposeThreadInput {
  readonly sourceThreadId: string
  readonly sourceInvocationId: string
  readonly sourceCatId: CatId
  readonly sourceMessageId?: string
  readonly title: string
  readonly reason: string
  readonly parentThreadId?: string
  readonly preferredCats?: readonly CatId[]
  readonly initialMessage?: string
  readonly projectPath: string
  readonly reportingMode?: ThreadProposal['reportingMode']
  readonly createdBy: UserId
  readonly clientRequestId?: string
}

/** approve 输入（F128 用户侧，approve-time 覆盖）。 */
export interface ApproveProposalInput {
  readonly userId: UserId
  readonly proposalId: string
  readonly title?: string
  readonly parentThreadId?: string
  readonly preferredCats?: readonly CatId[]
  readonly initialMessage?: string | null
  readonly projectPath?: string
  readonly reportingMode?: ThreadProposal['reportingMode']
}

export interface ApproveProposalResult {
  readonly proposalId: string
  readonly status: ThreadProposal['status']
  readonly threadId?: string
  readonly deduped?: boolean
  readonly recovered?: boolean
  readonly warnings?: readonly string[]
}

export interface RejectProposalInput {
  readonly userId: UserId
  readonly proposalId: string
  readonly rejectionReason?: string
}

/** 投票发起输入（F079 startVoteSchema 语义）。 */
export interface VoteStartInput {
  readonly threadId: string
  readonly userId: UserId
  readonly question: string
  readonly options: readonly string[]
  readonly anonymous?: boolean
  readonly timeoutSec?: number
  readonly voters?: readonly string[]
}

/** 投票输入。 */
export interface VoteCastInput {
  readonly threadId: string
  readonly userId: UserId
  readonly option: string
}

/** 审批服务（mount at ctx.chatApproval）。 */
export class ChatApprovalService extends Service {
  static inject = ['catStores'] as const

  constructor(ctx: Context) {
    super(ctx, 'chatApproval')
  }

  // ---------------------------------------------------------------------
  // 提案面
  // ---------------------------------------------------------------------

  /** cat 侧提案：创建 pending proposal 并做 dedup（clientRequestId 幂等）。 */
  async createProposal(input: ProposeThreadInput): Promise<ThreadProposal> {
    const store = this.proposals()
    if (input.clientRequestId) {
      const cached = await store.getDedupProposalId(input.createdBy, input.clientRequestId)
      if (cached) {
        const existing = await store.get(cached)
        if (existing) return existing
      }
    }
    const proposal = await store.create({
      sourceThreadId: input.sourceThreadId,
      sourceInvocationId: input.sourceInvocationId,
      sourceCatId: input.sourceCatId,
      ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
      title: input.title,
      reason: input.reason,
      parentThreadId: input.parentThreadId ?? input.sourceThreadId,
      preferredCats: [...(input.preferredCats ?? [])],
      ...(input.initialMessage ? { initialMessage: input.initialMessage } : {}),
      projectPath: input.projectPath,
      ...(input.reportingMode ? { reportingMode: input.reportingMode } : {}),
      createdBy: input.createdBy,
    })
    if (input.clientRequestId) {
      await store.reserveDedup(input.createdBy, input.clientRequestId, proposal.proposalId)
    }
    return proposal
  }

  /** 用户侧待审批列表。 */
  async listPending(userId: UserId, limit: number = 50): Promise<ThreadProposal[]> {
    return this.proposals().listPending(userId, limit)
  }

  /** 用户侧已决列表。 */
  async listSettled(userId: UserId, limit: number = 50): Promise<ThreadProposal[]> {
    return this.proposals().listSettledByUser(userId, limit)
  }

  /**
   * approve：F128 状态机主路径。
   *  - 归属校验 + 终态冲突 + dedup 幂等重放
   *  - approving 卡住 → stale-claim 恢复（finalize 已建线程 / 回滚重试）
   *  - claimForApproval（CAS pending → approving）
   *  - 建线程 → recordCreatedThread（Stage 1.5 崩溃检查点）→ finalizeApproval
   */
  async approve(input: ApproveProposalInput): Promise<ApproveProposalResult> {
    const store = this.proposals()
    const proposal = await store.get(input.proposalId)
    if (!proposal) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found', 404)
    }
    if (proposal.createdBy !== input.userId) {
      throw new ChatApprovalError(ProposalErrorCode.FORBIDDEN, 'Proposal does not belong to the current user', 403)
    }
    // 幂等重放：已 approved 且有 createdThreadId → 直接返回 deduped。
    if (proposal.status === 'approved' && proposal.createdThreadId) {
      return {
        proposalId: proposal.proposalId,
        status: proposal.status,
        threadId: proposal.createdThreadId,
        deduped: true,
      }
    }
    // stale-claim 恢复。
    if (proposal.status === 'approving') {
      const outcome = await handleApproveStaleClaim({
        proposal,
        proposalStore: store,
      })
      if (outcome.kind === 'in_flight') {
        throw new ChatApprovalError(
          ProposalErrorCode.PROPOSAL_NOT_PENDING,
          'Proposal is being approved by another request; retry shortly',
          409,
        )
      }
      if (outcome.kind === 'recovered') {
        return { proposalId: proposal.proposalId, status: 'approved', threadId: outcome.threadId, recovered: true }
      }
      if (outcome.kind === 'race_retry') {
        throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal status changed concurrently — retry approve', 409)
      }
      // cleared → 下方重新 claim。
    }
    if (proposal.status !== 'pending') {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, CANNOT_APPROVE_NON_PENDING, 409)
    }

    const claimed = await store.claimForApproval(proposal.proposalId, input.userId)
    if (!claimed) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal status changed concurrently — retry approve', 409)
    }

    const overrides = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.parentThreadId !== undefined ? { parentThreadId: input.parentThreadId } : {}),
      ...(input.preferredCats !== undefined ? { preferredCats: [...input.preferredCats] } : {}),
      ...(input.initialMessage !== undefined ? { initialMessage: input.initialMessage } : {}),
      ...(input.projectPath !== undefined ? { projectPath: input.projectPath } : {}),
      ...(input.reportingMode !== undefined ? { reportingMode: input.reportingMode } : {}),
    }

    // Stage 1: 建线程（唯一允许回滚 claim 的步骤）。
    const thread = await this.ctx.catStores.threads().create({
      userId: input.userId,
      title: overrides.title ?? proposal.title,
      ...(overrides.preferredCats && overrides.preferredCats.length > 0
        ? { assignedCatIds: [...overrides.preferredCats] }
        : {}),
      metadata: {
        projectPath: overrides.projectPath ?? proposal.projectPath,
        parentThreadId: overrides.parentThreadId ?? proposal.parentThreadId,
        ...(overrides.reportingMode !== undefined
          ? { reportingMode: overrides.reportingMode }
          : proposal.reportingMode !== undefined
            ? { reportingMode: proposal.reportingMode }
            : {}),
        createdFromProposalId: proposal.proposalId,
        sourceThreadId: proposal.sourceThreadId,
        approvedBy: input.userId,
        approvedAt: Date.now(),
      },
    })

    // Stage 1.5: 崩溃检查点 —— finalize 前持久化 createdThreadId。
    try {
      await store.recordCreatedThread(proposal.proposalId, thread.id, overrides)
    } catch {
      // best-effort；finalize 仍会原子写入 createdThreadId。
    }

    // Stage 2: finalize（此后任何副作用失败仅记 warning，不回滚 —— 防孤儿线程）。
    const finalized = await store.finalizeApproval({
      proposalId: proposal.proposalId,
      createdThreadId: thread.id,
      overrides,
    })
    if (!finalized) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal finalize failed unexpectedly after claim', 500)
    }

    // Stage 3: best-effort 副作用。
    const warnings: string[] = []
    if (overrides.preferredCats && overrides.preferredCats.length > 0) {
      try {
        await this.ctx.catStores.threads().update(thread.id, { assignedCatIds: [...overrides.preferredCats] })
      } catch (err) {
        warnings.push(`updatePreferredCats failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    this.emitProposalUpdated(input.userId, finalized)
    return {
      proposalId: finalized.proposalId,
      status: finalized.status,
      threadId: thread.id,
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  }

  /** reject：pending → rejected（approving 卡住走 stale 恢复）。 */
  async reject(input: RejectProposalInput): Promise<ThreadProposal> {
    const store = this.proposals()
    const proposal = await store.get(input.proposalId)
    if (!proposal) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found', 404)
    }
    if (proposal.createdBy !== input.userId) {
      throw new ChatApprovalError(ProposalErrorCode.FORBIDDEN, 'Proposal does not belong to the current user', 403)
    }
    if (proposal.status === 'approving') {
      const outcome = await handleRejectStaleClaim({ proposal, proposalStore: store })
      if (outcome.kind === 'in_flight') {
        throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal is being approved by another request; retry shortly', 409)
      }
      if (outcome.kind === 'cannot_reject') {
        throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal cannot be rejected — a thread was already created', 409)
      }
      // cleared → 继续。
    }
    if (proposal.status !== 'pending') {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, CANNOT_APPROVE_NON_PENDING, 409)
    }
    const rejected = await store.markRejected(proposal.proposalId, input.userId, input.rejectionReason)
    if (!rejected) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal status changed concurrently — retry reject', 409)
    }
    this.emitProposalUpdated(input.userId, rejected)
    return rejected
  }

  /** withdraw：requester-only 撤回（pending|approving → withdrawn）。 */
  async withdraw(proposalId: string, withdrawnBy: CatId): Promise<ThreadProposal> {
    const store = this.proposals()
    const proposal = await store.get(proposalId)
    if (!proposal) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_FOUND, 'Proposal not found', 404)
    }
    if (proposal.sourceCatId !== withdrawnBy) {
      throw new ChatApprovalError(ProposalErrorCode.FORBIDDEN, 'Only the requesting cat may withdraw', 403)
    }
    const withdrawn = await store.markWithdrawn(proposalId, withdrawnBy)
    if (!withdrawn) {
      throw new ChatApprovalError(ProposalErrorCode.PROPOSAL_NOT_PENDING, 'Proposal is not withdrawable', 409)
    }
    return withdrawn
  }

  // ---------------------------------------------------------------------
  // Approval Hub
  // ---------------------------------------------------------------------

  /** 聚合待办（pending/stale），按 createdAt 倒序。 */
  async hubPending(userId: UserId, limit: number = 50): Promise<ApprovalItem[]> {
    const now = Date.now()
    const pending = await this.proposals().listPending(userId, 200)
    const items = pending
      .filter((p) => p.status === 'pending' || p.status === 'approving')
      .map((p) => toApprovalItem(p, isStaleClaim(p, now)))
    return mergePending(items, limit)
  }

  /** 聚合已决，按 decidedAt 倒序。 */
  async hubSettled(userId: UserId, limit: number = 50): Promise<SettledApprovalItem[]> {
    const settled = await this.proposals().listSettledByUser(userId, 200)
    const items = settled
      .map(toSettledApprovalItem)
      .filter((x): x is SettledApprovalItem => x !== null)
    return mergeSettled(items, limit)
  }

  // ---------------------------------------------------------------------
  // 投票面（F079）
  // ---------------------------------------------------------------------

  /** 发起投票（仅线程创建者可发起；已有 active 投票 → 409）。 */
  async voteStart(input: VoteStartInput): Promise<VotingStateV1> {
    const thread = await this.ctx.catStores.threads().getById(input.threadId)
    if (!thread) {
      throw new ChatApprovalError(ProposalErrorCode.THREAD_NOT_FOUND, '对话不存在', 404)
    }
    if (thread.userId !== input.userId) {
      throw new ChatApprovalError(ProposalErrorCode.FORBIDDEN, '无权操作此对话的投票', 403)
    }
    this.validateVoteStart(input)

    const existing = await this.votes().getByThread(input.threadId)
    if (existing?.status === 'active') {
      throw new ChatApprovalError(ProposalErrorCode.VOTE_ALREADY_ACTIVE, '已有活跃投票', 409)
    }

    const state: VotingStateV1 = {
      v: 1,
      question: input.question,
      options: [...input.options],
      votes: {},
      anonymous: input.anonymous ?? false,
      deadline: Date.now() + (input.timeoutSec ?? VOTE_TIMEOUT_DEFAULT_SEC) * 1000,
      createdBy: input.userId,
      status: 'active',
      ...(input.voters && input.voters.length > 0 ? { voters: [...input.voters] } : {}),
    }
    await this.votes().saveByThread(input.threadId, state)
    this.broadcastToThread(input.threadId, EVENT_VOTE_STARTED, { threadId: input.threadId, votingState: state })
    return state
  }

  /** 投票（校验 active + 选项合法 + 指定投票人资格）。 */
  async voteCast(input: VoteCastInput): Promise<VotingStateV1> {
    const state = await this.votes().getByThread(input.threadId)
    if (!state || state.status !== 'active') {
      throw new ChatApprovalError(ProposalErrorCode.VOTE_NOT_ACTIVE, '投票未激活或已关闭', 409)
    }
    if (!state.options.includes(input.option)) {
      throw new ChatApprovalError(ProposalErrorCode.INVALID_REQUEST, '无效的投票选项', 400)
    }
    if (state.voters && state.voters.length > 0 && !state.voters.includes(input.userId)) {
      throw new ChatApprovalError(ProposalErrorCode.FORBIDDEN, '无权参与此投票', 403)
    }
    const updated: VotingStateV1 = {
      ...state,
      votes: { ...state.votes, [input.userId]: input.option },
    }
    await this.votes().saveByThread(input.threadId, updated)
    // 指定投票人全部投完 → 自动关闭。
    if (checkVoteCompletion(updated)) {
      return this.voteClose(input.threadId)
    }
    return updated
  }

  /** 关闭投票：计算 tally，匿名时抹除 votes，广播 vote_closed。 */
  async voteClose(threadId: string): Promise<VotingStateV1> {
    const state = await this.votes().getByThread(threadId)
    if (!state || state.status !== 'active') {
      throw new ChatApprovalError(ProposalErrorCode.VOTE_NOT_ACTIVE, '投票未激活或已关闭', 409)
    }
    const tally = buildVoteTally(state.options, state.votes)
    const totalVotes = Object.keys(state.votes).length
    const closed: VotingStateV1 = {
      ...state,
      status: 'closed',
      votes: state.anonymous ? {} : state.votes,
    }
    await this.votes().saveByThread(threadId, closed)
    const result: VoteResult = {
      threadId,
      question: state.question,
      status: 'closed',
      tally,
      totalVotes,
      anonymous: state.anonymous,
      deadline: state.deadline,
      createdBy: state.createdBy,
    }
    this.broadcastToThread(threadId, EVENT_VOTE_CLOSED, { threadId, result })
    return closed
  }

  /** 查询当前投票。 */
  async voteStatus(threadId: string): Promise<VotingStateV1 | null> {
    return this.votes().getByThread(threadId)
  }

  // ---------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------

  private proposals(): IProposalStore {
    return this.ctx.catStores.proposals()
  }

  private votes(): IVoteStore {
    return this.ctx.catStores.votes()
  }

  private validateVoteStart(input: VoteStartInput): void {
    if (input.question.length < 1 || input.question.length > VOTE_QUESTION_MAX) {
      throw new ChatApprovalError(ProposalErrorCode.INVALID_REQUEST, 'question 长度须在 1-500', 400)
    }
    if (input.options.length < VOTE_OPTION_MIN || input.options.length > VOTE_OPTION_MAX_COUNT) {
      throw new ChatApprovalError(ProposalErrorCode.INVALID_REQUEST, `options 须为 ${VOTE_OPTION_MIN}-${VOTE_OPTION_MAX_COUNT} 项`, 400)
    }
    if (input.options.some((o) => o.length < 1 || o.length > VOTE_OPTION_MAX)) {
      throw new ChatApprovalError(ProposalErrorCode.INVALID_REQUEST, '选项长度须在 1-100', 400)
    }
    if (input.voters && (input.voters.length < VOTE_VOTERS_MIN || input.voters.length > VOTE_VOTERS_MAX)) {
      throw new ChatApprovalError(ProposalErrorCode.INVALID_REQUEST, `voters 须为 ${VOTE_VOTERS_MIN}-${VOTE_VOTERS_MAX} 位`, 400)
    }
    const timeout = input.timeoutSec ?? VOTE_TIMEOUT_DEFAULT_SEC
    if (timeout < VOTE_TIMEOUT_MIN_SEC || timeout > VOTE_TIMEOUT_MAX_SEC) {
      throw new ChatApprovalError(ProposalErrorCode.INVALID_REQUEST, `timeoutSec 须在 ${VOTE_TIMEOUT_MIN_SEC}-${VOTE_TIMEOUT_MAX_SEC}`, 400)
    }
  }

  private emitProposalUpdated(userId: UserId, proposal: ThreadProposal): void {
    const realtime = this.ctx.get('chatRealtime', false) as
      | { emitToUser(userId: string, event: string, data: unknown): void }
      | undefined
    realtime?.emitToUser(userId, EVENT_PROPOSAL_UPDATED, proposal)
  }

  private broadcastToThread(threadId: string, event: string, data: unknown): void {
    const realtime = this.ctx.get('chatRealtime', false) as
      | { broadcastToRoom(room: string, event: string, data: unknown): void }
      | undefined
    realtime?.broadcastToRoom(`thread:${threadId}`, event, data)
  }
}
