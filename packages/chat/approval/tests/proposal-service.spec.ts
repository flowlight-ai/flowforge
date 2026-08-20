/**
 * ProposalService — 审批/提案/投票域服务契约验证（阶段5 批次4，T5.6.2/T5.6.4）。
 *
 * 覆盖：
 * - 提案面：createProposal（pending + clientRequestId 幂等 dedup）/ listPending /
 *   listSettled / approve（F128 状态机：归属校验、终态冲突、dedup 重放、stale-claim
 *   崩溃恢复、建线程 + Stage 1.5 checkpoint + finalize）/ reject / withdraw
 * - 投票面：voteStart（线程主权限 + 校验 + 唯一 active）/ voteCast（资格/选项/
 *   指定投票人自动关闭）/ voteClose（tally + 匿名抹除）/ voteStatus
 * - Approval Hub：hubPending（stale 标记 + createdAt 倒序）/ hubSettled
 * - 错误面：ChatApprovalError code/status 语义
 *
 * @module @flowforge/chat-approval/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createThreadId, createUserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import {
  ChatApprovalError,
  ChatApprovalService,
  ProposalErrorCode,
  STALE_APPROVING_MS,
} from '../src/index.ts'

const ALICE = createUserId('alice')
const BOB = createUserId('bob')
const CAT_A = createCatId('cat_a')
const T1 = createThreadId('t1')

interface Harness {
  ctx: Context
  approval: ChatApprovalService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const approval = new ChatApprovalService(ctx)
  return { ctx, approval, backend }
}

function proposeInput(overrides: Partial<Parameters<ChatApprovalService['createProposal']>[0]> = {}): Parameters<
  ChatApprovalService['createProposal']
>[0] {
  return {
    sourceThreadId: T1,
    sourceInvocationId: 'inv_1',
    sourceCatId: CAT_A,
    title: '新提案',
    reason: '需要开子线程',
    projectPath: '/w/proj',
    createdBy: ALICE,
    ...overrides,
  }
}

/** Seed a thread owned by `userId` in the memory backend and return its id. */
function seedThread(backend: MemoryStoresBackend, userId: string): string {
  return backend.threadStore.create({ userId, title: '对话' }).id
}

// ---------------------------------------------------------------------------
// 提案面
// ---------------------------------------------------------------------------

describe('ChatApprovalService — createProposal', () => {
  it('creates a pending proposal and persists it to the proposal store', async () => {
    const h = harness()
    const proposal = await h.approval.createProposal(proposeInput())
    expect(proposal.status).toBe('pending')
    expect(proposal.sourceCatId).toBe(CAT_A)
    expect(proposal.parentThreadId).toBe(T1)
    expect(proposal.createdBy).toBe(ALICE)
    expect(proposal.preferredCats).toEqual([])

    const fetched = h.backend.proposalStore.get(proposal.proposalId)
    expect(fetched?.status).toBe('pending')
  })

  it('is idempotent under clientRequestId (dedup fast path)', async () => {
    const h = harness()
    const first = await h.approval.createProposal(proposeInput({ clientRequestId: 'req-1' }))
    const second = await h.approval.createProposal(proposeInput({ clientRequestId: 'req-1' }))
    expect(second.proposalId).toBe(first.proposalId)
    expect(h.backend.proposalStore.getDedupProposalId(ALICE, 'req-1')).toBe(first.proposalId)
  })

  it('keeps dedup scoped per user + request id (different users stay distinct)', async () => {
    const h = harness()
    const a = await h.approval.createProposal(proposeInput({ clientRequestId: 'req-1' }))
    // 同 user + 同 clientRequestId → 幂等返回同一提案（clientRequestId 是幂等键）
    const replay = await h.approval.createProposal(
      proposeInput({ clientRequestId: 'req-1', sourceCatId: createCatId('cat_b') }),
    )
    expect(replay.proposalId).toBe(a.proposalId)
    // 不同 user + 同 clientRequestId → 各自独立提案
    const b = await h.approval.createProposal(proposeInput({ clientRequestId: 'req-1', createdBy: BOB }))
    expect(b.proposalId).not.toBe(a.proposalId)
  })
})

