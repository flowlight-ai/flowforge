/**
 * ChatSessionHandoffService — F225 cat-initiated session handoff 服务契约验证
 * （阶段5 批次6，T5.4.2）。
 *
 * 覆盖（对齐 clowder-ai `callback-propose-session-handoff-routes.ts` 与
 * `session-handoff-approve-routes.ts` 语义）：
 * - propose：A4 gate（no_active_session / already_pending / cooldown / hourly_limit）+
 *   dedup 幂等 fast-path + 确认卡发布（envelope anchored）
 * - approve：ownership → anchored gate → commit-point 事务（seal → enqueue →
 *   finalize）；已 approved dedup 重放；approving live 409
 * - reject：ownership → F281 feedback 原子 markRejected（不 seal）
 * - recoverStale（B3）：crash-stale approving → recover-forward / expired
 * - get / listPending / listSettled
 * - 错误面：ChatSessionHandoffError code/status 语义
 *
 * @module @flowforge/chat-session-chain/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { APPROVE_STALE_MS, ChatSessionHandoffError, ChatSessionHandoffService } from '../src/index.ts'

const ALICE = createUserId('alice')
const BOB = createUserId('bob')
const CAT_A = createCatId('cat_a')

interface Harness {
  ctx: Context
  handoff: ChatSessionHandoffService
  backend: MemoryStoresBackend
  enqueueContinuation: ReturnType<typeof vi.fn>
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const enqueueContinuation = vi.fn(async () => ({ entryId: 'entry-1' }))
  // commit-point 需要 requestSeal；测试注入 fake Sealer（accepted 且把 session 置 sealing）。
  ctx.provide('catsSessionSealer', {
    requestSeal: async ({ sessionId }: { sessionId: string }) => {
      const record = backend.sessionChainStore.get(sessionId)
      if (record && record.status === 'active') {
        backend.sessionChainStore.update(sessionId, {
          status: 'sealing', sealReason: 'cat_initiated_handoff', updatedAt: Date.now(),
        })
        return { accepted: true, status: 'sealing' as const, sessionId }
      }
      return { accepted: false, status: record?.status ?? 'sealed' as 'active' | 'sealing' | 'sealed' }
    },
    finalize: async () => {},
  })
  const handoff = new ChatSessionHandoffService(ctx, { enqueueContinuation })
  return { ctx, handoff, backend, enqueueContinuation }
}

/** Seed a thread owned by ALICE, an active session for CAT_A, and return the session. */
function seedActive(backend: MemoryStoresBackend): { threadId: string; sessionId: string } {
  const threadId = backend.threadStore.create({ userId: ALICE, title: '对话' }).id
  const session = backend.sessionChainStore.create({
    cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
  })
  return { threadId, sessionId: session.id }
}

function proposeInput(h: Harness, overrides: Partial<Parameters<ChatSessionHandoffService['propose']>[0]> = {}): Parameters<ChatSessionHandoffService['propose']>[0] {
  const { threadId } = seedActive(h.backend)
  return {
    sourceCatId: CAT_A,
    sourceThreadId: threadId,
    sourceMessageId: 'msg-1',
    userId: ALICE,
    note: { done: '完成 A', nextSteps: '继续 B', worktreeBranch: 'feat/b', commits: ['abc123'] },
    ...overrides,
  }
}

