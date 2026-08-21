/**
 * handoff — F225 propose/approve/recover 纯函数契约验证（阶段5 批次6，T5.4.2）。
 *
 * 直接驱动 {@link proposeSessionHandoff} / {@link approveSessionHandoff} /
 * {@link recoverStaleHandoffProposal}，注入可控 deps（now 时钟 / store 桩）验证
 * commit-point 事务与崩溃恢复的每个边界：
 * - propose：A4 四门（no_active_session / already_pending / cooldown / hourly_limit）
 * - approve：claim → still-active 校验 → note 持久化 → requestSeal(commit point) →
 *   enqueue → finalize；pre-commit 失败（not_pending / session_changed / seal_rejected）
 * - recover：commit-point 已过 backfill + recover-forward；未过安全 expire
 *
 * @module @flowforge/chat-session-chain/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { createCatId, createThreadId } from '@flowforge/cats-shared'
import type { SessionHandoffProposal } from '@flowforge/cats-shared'
import type { ISessionHandoffProposalStore, ISessionChainStore } from '@flowforge/cats-stores'
import { MemorySessionHandoffProposalStore, MemorySessionChainStore } from '@flowforge/cats-stores/memory'
import {
  approveSessionHandoff,
  proposeSessionHandoff,
  recoverStaleHandoffProposal,
  type ProposeHandoffDeps,
  type SessionHandoffApproveDeps,
} from '../src/index.ts'

const ALICE = 'alice'
const CAT_A = createCatId('cat_a')
const T1 = createThreadId('t1')

const NOTE = { done: '完成 A', nextSteps: '继续 B', worktreeBranch: 'feat/b', commits: ['abc123'] }

interface Env {
  handoffs: ISessionHandoffProposalStore
  chains: ISessionChainStore
  now: () => number
}

function env(): Env {
  const handoffs = new MemorySessionHandoffProposalStore()
  const chains = new MemorySessionChainStore()
  const now = vi.fn(() => 1_000_000)
  return { handoffs, chains, now }
}

async function seedActive(chains: ISessionChainStore): Promise<{ threadId: string; sessionId: string }> {
  const session = await chains.create({ cliSessionId: 'cli-1', threadId: T1, catId: CAT_A, userId: ALICE })
  return { threadId: T1, sessionId: session.id }
}

/** 在 chains/handoffs 已就绪的 env 上跑 propose 主流程。 */
async function proposeEnv(overrides: Partial<ProposeHandoffDeps> = {}) {
  const e = env()
  const { threadId, sessionId } = await seedActive(e.chains)
  const deps: ProposeHandoffDeps = { handoffProposalStore: e.handoffs, sessionChainStore: e.chains, now: e.now, ...overrides }
  return { e, threadId, sessionId, deps }
}

function approveDeps(e: Env, overrides: Partial<SessionHandoffApproveDeps> = {}): SessionHandoffApproveDeps {
  return {
    handoffProposalStore: e.handoffs,
    sessionChainStore: e.chains,
    requestSeal: async (sessionId, reason) => {
      const record = await e.chains.get(sessionId)
      if (!record || record.status !== 'active') return { accepted: false }
      await e.chains.update(sessionId, { status: 'sealing', sealReason: reason as 'threshold', updatedAt: Date.now() })
      return { accepted: true }
    },
    enqueueContinuation: async () => ({ entryId: 'entry-1' }),
    now: e.now,
    ...overrides,
  }
}