describe('ChatApprovalService — listPending / listSettled', () => {
  it('lists only the user’s pending proposals', async () => {
    const h = harness()
    await h.approval.createProposal(proposeInput())
    await h.approval.createProposal(proposeInput({ title: 'bob 的', createdBy: BOB }))
    const pending = await h.approval.listPending(ALICE)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.title).toBe('新提案')
  })

  it('moves proposals out of pending into settled after a decision', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    await h.approval.approve({ userId: ALICE, proposalId })
    expect(await h.approval.listPending(ALICE)).toHaveLength(0)
    const settled = await h.approval.listSettled(ALICE)
    expect(settled).toHaveLength(1)
    expect(settled[0]!.status).toBe('approved')
  })
})

describe('ChatApprovalService — approve', () => {
  it('creates a thread and finalizes the proposal (F128 happy path)', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    const result = await h.approval.approve({ userId: ALICE, proposalId })

    expect(result.status).toBe('approved')
    expect(result.threadId).toBeTruthy()

    const proposal = h.backend.proposalStore.get(proposalId)
    expect(proposal?.status).toBe('approved')
    expect(proposal?.createdThreadId).toBe(result.threadId)
    expect(proposal?.approvedBy).toBe(ALICE)

    const thread = h.backend.threadStore.getById(result.threadId!)
    expect(thread?.userId).toBe(ALICE)
    expect(thread?.title).toBe('新提案')
    expect(thread?.metadata).toMatchObject({
      projectPath: '/w/proj',
      createdFromProposalId: proposalId,
      approvedBy: ALICE,
    })
  })

  it('applies approve-time overrides (title/parent/preferredCats/initialMessage)', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    const result = await h.approval.approve({
      userId: ALICE,
      proposalId,
      title: '改后的标题',
      preferredCats: [CAT_A],
      initialMessage: '开场白',
    })
    const thread = h.backend.threadStore.getById(result.threadId!)
    expect(thread?.title).toBe('改后的标题')
    expect(thread?.assignedCatIds).toEqual([CAT_A])
    const proposal = h.backend.proposalStore.get(proposalId)
    expect(proposal?.title).toBe('改后的标题')
    expect(proposal?.initialMessage).toBe('开场白')
  })

  it('replays an already-approved proposal as deduped without creating a second thread', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    const first = await h.approval.approve({ userId: ALICE, proposalId })
    const second = await h.approval.approve({ userId: ALICE, proposalId })
    expect(second.deduped).toBe(true)
    expect(second.threadId).toBe(first.threadId)
    const threads = h.backend.threadStore.listForUser(ALICE)
    expect(threads).toHaveLength(1)
  })

  it('rejects approval for a proposal owned by another user', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    await expect(h.approval.approve({ userId: BOB, proposalId })).rejects.toMatchObject({
      code: ProposalErrorCode.FORBIDDEN,
      status: 403,
    })
  })

  it('rejects approval of a missing proposal', async () => {
    const h = harness()
    await expect(h.approval.approve({ userId: ALICE, proposalId: 'nope' })).rejects.toMatchObject({
      code: ProposalErrorCode.PROPOSAL_NOT_FOUND,
      status: 404,
    })
  })

  it('rejects approval of a terminal (rejected) proposal', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    await h.approval.reject({ userId: ALICE, proposalId })
    await expect(h.approval.approve({ userId: ALICE, proposalId })).rejects.toMatchObject({
      code: ProposalErrorCode.PROPOSAL_NOT_PENDING,
      status: 409,
    })
  })

  it('recovers a stale claim with a persisted thread (Stage 1.5 checkpoint)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(100_000))
      const h = harness()
      const { proposalId } = await h.approval.createProposal(proposeInput())
      // 模拟上一 claimer 崩溃：claim → recordCreatedThread 后进程退出
      const store = h.backend.proposalStore
      store.claimForApproval(proposalId, ALICE)
      store.recordCreatedThread(proposalId, 'thread_recovered')

      vi.setSystemTime(new Date(100_000 + STALE_APPROVING_MS + 1))
      const result = await h.approval.approve({ userId: ALICE, proposalId })
      expect(result).toMatchObject({ status: 'approved', threadId: 'thread_recovered', recovered: true })
      // 不重复建线程
      expect(h.backend.threadStore.listForUser(ALICE)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a non-stale in-flight claim (409 retry)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(100_000))
      const h = harness()
      const { proposalId } = await h.approval.createProposal(proposeInput())
      h.backend.proposalStore.claimForApproval(proposalId, ALICE)
      await expect(h.approval.approve({ userId: ALICE, proposalId })).rejects.toMatchObject({
        code: ProposalErrorCode.PROPOSAL_NOT_PENDING,
        status: 409,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatApprovalService — reject / withdraw', () => {
  it('rejects a pending proposal (one-shot decision)', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    const rejected = await h.approval.reject({ userId: ALICE, proposalId, rejectionReason: '不需要' })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectionReason).toBe('不需要')
    expect(h.backend.proposalStore.get(proposalId)?.status).toBe('rejected')
  })

  it('cannot reject a proposal whose thread was created (stale claim)', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(100_000))
      const h = harness()
      const { proposalId } = await h.approval.createProposal(proposeInput())
      const store = h.backend.proposalStore
      store.claimForApproval(proposalId, ALICE)
      store.recordCreatedThread(proposalId, 'thread_recovered')
      vi.setSystemTime(new Date(100_000 + STALE_APPROVING_MS + 1))
      await expect(h.approval.reject({ userId: ALICE, proposalId })).rejects.toMatchObject({
        code: ProposalErrorCode.PROPOSAL_NOT_PENDING,
        status: 409,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('withdraws a pending proposal by the requesting cat', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    const withdrawn = await h.approval.withdraw(proposalId, CAT_A)
    expect(withdrawn.status).toBe('withdrawn')
  })

  it('forbids withdrawal by a non-requesting cat', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    await expect(h.approval.withdraw(proposalId, createCatId('cat_evil'))).rejects.toMatchObject({
      code: ProposalErrorCode.FORBIDDEN,
      status: 403,
    })
  })
})

