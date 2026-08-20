/**
 * approval-hub — Approval Hub 聚合投影 + proposal-card 纯函数契约验证
 * （阶段5 批次4，T5.6.3）。
 *
 * 覆盖：
 * - toApprovalItem / mapApprovalItemStatus：pending ↔ stale 标记
 * - toSettledApprovalItem：approved/rejected/withdrawn 已决投影；非终态 null
 * - mergePending / mergeSettled：倒序 + 限流
 * - buildProposalCard / enrichHeader：F128 富卡片与 header 溯源字段
 * - PROPOSAL_STATUS_META / proposalCardTone：状态 → label/tone 映射
 *
 * @module @flowforge/chat-approval/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId, createThreadId, createUserId } from '@flowforge/cats-shared'
import type { ThreadProposal } from '@flowforge/cats-shared'
import {
  approvalStatusLabel,
  buildProposalCard,
  enrichHeader,
  mergePending,
  mergeSettled,
  PROPOSAL_STATUS_META,
  proposalCardTone,
  toApprovalItem,
  toSettledApprovalItem,
} from '../src/index.ts'
import type { ApprovalItem, SettledApprovalItem } from '../src/index.ts'

const USER = createUserId('alice')
const CAT = createCatId('cat_a')
const T1 = createThreadId('t1')

function proposal(overrides: Partial<ThreadProposal> = {}): ThreadProposal {
  return {
    proposalId: 'proposal_1',
    status: 'pending',
    sourceThreadId: T1,
    sourceInvocationId: 'inv_1',
    sourceCatId: CAT,
    title: '提案',
    reason: 'reason',
    parentThreadId: T1,
    preferredCats: [CAT],
    projectPath: '/w',
    createdBy: USER,
    createdAt: 1000,
    ...overrides,
  }
}

describe('toApprovalItem / mapApprovalItemStatus', () => {
  it('projects a pending proposal with a pending status', () => {
    const item = toApprovalItem(proposal(), false)
    expect(item).toMatchObject<Partial<ApprovalItem>>({
      proposalId: 'proposal_1',
      status: 'pending',
      title: '提案',
      sourceCatId: CAT,
      createdAt: 1000,
      projectPath: '/w',
      preferredCats: [CAT],
    })
  })

  it('flags approving proposals past the stale threshold as stale', () => {
    const item = toApprovalItem(proposal({ status: 'approving' }), true)
    expect(item.status).toBe('stale')
  })
})

describe('toSettledApprovalItem', () => {
  it('projects an approved proposal with createdThreadId', () => {
    const item = toSettledApprovalItem(
      proposal({ status: 'approved', approvedBy: USER, approvedAt: 2000, createdThreadId: 't_new' }),
    )
    expect(item).toMatchObject<Partial<SettledApprovalItem>>({
      proposalId: 'proposal_1',
      status: 'approved',
      decidedAt: 2000,
      decisionBy: USER,
      createdThreadId: 't_new',
    })
  })

  it('projects rejected and withdrawn proposals', () => {
    expect(toSettledApprovalItem(proposal({ status: 'rejected', rejectedBy: USER, rejectedAt: 3000 }))?.status).toBe(
      'rejected',
    )
    expect(toSettledApprovalItem(proposal({ status: 'withdrawn', withdrawnBy: CAT, withdrawnAt: 4000 }))?.status).toBe(
      'withdrawn',
    )
  })

  it('returns null for non-terminal or incomplete decisions', () => {
    expect(toSettledApprovalItem(proposal())).toBeNull()
    expect(toSettledApprovalItem(proposal({ status: 'approved' }))).toBeNull() // 缺 decidedAt/decisionBy
  })
})

describe('mergePending / mergeSettled', () => {
  it('sorts pending by createdAt descending and enforces the limit', () => {
    const a = toApprovalItem(proposal({ proposalId: 'a', createdAt: 100 }))
    const b = toApprovalItem(proposal({ proposalId: 'b', createdAt: 300 }))
    const c = toApprovalItem(proposal({ proposalId: 'c', createdAt: 200 }))
    expect(mergePending([a, b, c]).map((i) => i.proposalId)).toEqual(['b', 'c', 'a'])
    expect(mergePending([a, b, c], 2)).toHaveLength(2)
  })

  it('sorts settled by decidedAt descending', () => {
    const a = toSettledApprovalItem(proposal({ status: 'approved', approvedBy: USER, approvedAt: 100 }))!
    const b = toSettledApprovalItem(proposal({ status: 'rejected', rejectedBy: USER, rejectedAt: 300 }))!
    expect(mergeSettled([a, b]).map((i) => i.status)).toEqual(['rejected', 'approved'])
  })
})

describe('proposal-card', () => {
  it('maps every status to a label + tone', () => {
    expect(PROPOSAL_STATUS_META.pending.label).toBe('待审批')
    expect(PROPOSAL_STATUS_META.approved.tone).toBe('success')
    expect(PROPOSAL_STATUS_META.rejected.tone).toBe('error')
    expect(proposalCardTone('approving')).toBe('warning')
    expect(approvalStatusLabel('withdrawn')).toBe('已撤回')
  })

  it('builds a card with 去审批 action only for pending proposals', () => {
    const pending = buildProposalCard(proposal())
    expect(pending.kind).toBe('card')
    expect(pending.actions).toEqual([{ label: '去审批', actionId: 'open_approval_hub' }])
    expect(pending.tone).toBe('info')

    const decided = buildProposalCard(proposal({ status: 'approved' }))
    expect(decided.actions).toBeUndefined()
    expect(decided.tone).toBe('success')
  })

  it('enriches a header with proposal lineage fields', () => {
    const header = enrichHeader(proposal({ status: 'approved' }), { title: '别名' })
    expect(header).toMatchObject({
      proposalId: 'proposal_1',
      title: '别名',
      surface: 'approval_hub',
      status: 'approved',
      sourceThreadId: T1,
      sourceInvocationId: 'inv_1',
      sourceCatId: CAT,
      createdAt: 1000,
    })
  })
})