describe('proposeSessionHandoff — A4 gates', () => {
  it('creates a pending proposal for the active session', async () => {
    const { e, sessionId, deps } = await proposeEnv()
    const result = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.status).toBe('pending')
    expect(result.proposal.sourceSessionId).toBe(sessionId)
    expect(result.proposal.note.done).toBe('完成 A')
    expect(await e.handoffs.get(result.proposal.proposalId)).toBeTruthy()
  })

  it('rejects when there is no active session', async () => {
    const e = env()
    const result = await proposeSessionHandoff(
      { handoffProposalStore: e.handoffs, sessionChainStore: e.chains, now: e.now },
      { sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE },
    )
    expect(result).toEqual({ ok: false, reason: 'no_active_session' })
  })

  it('rejects when a proposal is already active for the session', async () => {
    const { deps } = await proposeEnv()
    await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    const second = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm2', userId: ALICE, note: NOTE,
    })
    expect(second).toEqual({ ok: false, reason: 'already_pending' })
  })

  it('rejects on cooldown when a recent proposal exists (any status)', async () => {
    const { deps } = await proposeEnv()
    const first = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // 直接在 store 上把 proposal 置为 settled（不引入额外 import）
    await (deps.handoffProposalStore as MemorySessionHandoffProposalStore).markRejected(
      first.proposal.proposalId,
      { decidedAt: 1_000_000 },
    )
    const second = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm2', userId: ALICE, note: NOTE,
    })
    expect(second).toEqual({ ok: false, reason: 'cooldown' })
  })

  it('rejects on hourly cap when the window is full', async () => {
    const { deps } = await proposeEnv()
    // cooldownMs: 0 绕过冷却判定，专测 hourly cap（now 为固定小值 → 所有 createdAt 均在窗口内）
    const deps0 = { ...deps, cooldownMs: 0 } as ProposeHandoffDeps
    // 先铺满窗口（HANDOFF_HOURLY_LIMIT = 5）：创建 5 个并立即 settled 释放 active-gate
    for (let i = 0; i < 5; i++) {
      const r = await proposeSessionHandoff(deps0, {
        sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: `m${i}`, userId: ALICE, note: NOTE,
      })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      // 立即 settled 掉释放 active-gate
      await (deps.handoffProposalStore as MemorySessionHandoffProposalStore).markRejected(
        (r as { ok: true; proposal: SessionHandoffProposal }).proposal.proposalId,
        { decidedAt: 1_000_000 },
      )
    }
    const capped = await proposeSessionHandoff(deps0, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm9', userId: ALICE, note: NOTE,
    })
    expect(capped).toEqual({ ok: false, reason: 'hourly_limit' })
  })
})