// ---------------------------------------------------------------------------
// 投票面（F079）
// ---------------------------------------------------------------------------

describe('ChatApprovalService — voteStart', () => {
  it('starts an active vote on a thread the user owns', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const state = await h.approval.voteStart({
      threadId,
      userId: ALICE,
      question: '去哪吃',
      options: ['A', 'B'],
      timeoutSec: 60,
    })
    expect(state.status).toBe('active')
    expect(state.options).toEqual(['A', 'B'])
    expect(state.deadline).toBeGreaterThan(Date.now())
    expect(state.createdBy).toBe(ALICE)
  })

  it('rejects vote start on a thread owned by another user', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, BOB)
    await expect(
      h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'] }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.FORBIDDEN, status: 403 })
  })

  it('rejects vote start on a missing thread', async () => {
    const h = harness()
    await expect(
      h.approval.voteStart({ threadId: 'nope', userId: ALICE, question: 'q', options: ['A', 'B'] }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.THREAD_NOT_FOUND, status: 404 })
  })

  it('rejects a second active vote on the same thread', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'] })
    await expect(
      h.approval.voteStart({ threadId, userId: ALICE, question: 'q2', options: ['A', 'B'] }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.VOTE_ALREADY_ACTIVE, status: 409 })
  })

  it('validates question length / option count / timeout bounds', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await expect(
      h.approval.voteStart({ threadId, userId: ALICE, question: '', options: ['A', 'B'] }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.INVALID_REQUEST, status: 400 })
    await expect(
      h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['only'] }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.INVALID_REQUEST, status: 400 })
    await expect(
      h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'], timeoutSec: 1 }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.INVALID_REQUEST, status: 400 })
  })
})

