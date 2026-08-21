/**
 * Chat 阶段5 跨包 e2e（T5.12）— 验收级四场景（25-stage5-chat.md 验收标准 1-3）。
 *
 * 场景（每场景一个 describe，装配真实服务而非 mock 桩）：
 * 1. realtime-dual-client：双客户端线程房间实时收发 + 非成员隔离 +
 *    seq/seqEpoch 单调注入（F183）+ emitToUser 定向
 * 2. mention-concurrent-threads：@ 多灵智体并发交错响应归集 + 线程间
 *    状态隔离 + 反级联守卫
 * 3. handoff-context-continuity：propose → approve commit-point 封存 →
 *    unseal 重开，链上旧会话摘要（catHandoffNote）可被新会话引用
 * 4. approval-state-machine：提案 pending→approving→approved（建线程
 *    finalize）+ settled 聚合 + 投票 active→closed
 *
 * @module @flowforge/chat-e2e/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createThreadId, createUserId } from '@flowforge/cats-shared'
import type { CatId, UserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { ChatRealtimeService, EVENT_THREAD_MESSAGE, InMemoryRealtimeTransport } from '@flowforge/chat-realtime'
import type { AgentMessage, BroadcastAgentMessage } from '@flowforge/chat-realtime'
import type { InMemoryRealtimeClient } from '@flowforge/chat-realtime'
import { MultiMentionOrchestratorService } from '@flowforge/chat-mention'
import { ChatApprovalService } from '@flowforge/chat-approval'
import { ChatSessionHandoffService, SessionChainService } from '@flowforge/chat-session-chain'
import { CHAT_E2E_SCENARIOS, CHAT_E2E_SCENARIO_SPECS } from '../src/index.ts'

const ALICE: UserId = createUserId('alice')
const BOB: UserId = createUserId('bob')
const CAROL: UserId = createUserId('carol')
const T1 = createThreadId('t1')
const T2 = createThreadId('t2')
const CAT_A: CatId = createCatId('cat_a')
const CAT_B: CatId = createCatId('cat_b')
const CAT_C: CatId = createCatId('cat_c')
const CAT_LEAD: CatId = createCatId('cat_lead')

// ---------------------------------------------------------------------------
// 场景 1：双客户端实时收发（验收标准 1）
// ---------------------------------------------------------------------------

function agentMessage(catId: CatId, content = 'hi'): AgentMessage {
  return { type: 'text', catId, content, timestamp: Date.now() }
}

function threadMessages(client: InMemoryRealtimeClient): BroadcastAgentMessage[] {
  return client.received
    .filter((e) => e.event === EVENT_THREAD_MESSAGE)
    .map((e) => e.payload as BroadcastAgentMessage)
}

function events(client: InMemoryRealtimeClient, event: string): unknown[] {
  return client.received.filter((e) => e.event === event).map((e) => e.payload)
}

describe('e2e 场景1：双客户端实时收发（T5.12）', () => {
  it('双客户端同房间实时收发 + 非成员隔离 + seq 单调', () => {
    const ctx = new Context()
    const transport = new InMemoryRealtimeTransport()
    const realtime = new ChatRealtimeService(ctx, { transport })

    const alice = transport.connect(ALICE)
    const bob = transport.connect(BOB)
    const carol = transport.connect(CAROL) // 未加入线程房间
    alice.send('join_room', `thread:${T1}`)
    bob.send('join_room', `thread:${T1}`)

    realtime.broadcastAgentMessage(agentMessage(CAT_A, '第一条'), T1)
    realtime.broadcastAgentMessage(agentMessage(CAT_B, '第二条'), T1)

    // 同房间双客户端均收到，且 seq 单调递增（F183）
    expect(threadMessages(alice).map((m) => m.seq)).toEqual([1, 2])
    expect(threadMessages(bob).map((m) => m.seq)).toEqual([1, 2])
    // 非成员隔离：carol 未加入房间收不到
    expect(threadMessages(carol)).toHaveLength(0)
    // seqEpoch 一致注入
    const [first, second] = threadMessages(alice)
    expect(first?.seqEpoch).toBe(second?.seqEpoch)
  })

  it('emitToUser 定向 + 其他线程房间隔离', () => {
    const ctx = new Context()
    const transport = new InMemoryRealtimeTransport()
    const realtime = new ChatRealtimeService(ctx, { transport })

    const alice = transport.connect(ALICE)
    const bob = transport.connect(BOB)

    realtime.emitToUser(ALICE, 'custom:notice', { hello: 1 })
    expect(events(alice, 'custom:notice')).toHaveLength(1)
    expect(events(bob, 'custom:notice')).toHaveLength(0)

    // 加入 t1 的客户端收不到 t2 的消息
    alice.send('join_room', `thread:${T1}`)
    realtime.broadcastAgentMessage(agentMessage(CAT_A, 't2 消息'), T2)
    expect(threadMessages(alice)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 场景 2：@ 多灵智体并发响应线程隔离（验收标准 1 后半）
// ---------------------------------------------------------------------------

describe('e2e 场景2：@ 多灵智体并发线程隔离（T5.12）', () => {
  it('并发交错响应归集 + 线程间状态互不影响', () => {
    const ctx = new Context()
    const mention = new MultiMentionOrchestratorService(ctx)

    const r1 = mention.create({
      threadId: T1,
      initiator: CAT_LEAD,
      callbackTo: CAT_LEAD,
      targets: [CAT_A, CAT_B],
      question: 'Q1：并行任务分配',
      timeoutMinutes: 5,
    })
    const r2 = mention.create({
      threadId: T2,
      initiator: CAT_LEAD,
      callbackTo: CAT_LEAD,
      targets: [CAT_C],
      question: 'Q2：另一个线程',
      timeoutMinutes: 5,
    })
    mention.start(r1.id)
    mention.start(r2.id)

    // 并发交错：t1 的 cat_a、t2 的 cat_c、t1 的 cat_b 依次响应
    expect(mention.recordResponse(r1.id, CAT_A, 'A 完成')).toBe('partial')
    expect(mention.recordResponse(r2.id, CAT_C, 'C 完成')).toBe('done')
    expect(mention.recordResponse(r1.id, CAT_B, 'B 完成')).toBe('done')

    // 归集完整性
    const result = mention.getResult(r1.id)
    expect(result.responses.map((r) => r.catId).sort()).toEqual([CAT_A, CAT_B].sort())
    // 线程隔离：t2 done 不影响 t1（t1 先 partial 后 done 已断言）
    expect(mention.findActiveByThread(T1)).toHaveLength(0)
    expect(mention.findActiveByThread(T2)).toHaveLength(0)
  })

  it('反级联守卫：未完成线程保持 partial 且 target 不串线程', () => {
    const ctx = new Context()
    const mention = new MultiMentionOrchestratorService(ctx)

    const r1 = mention.create({
      threadId: T1,
      initiator: CAT_LEAD,
      callbackTo: CAT_LEAD,
      targets: [CAT_A, CAT_B],
      question: 'Q1',
      timeoutMinutes: 5,
    })
    const r2 = mention.create({
      threadId: T2,
      initiator: CAT_LEAD,
      callbackTo: CAT_LEAD,
      targets: [CAT_C],
      question: 'Q2',
      timeoutMinutes: 5,
    })
    mention.start(r1.id)
    mention.start(r2.id)

    mention.recordResponse(r1.id, CAT_A, 'A 完成')
    // t1 未完成：partial；t2 独立完成：done
    expect(mention.getStatus(r1.id)).toBe('partial')
    mention.recordResponse(r2.id, CAT_C, 'C 完成')
    expect(mention.getStatus(r2.id)).toBe('done')
    expect(mention.getStatus(r1.id)).toBe('partial')
    // 反级联守卫：t1 的 target cat_b 不因 t2 的完成而收到任何归集
    expect(mention.getResult(r1.id).responses).toHaveLength(1)
    // 非靶点响应被忽略（cat_c 不属于 t1）
    expect(mention.recordResponse(r1.id, CAT_C, '乱入')).toBe('partial')
    expect(mention.getResult(r1.id).responses).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 场景 3：交接链上下文连续（验收标准 2）
// ---------------------------------------------------------------------------

function handoffHarness() {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const enqueueContinuation = vi.fn(async () => ({ entryId: 'entry-1' }))
  // commit-point 需要 requestSeal：注入 fake Sealer（accepted → sealing → finalize sealed）。
  ctx.provide('catsSessionSealer', {
    requestSeal: async ({ sessionId }: { sessionId: string }) => {
      const record = backend.sessionChainStore.get(sessionId)
      if (record && record.status === 'active') {
        backend.sessionChainStore.update(sessionId, {
          status: 'sealing', sealReason: 'cat_initiated_handoff', updatedAt: Date.now(),
        })
        return { accepted: true }
      }
      return { accepted: false }
    },
    finalize: async ({ sessionId }: { sessionId: string }) => {
      const record = backend.sessionChainStore.get(sessionId)
      if (record && record.status === 'sealing') {
        backend.sessionChainStore.update(sessionId, {
          status: 'sealed', sealedAt: Date.now(), updatedAt: Date.now(),
        })
      }
      return {}
    },
  })
  const chain = new SessionChainService(ctx)
  const handoff = new ChatSessionHandoffService(ctx, { enqueueContinuation })
  return { ctx, backend, chain, handoff, enqueueContinuation }
}

describe('e2e 场景3：交接链上下文连续（T5.12）', () => {
  it('propose → approve commit-point 封存 → unseal 重开，摘要上下文连续', async () => {
    const h = handoffHarness()
    const threadId = h.backend.threadStore.create({ userId: ALICE, title: '对话' }).id
    const session = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })

    // cat-side propose（携带阶段摘要 note）
    const proposed = await h.handoff.propose({
      sourceCatId: CAT_A,
      sourceThreadId: threadId,
      sourceMessageId: 'msg-1',
      userId: ALICE,
      note: { done: '完成阶段1', nextSteps: '阶段2：接入评测', worktreeBranch: 'feat/stage2' },
    })
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.status).toBe('pending')

    // user-side approve：commit-point（requestSeal accepted → sealing）→ finalize sealed
    const approved = await h.handoff.approve(proposed.proposalId, ALICE)
    expect(approved.status).toBe('approved')
    const sealed = h.backend.sessionChainStore.get(session.id)
    expect(sealed?.status).toBe('sealed')
    // 上下文摘要固化到 session（catHandoffNote）
    expect(sealed?.catHandoffNote?.nextSteps).toContain('阶段2')
    // 续接入队（幂等 key = proposalId）
    expect(h.enqueueContinuation).toHaveBeenCalled()

    // unseal：新 active session 承接上下文（同 cliSessionId）
    const unsealed = await h.chain.unsealSession(session.id, ALICE)
    expect(unsealed.mode).toBe('reopened')
    expect(unsealed.session?.cliSessionId).toBe('cli-1')

    // 链上两个 session，新会话 active，旧会话 sealed —— 摘要仍可读
    const sessions = await h.chain.listSessions({ threadId, userId: ALICE })
    expect(sessions).toHaveLength(2)
    const oldRecord = await h.chain.getSession(session.id, ALICE)
    expect(oldRecord.catHandoffNote?.done).toBe('完成阶段1')
    const fresh = await h.chain.getSession(unsealed.session!.id, ALICE)
    expect(fresh.status).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// 场景 4：审批流状态机（验收标准 3）
// ---------------------------------------------------------------------------

function approvalHarness() {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const approval = new ChatApprovalService(ctx)
  return { ctx, backend, approval }
}

describe('e2e 场景4：审批流状态机（T5.12）', () => {
  it('提案 pending→approved 建线程 finalize + settled 聚合', async () => {
    const h = approvalHarness()
    const proposal = await h.approval.createProposal({
      sourceThreadId: T1,
      sourceInvocationId: 'inv_1',
      sourceCatId: CAT_A,
      title: '开启子线程提案',
      reason: '需要并行推进',
      projectPath: '/w/proj',
      createdBy: ALICE,
    })
    expect(proposal.status).toBe('pending')
    expect(proposal.parentThreadId).toBe(T1)

    const approved = await h.approval.approve({ userId: ALICE, proposalId: proposal.proposalId })
    expect(approved.status).toBe('approved')
    expect(approved.threadId).toBeTruthy()
    // finalize 后新线程真实存在
    expect(h.backend.threadStore.getById(approved.threadId!)).not.toBeNull()

    // 已决聚合投影可见
    const settled = await h.approval.hubSettled(ALICE)
    expect(settled.some((x) => x.proposalId === proposal.proposalId)).toBe(true)
  })

  it('投票状态机 active→closed（匿名 votes 抹除）+ 终态守卫', async () => {
    const h = approvalHarness()
    const threadId = h.backend.threadStore.create({ userId: ALICE, title: '投票线程' }).id

    const vote = await h.approval.voteStart({
      threadId,
      userId: ALICE,
      question: '是否继续？',
      options: ['继续', '暂停'],
      anonymous: true,
    })
    expect(vote.status).toBe('active')

    await h.approval.voteCast({ threadId, userId: ALICE, option: '继续' })
    await h.approval.voteCast({ threadId, userId: BOB, option: '继续' })
    const closed = await h.approval.voteClose(threadId)
    expect(closed.status).toBe('closed')
    // 匿名表决：投票人映射抹除（tally 语义由 votes.spec 的 buildVoteTally 覆盖）
    expect(closed.votes).toEqual({})

    // 终态守卫：重复关闭被拒（状态机不再回退 active）
    await expect(h.approval.voteClose(threadId)).rejects.toThrow()
  })

  it('指定投票人全部投完自动关闭', async () => {
    const h = approvalHarness()
    const threadId = h.backend.threadStore.create({ userId: ALICE, title: '投票线程' }).id

    await h.approval.voteStart({
      threadId,
      userId: ALICE,
      question: 'Q',
      options: ['a', 'b'],
      voters: [ALICE],
    })
    const closed = await h.approval.voteCast({ threadId, userId: ALICE, option: 'a' })
    expect(closed.status).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// 场景清单元数据（验收报告引用）
// ---------------------------------------------------------------------------

describe('e2e 场景清单（T5.12）', () => {
  it('四场景清单元数据完整', () => {
    expect(CHAT_E2E_SCENARIOS).toHaveLength(4)
    expect(CHAT_E2E_SCENARIO_SPECS.map((s) => s.id)).toEqual([...CHAT_E2E_SCENARIOS])
    for (const spec of CHAT_E2E_SCENARIO_SPECS) {
      expect(spec.description.length).toBeGreaterThan(0)
      expect(spec.assertions.length).toBeGreaterThan(0)
    }
  })
})