describe('approveSessionHandoff — commit-point transaction', () => {
  it('approves through claim → note → seal → enqueue → finalize', async () => {
    const { e, sessionId, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const enqueue = vi.fn(async () => ({ entryId: 'entry-1' }))
    const result = await approveSessionHandoff(approveDeps(e, { enqueueContinuation: enqueue }), created.proposal.proposalId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.status).toBe('approved')
    expect(result.proposal.sealedSessionId).toBe(sessionId)
    expect(result.proposal.continuationEntryId).toBe('entry-1')
    expect(enqueue).toHaveBeenCalledTimes(1)
    // session 侧：note 持久化 + sealing
    const session = await e.chains.get(sessionId)!
    expect(session!.status).toBe('sealing')
    expect(session!.catHandoffNote?.proposalId).toBe(created.proposal.proposalId)
  })

  it('fails with not_pending when the proposal is not pending', async () => {
    const { e, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // 先 reject 置为终态
    await (deps.handoffProposalStore as MemorySessionHandoffProposalStore).markRejected(
      created.proposal.proposalId,
      { decidedAt: 1_000_000 },
    )
    const result = await approveSessionHandoff(approveDeps(e), created.proposal.proposalId)
    expect(result).toEqual({ ok: false, stage: 'pre-commit', reason: 'not_pending' })
  })

  it('fails with session_changed and expires when the session is no longer active', async () => {
    const { e, sessionId, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // 会话已被其它路径 seal
    await e.chains.update(sessionId, { status: 'sealed', sealReason: 'manual', sealedAt: 1, updatedAt: 1 })
    const result = await approveSessionHandoff(approveDeps(e), created.proposal.proposalId)
    expect(result).toEqual({ ok: false, stage: 'pre-commit', reason: 'session_changed' })
    expect((await e.handoffs.get(created.proposal.proposalId))?.status).toBe('expired')
  })

  it('fails with seal_rejected and expires when requestSeal is declined', async () => {
    const { e, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const result = await approveSessionHandoff(
      approveDeps(e, { requestSeal: async () => ({ accepted: false }) }),
      created.proposal.proposalId,
    )
    expect(result).toEqual({ ok: false, stage: 'pre-commit', reason: 'seal_rejected' })
    expect((await e.handoffs.get(created.proposal.proposalId))?.status).toBe('expired')
  })
})

describe('recoverStaleHandoffProposal — crash recovery (B3)', () => {
  it('completes recover-forward when the commit point was crossed', async () => {
    const { e, sessionId, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // 模拟 crash 于 commit point 之后：session 已 seal，proposal 卡在 approving（有 sealedSessionId）
    const h = deps.handoffProposalStore as MemorySessionHandoffProposalStore
    h.claimForApproval(created.proposal.proposalId)
    h.recordCheckpoint(created.proposal.proposalId, {
      handoffNotePersistedAt: 1_000_000,
      sealedSessionId: sessionId,
      sealAcceptedAt: 1_000_000,
    })
    const enqueue = vi.fn(async () => ({ entryId: 'entry-recovered' }))
    const rec = await recoverStaleHandoffProposal(approveDeps(e, { enqueueContinuation: enqueue }), created.proposal.proposalId)
    expect(rec).toEqual({ recovered: true, outcome: 'completed' })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect((await h.get(created.proposal.proposalId))?.status).toBe('approved')
  })

  it('backfills the commit-point checkpoint when only the session side proves the seal', async () => {
    const { e, sessionId, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // crash 于 note → seal 之间：无任何 checkpoint，但 session 侧已被本次 handoff seal
    const h = deps.handoffProposalStore as MemorySessionHandoffProposalStore
    h.claimForApproval(created.proposal.proposalId)
    await e.chains.update(sessionId, {
      status: 'sealing',
      sealReason: 'cat_initiated_handoff' as const,
      catHandoffNote: {
        proposalId: created.proposal.proposalId,
        sourceSessionId: sessionId,
        done: '完成 A',
        nextSteps: '继续 B',
        persistedAt: 1_000_000,
      },
      updatedAt: 1_000_000,
    })
    const rec = await recoverStaleHandoffProposal(approveDeps(e), created.proposal.proposalId)
    expect(rec).toEqual({ recovered: true, outcome: 'completed' })
    const proposal = await h.get(created.proposal.proposalId)!
    expect(proposal!.status).toBe('approved')
    expect(proposal!.sealedSessionId).toBe(sessionId)
  })

  it('safely expires when the seal never happened (true pre-commit)', async () => {
    const { e, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    // crash 于 claim 后、任何 checkpoint 前；session 仍 active → 安全 expire
    const h = deps.handoffProposalStore as MemorySessionHandoffProposalStore
    h.claimForApproval(created.proposal.proposalId)
    const rec = await recoverStaleHandoffProposal(approveDeps(e), created.proposal.proposalId)
    expect(rec).toEqual({ recovered: true, outcome: 'expired' })
    expect((await h.get(created.proposal.proposalId))?.status).toBe('expired')
  })

  it('returns not_approving when the proposal is not stuck in approving', async () => {
    const { e, deps } = await proposeEnv()
    const created = await proposeSessionHandoff(deps, {
      sourceCatId: CAT_A, sourceThreadId: T1, sourceMessageId: 'm', userId: ALICE, note: NOTE,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const rec = await recoverStaleHandoffProposal(approveDeps(e), created.proposal.proposalId)
    expect(rec).toEqual({ recovered: false, reason: 'not_approving' })
  })
})