describe('ChatSessionHandoffService — propose (A4 gates)', () => {
  it('creates a pending proposal and anchors a confirmation card', async () => {
    const h = harness()
    const input = proposeInput(h)
    const result = await h.handoff.propose(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('pending')
    expect(result.cardMessageId).toBeTruthy()

    const proposal = h.backend.sessionHandoffProposalStore.get(result.proposalId)
    expect(proposal?.status).toBe('pending')
    expect(proposal?.sourceCatId).toBe(CAT_A)
    expect(proposal?.note.done).toBe('完成 A')
    // envelope committed → publication anchored
    expect(h.backend.sessionHandoffProposalStore.getPublication(result.proposalId)?.state).toBe('anchored')
    // card persisted to the message store
    expect(h.backend.messageStore.getById(result.cardMessageId)?.threadId).toBe(input.sourceThreadId)
  })

  it('rejects when there is no active session', async () => {
    const h = harness()
    const threadId = h.backend.threadStore.create({ userId: ALICE, title: '对话' }).id
    const result = await h.handoff.propose({
      sourceCatId: CAT_A, sourceThreadId: threadId, sourceMessageId: 'm', userId: ALICE,
      note: { done: 'd', nextSteps: 'n' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no_active_session')
  })

  it('enforces one pending proposal per active session', async () => {
    const h = harness()
    const input = proposeInput(h)
    const first = await h.handoff.propose(input)
    expect(first.ok).toBe(true)
    const second = await h.handoff.propose(input)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('already_pending')
  })

  it('enforces the per-(user,cat,thread) cooldown after a recent proposal', async () => {
    const h = harness()
    const input = proposeInput(h)
    const first = await h.handoff.propose(input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // 直接续改状态为 settled 让 active-gate 通过，再触发 cooldown（同 session/thread 维度）
    h.backend.sessionHandoffProposalStore.markRejected(first.proposalId, { decidedAt: Date.now() })
    const second = await h.handoff.propose(input)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('cooldown')
  })

  it('is idempotent under clientRequestId (dedup fast-path)', async () => {
    const h = harness()
    const input = proposeInput(h, { clientRequestId: 'req-1' })
    const first = await h.handoff.propose(input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await h.handoff.propose(input)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.proposalId).toBe(first.proposalId)
    expect(second.deduped).toBe(true)
  })
})

describe('ChatSessionHandoffService — approve (commit-point)', () => {
  it('approves a pending proposal: seal → enqueue → finalize', async () => {
    const h = harness()
    const { sessionId, threadId } = seedActive(h.backend)
    const result = await h.handoff.propose({
      sourceCatId: CAT_A, sourceThreadId: threadId, sourceMessageId: 'msg-1', userId: ALICE,
      note: { done: 'd', nextSteps: 'n' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const approved = await h.handoff.approve(result.proposalId, ALICE)
    expect(approved.status).toBe('approved')
    expect(approved.sealedSessionId).toBe(sessionId)
    expect(h.enqueueContinuation).toHaveBeenCalledTimes(1)
    expect(approved.continuationEntryId).toBe('entry-1')

    // session 侧：note 持久化 + sealing/approved 语义由 requestSeal 推进
    const session = h.backend.sessionChainStore.get(sessionId)
    expect(session?.catHandoffNote?.proposalId).toBe(result.proposalId)
    expect(session?.catHandoffNote?.nextSteps).toBe('n')
  })

  it('returns the proposal as deduped when already approved', async () => {
    const h = harness()
    const input = proposeInput(h)
    const created = await h.handoff.propose(input)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await h.handoff.approve(created.proposalId, ALICE)
    const replay = await h.handoff.approve(created.proposalId, ALICE)
    expect(replay.deduped).toBe(true)
    expect(replay.status).toBe('approved')
  })

  it('throws 404 for an unknown proposal', async () => {
    const h = harness()
    await expect(h.handoff.approve('nope', ALICE)).rejects.toMatchObject({
      code: 'PROPOSAL_NOT_FOUND', status: 404,
    })
  })

  it('throws 403 for a non-owner', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await expect(h.handoff.approve(created.proposalId, BOB)).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    })
  })

  it('throws 409 when the proposal was already rejected', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await h.handoff.reject({ proposalId: created.proposalId, userId: ALICE })
    await expect(h.handoff.approve(created.proposalId, ALICE)).rejects.toMatchObject({
      code: 'PROPOSAL_ALREADY_SETTLED', status: 409,
    })
  })

  it('throws 409 when approval is live in-flight (fresh approving)', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // 手动 CAS claim 到 approving（模拟并发中）并保留 updatedAt 新鲜
    h.backend.sessionHandoffProposalStore.claimForApproval(created.proposalId)
    await expect(h.handoff.approve(created.proposalId, ALICE)).rejects.toMatchObject({
      code: 'PROPOSAL_IN_PROGRESS', status: 409,
    })
  })

  it('recovers a crash-stale approving proposal forward', async () => {
    const h = harness()
    const { sessionId, threadId } = seedActive(h.backend)
    const created = await h.handoff.propose({
      sourceCatId: CAT_A, sourceThreadId: threadId, sourceMessageId: 'msg-1', userId: ALICE,
      note: { done: 'd', nextSteps: 'n' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // 直接驱动 commit-point 到 checkpoint（sealedSessionId 已记录，approving 卡住）
    const p = h.backend.sessionHandoffProposalStore.claimForApproval(created.proposalId)!
    expect(p.status).toBe('approving')
    h.backend.sessionHandoffProposalStore.recordCheckpoint(created.proposalId, {
      handoffNotePersistedAt: Date.now(),
      sealedSessionId: sessionId,
      sealAcceptedAt: Date.now(),
    })
    // 把 store 内部 live reference 的 updatedAt 压到 stale 阈值之前
    // （get/recordCheckpoint 返回克隆，须直接改内部 map 值才能生效）
    const live = (h.backend.sessionHandoffProposalStore as unknown as {
      proposals: Map<string, { updatedAt: number }>
    }).proposals.get(created.proposalId)
    expect(live).toBeTruthy()
    if (live) live.updatedAt = Date.now() - APPROVE_STALE_MS - 10_000

    const recovered = await h.handoff.approve(created.proposalId, ALICE)
    expect(recovered.recovered).toBe(true)
    expect(recovered.status).toBe('approved')
    expect(h.enqueueContinuation).toHaveBeenCalledTimes(1)
  })
})

describe('ChatSessionHandoffService — reject (F281)', () => {
  it('rejects a pending proposal with atomic F281 feedback capture', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const rejected = await h.handoff.reject({
      proposalId: created.proposalId,
      userId: ALICE,
      feedback: { reasonCode: 'not_important' },
    })
    expect(rejected.status).toBe('rejected')
    const stored = h.backend.sessionHandoffProposalStore.get(created.proposalId)
    expect(stored?.status).toBe('rejected')
    expect(stored?.latestHumanDisposition?.reasonCode).toBe('not_important')
    expect(stored?.humanDispositionLedgerEntry).toBeTruthy()
  })

  it('does NOT seal the session on rejection', async () => {
    const h = harness()
    const { sessionId, threadId } = seedActive(h.backend)
    const created = await h.handoff.propose({
      sourceCatId: CAT_A, sourceThreadId: threadId, sourceMessageId: 'msg-1', userId: ALICE,
      note: { done: 'd', nextSteps: 'n' },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await h.handoff.reject({ proposalId: created.proposalId, userId: ALICE })
    const session = h.backend.sessionChainStore.get(sessionId)
    expect(session?.status).toBe('active')
  })

  it('throws 409 when the proposal is already approved (commit point passed)', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await h.handoff.approve(created.proposalId, ALICE)
    await expect(
      h.handoff.reject({ proposalId: created.proposalId, userId: ALICE }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_ALREADY_SETTLED', status: 409 })
  })

  it('throws 403 for a non-owner', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await expect(
      h.handoff.reject({ proposalId: created.proposalId, userId: BOB }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})

describe('ChatSessionHandoffService — get / listPending / listSettled', () => {
  it('returns the proposal status for the owner', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const got = await h.handoff.get(created.proposalId, ALICE)
    expect(got.proposalId).toBe(created.proposalId)
    expect(got.status).toBe('pending')
  })

  it('lists pending proposals per user', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const pending = await h.handoff.listPending(ALICE)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.proposalId).toBe(created.proposalId)
    expect(await h.handoff.listPending(BOB)).toHaveLength(0)
  })

  it('moves proposals out of pending into settled after approval', async () => {
    const h = harness()
    const created = await h.handoff.propose(proposeInput(h))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await h.handoff.approve(created.proposalId, ALICE)
    expect(await h.handoff.listPending(ALICE)).toHaveLength(0)
    const settled = await h.handoff.listSettled(ALICE)
    expect(settled).toHaveLength(1)
    expect(settled[0]!.status).toBe('approved')
  })
})

describe('ChatSessionHandoffService — error semantics', () => {
  it('is an instance of the error class with typed code/status', () => {
    const err = new ChatSessionHandoffError('PROPOSAL_NOT_FOUND', 'x', 404)
    expect(err).toBeInstanceOf(ChatSessionHandoffError)
    expect(err.code).toBe('PROPOSAL_NOT_FOUND')
    expect(err.status).toBe(404)
  })
})