describe('ChatApprovalService — voteCast / voteClose / voteStatus', () => {
  it('casts a vote and updates the tally', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'] })
    const state = await h.approval.voteCast({ threadId, userId: ALICE, option: 'B' })
    expect(state.votes[ALICE]).toBe('B')
  })

  it('rejects an invalid option', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'] })
    await expect(
      h.approval.voteCast({ threadId, userId: ALICE, option: 'C' }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.INVALID_REQUEST, status: 400 })
  })

  it('rejects casting on a closed vote', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'] })
    await h.approval.voteClose(threadId)
    await expect(
      h.approval.voteCast({ threadId, userId: ALICE, option: 'A' }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.VOTE_NOT_ACTIVE, status: 409 })
  })

  it('restricts casting to designated voters and auto-closes when all have cast', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const state = await h.approval.voteStart({
      threadId,
      userId: ALICE,
      question: 'q',
      options: ['A', 'B'],
      voters: [ALICE, BOB],
    })
    expect(state.voters).toEqual([ALICE, BOB])

    await expect(
      h.approval.voteCast({ threadId, userId: createUserId('intruder'), option: 'A' }),
    ).rejects.toMatchObject({ code: ProposalErrorCode.FORBIDDEN, status: 403 })

    await h.approval.voteCast({ threadId, userId: ALICE, option: 'A' })
    const afterAll = await h.approval.voteCast({ threadId, userId: BOB, option: 'B' })
    expect(afterAll.status).toBe('closed') // 全部指定投票人投完 → 自动关闭
  })

  it('closes a vote and publishes a tally (anonymous scrubs votes)', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await h.approval.voteStart({
      threadId,
      userId: ALICE,
      question: 'q',
      options: ['A', 'B'],
      anonymous: true,
    })
    await h.approval.voteCast({ threadId, userId: ALICE, option: 'A' })
    const closed = await h.approval.voteClose(threadId)
    expect(closed.status).toBe('closed')
    expect(closed.votes).toEqual({}) // 匿名：关闭后 votes 映射被抹除
    const status = await h.approval.voteStatus(threadId)
    expect(status?.status).toBe('closed')
  })

  it('keeps votes visible after close for a non-anonymous vote', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await h.approval.voteStart({ threadId, userId: ALICE, question: 'q', options: ['A', 'B'] })
    await h.approval.voteCast({ threadId, userId: ALICE, option: 'A' })
    const closed = await h.approval.voteClose(threadId)
    expect(closed.votes[ALICE]).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// Approval Hub
// ---------------------------------------------------------------------------

describe('ChatApprovalService — hubPending / hubSettled', () => {
  it('projects pending proposals, flagging stale approving ones', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(100_000))
      const h = harness()
      const { proposalId } = await h.approval.createProposal(proposeInput())
      h.backend.proposalStore.claimForApproval(proposalId, ALICE)
      vi.setSystemTime(new Date(100_000 + STALE_APPROVING_MS + 1))

      const items = await h.approval.hubPending(ALICE)
      expect(items).toHaveLength(1)
      expect(items[0]!.proposalId).toBe(proposalId)
      expect(items[0]!.status).toBe('stale')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sorts pending items by createdAt descending', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(100_000))
      const h = harness()
      await h.approval.createProposal(proposeInput({ title: 'first' }))
      vi.setSystemTime(new Date(200_000))
      await h.approval.createProposal(proposeInput({ title: 'second' }))
      const items = await h.approval.hubPending(ALICE)
      expect(items.map((i) => i.title)).toEqual(['second', 'first'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('projects settled proposals with decision metadata', async () => {
    const h = harness()
    const { proposalId } = await h.approval.createProposal(proposeInput())
    await h.approval.approve({ userId: ALICE, proposalId })
    const settled = await h.approval.hubSettled(ALICE)
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({
      proposalId,
      status: 'approved',
      decisionBy: ALICE,
    })
    expect(settled[0]!.createdThreadId).toBeTruthy()
  })
})

describe('ChatApprovalError', () => {
  it('carries a typed code and http status', () => {
    const err = new ChatApprovalError(ProposalErrorCode.FORBIDDEN, 'nope', 403, { field: 'x' })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe(ProposalErrorCode.FORBIDDEN)
    expect(err.status).toBe(403)
    expect(err.detail).toEqual({ field: 'x' })
    expect(err.name).toBe('ChatApprovalError')
  })
})
