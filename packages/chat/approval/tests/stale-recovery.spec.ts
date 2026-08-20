/**
 * stale-recovery — F128 stale-claim 崩溃恢复契约验证（阶段5 批次4，T5.6.2）。
 *
 * 覆盖 clowder-ai `proposal-stale-recovery.ts` 移植语义：
 * - claimAgeMs / isStaleClaim：approving 超窗判定（claimedAt 缺失视为无限旧）
 * - handleApproveStaleClaim：窗口内 in_flight；已建线程(finalize 成功)
 *   recovered / finalize 竞争失败 race_retry；未建线程 rollback → cleared
 * - handleRejectStaleClaim：已建线程 cannot_reject；未建线程 rollback → cleared
 * - assertDecisionAllowed：approve/reject 终态冲突（approved 幂等重放例外）
 *
 * @module @flowforge/chat-approval/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { createCatId, createThreadId, createUserId } from '@flowforge/cats-shared'
import type { ThreadProposal } from '@flowforge/cats-shared'
import type { IProposalStore } from '@flowforge/cats-stores'
import {
  assertDecisionAllowed,
  claimAgeMs,
  handleApproveStaleClaim,
  handleRejectStaleClaim,
  isStaleClaim,
  STALE_APPROVING_MS,
} from '../src/index.ts'

const USER = createUserId('alice')
const CAT = createCatId('cat_a')
const THREAD = createThreadId('t1')

function proposal(overrides: Partial<ThreadProposal> = {}): ThreadProposal {
  return {
    proposalId: 'proposal_1',
    status: 'pending',
    sourceThreadId: THREAD,
    sourceInvocationId: 'inv_1',
    sourceCatId: CAT,
    title: '提案',
    reason: 'reason',
    parentThreadId: THREAD,
    preferredCats: [],
    projectPath: '/w',
    createdBy: USER,
    createdAt: 1000,
    ...overrides,
  }
}

function storeStub(): Pick<IProposalStore, 'get' | 'finalizeApproval' | 'rollbackClaim'> {
  return {
    get: vi.fn(),
    finalizeApproval: vi.fn(),
    rollbackClaim: vi.fn(),
  }
}

describe('claimAgeMs / isStaleClaim', () => {
  it('reports infinite age when claimedAt is missing', () => {
    const p = proposal({ status: 'approving' })
    expect(claimAgeMs(p, 100_000)).toBe(Number.POSITIVE_INFINITY)
    expect(isStaleClaim(p, 100_000)).toBe(true)
  })

  it('computes age from claimedAt and crosses the stale threshold', () => {
    const p = proposal({ status: 'approving', claimedAt: 1000 })
    expect(claimAgeMs(p, 1000 + STALE_APPROVING_MS)).toBe(STALE_APPROVING_MS)
    expect(isStaleClaim(p, 1000 + STALE_APPROVING_MS)).toBe(false) // 等于阈值不算 stale
    expect(isStaleClaim(p, 1000 + STALE_APPROVING_MS + 1)).toBe(true)
  })

  it('is never stale for non-approving statuses', () => {
    expect(isStaleClaim(proposal({ status: 'pending', claimedAt: 1 }), 1_000_000)).toBe(false)
  })
})

describe('handleApproveStaleClaim', () => {
  it('returns in_flight within the stale window', async () => {
    const store = storeStub()
    const p = proposal({ status: 'approving', claimedAt: Date.now() })
    await expect(handleApproveStaleClaim({ proposal: p, proposalStore: store })).resolves.toEqual({
      kind: 'in_flight',
      status: 409,
    })
  })

  it('finalizes an existing thread and reports recovered', async () => {
    const store = storeStub()
    store.finalizeApproval = vi.fn().mockResolvedValue(proposal({ status: 'approved' }))
    const p = proposal({ status: 'approving', claimedAt: 1, createdThreadId: 'thread_created' })
    const outcome = await handleApproveStaleClaim({ proposal: p, proposalStore: store })
    expect(outcome).toEqual({ kind: 'recovered', threadId: 'thread_created', status: 'approved' })
    expect(store.finalizeApproval).toHaveBeenCalledWith({
      proposalId: 'proposal_1',
      createdThreadId: 'thread_created',
    })
    expect(store.rollbackClaim).not.toHaveBeenCalled()
  })

  it('returns race_retry when finalize loses a concurrent write', async () => {
    const store = storeStub()
    store.finalizeApproval = vi.fn().mockResolvedValue(null)
    const p = proposal({ status: 'approving', claimedAt: 1, createdThreadId: 'thread_created' })
    await expect(handleApproveStaleClaim({ proposal: p, proposalStore: store })).resolves.toEqual({
      kind: 'race_retry',
    })
  })

  it('rolls back the claim and clears when no thread was created', async () => {
    const store = storeStub()
    store.rollbackClaim = vi.fn().mockResolvedValue(true)
    const p = proposal({ status: 'approving', claimedAt: 1 })
    const outcome = await handleApproveStaleClaim({ proposal: p, proposalStore: store })
    expect(outcome).toEqual({ kind: 'cleared' })
    expect(store.rollbackClaim).toHaveBeenCalledWith('proposal_1')
    expect(store.finalizeApproval).not.toHaveBeenCalled()
  })

  it('clears immediately for a non-approving proposal', async () => {
    const store = storeStub()
    await expect(
      handleApproveStaleClaim({ proposal: proposal(), proposalStore: store }),
    ).resolves.toEqual({ kind: 'cleared' })
  })
})

describe('handleRejectStaleClaim', () => {
  it('returns cannot_reject when a thread was already created', async () => {
    const store = storeStub()
    store.finalizeApproval = vi.fn().mockResolvedValue(proposal({ status: 'approved' }))
    const p = proposal({ status: 'approving', claimedAt: 1, createdThreadId: 'thread_created' })
    const outcome = await handleRejectStaleClaim({ proposal: p, proposalStore: store })
    expect(outcome).toEqual({ kind: 'cannot_reject', status: 409 })
    expect(store.finalizeApproval).toHaveBeenCalled()
  })

  it('rolls back the claim and clears when no thread was created', async () => {
    const store = storeStub()
    store.rollbackClaim = vi.fn().mockResolvedValue(true)
    const p = proposal({ status: 'approving', claimedAt: 1 })
    await expect(handleRejectStaleClaim({ proposal: p, proposalStore: store })).resolves.toEqual({
      kind: 'cleared',
    })
  })
})

describe('assertDecisionAllowed', () => {
  it('allows decisions on pending proposals', () => {
    expect(assertDecisionAllowed(proposal(), 'approve')).toBeNull()
    expect(assertDecisionAllowed(proposal(), 'reject')).toBeNull()
  })

  it('allows approve replayed against an already-approved proposal (idempotent)', () => {
    expect(assertDecisionAllowed(proposal({ status: 'approved' }), 'approve')).toBeNull()
  })

  it('rejects decision attempts on other terminal states', () => {
    expect(assertDecisionAllowed(proposal({ status: 'rejected' }), 'approve')).toBe('rejected')
    expect(assertDecisionAllowed(proposal({ status: 'approved' }), 'reject')).toBe('approved')
    expect(assertDecisionAllowed(proposal({ status: 'withdrawn' }), 'approve')).toBe('withdrawn')
    expect(assertDecisionAllowed(proposal({ status: 'approving' }), 'approve')).toBe('approving')
  })
})
