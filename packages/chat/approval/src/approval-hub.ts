/**
 * approval-hub — Approval Hub 聚合投影（阶段5 批次4）。
 *
 * 移植 clowder-ai `approval-hub-routes.ts`：聚合各 producer 的 pending / settled
 * 提案，统一 DTO（ApprovalItem / SettledApprovalItem），按 createdAt/decidedAt
 * 倒序，可限流。本模块面向 F128 单 producer；扩展 producer 通过 adapter 注入。
 *
 * @module @flowforge/chat-approval/approval-hub
 */

import type { ThreadProposal } from '@flowforge/cats-shared'
import { PROPOSAL_STATUS_META } from './proposal-card.ts'

export type ApprovalItemStatus = 'pending' | 'stale'

/** 统一待办审批 DTO（对齐 clowder-ai ApprovalItem）。 */
export interface ApprovalItem {
  readonly proposalId: string
  readonly status: ApprovalItemStatus
  readonly title: string
  readonly reason: string
  readonly sourceThreadId: string
  readonly sourceCatId: string
  readonly createdAt: number
  readonly projectPath: string
  readonly preferredCats: readonly string[]
}

/** 统一已决 DTO（对齐 clowder-ai SettledApprovalItem）。 */
export interface SettledApprovalItem {
  readonly proposalId: string
  readonly status: 'approved' | 'rejected' | 'withdrawn'
  readonly title: string
  readonly decidedAt: number
  readonly decisionBy: string
  readonly createdThreadId?: string
}

/** pending/stale 状态映射：approving 且超过 stale 阈值 → stale。 */
export function mapApprovalItemStatus(_proposal: ThreadProposal, isStale: boolean): ApprovalItemStatus {
  if (isStale) return 'stale'
  return 'pending'
}

/** 将 pending proposal 投影为 ApprovalItem。 */
export function toApprovalItem(proposal: ThreadProposal, isStale: boolean = false): ApprovalItem {
  return {
    proposalId: proposal.proposalId,
    status: mapApprovalItemStatus(proposal, isStale),
    title: proposal.title,
    reason: proposal.reason,
    sourceThreadId: proposal.sourceThreadId,
    sourceCatId: proposal.sourceCatId,
    createdAt: proposal.createdAt,
    projectPath: proposal.projectPath,
    preferredCats: [...proposal.preferredCats],
  }
}

/** 将已决 proposal 投影为 SettledApprovalItem。 */
export function toSettledApprovalItem(proposal: ThreadProposal): SettledApprovalItem | null {
  const decidedAt = proposal.approvedAt ?? proposal.rejectedAt ?? proposal.withdrawnAt
  const decisionBy = proposal.approvedBy ?? proposal.rejectedBy ?? proposal.withdrawnBy ?? ''
  if (proposal.status === 'approved' || proposal.status === 'rejected' || proposal.status === 'withdrawn') {
    if (decidedAt === undefined || decisionBy === '') return null
    return {
      proposalId: proposal.proposalId,
      status: proposal.status,
      title: proposal.title,
      decidedAt,
      decisionBy,
      ...(proposal.createdThreadId ? { createdThreadId: proposal.createdThreadId } : {}),
    }
  }
  return null
}

/** 合并 pending 列表按 createdAt 倒序（对齐 clowder-ai merge + sort desc）。 */
export function mergePending(items: readonly ApprovalItem[], limit: number = 50): ApprovalItem[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

/** 合并 settled 列表按 decidedAt 倒序。 */
export function mergeSettled(items: readonly SettledApprovalItem[], limit: number = 50): SettledApprovalItem[] {
  return [...items].sort((a, b) => b.decidedAt - a.decidedAt).slice(0, limit)
}

/** 状态中文标签（供 UI 兜底）。 */
export function approvalStatusLabel(status: ThreadProposal['status']): string {
  return PROPOSAL_STATUS_META[status].label
}
