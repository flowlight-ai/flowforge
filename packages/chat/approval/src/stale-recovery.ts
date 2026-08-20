/**
 * F128 stale-claim recovery — 审批卡住恢复纯编排（阶段5 批次4）。
 *
 * 移植自 clowder-ai `proposal-stale-recovery.ts`。当 proposal 处于 `approving`
 * 超过 STALE_APPROVING_MS 时，判定上一个 claimer 在 claim 与 finalize/rollback
 * 之间崩溃。两条恢复路径由 `createdThreadId` 是否已持久化（Stage 1.5）决定：
 *  - 已建线程 → 对该线程 finalize（不重复建线程）
 *  - 未建线程 → 回滚 claim 让调用方重试
 *
 * @module @flowforge/chat-approval/stale-recovery
 */

import type { ProposalStatus, ThreadProposal } from '@flowforge/cats-shared'
import type { IProposalStore } from '@flowforge/cats-stores'
import { STALE_APPROVING_MS } from './invariant.ts'

export type ApproveStaleRecoveryOutcome =
  | { kind: 'in_flight'; status: 409 }
  | { kind: 'recovered'; threadId: string; status: 'approved' }
  | { kind: 'race_retry' }
  | { kind: 'cleared' }

export interface StaleRecoveryDeps {
  proposalStore: Pick<IProposalStore, 'get' | 'finalizeApproval' | 'rollbackClaim'>
  /** 恢复成功后的额外协调回调（如 community-PR 过渡），返回 warnings。 */
  reconcileRecoveredProposal?: (proposal: ThreadProposal, threadId: string) => Promise<string[]>
}

/**
 * 计算 `approving` claim 的年龄（毫秒）。无 claimedAt 视为无限旧。
 */
export function claimAgeMs(proposal: ThreadProposal, now: number = Date.now()): number {
  return proposal.claimedAt ? now - proposal.claimedAt : Number.POSITIVE_INFINITY
}

/** 判定 stale claim：超过阈值即视为崩溃。 */
export function isStaleClaim(proposal: ThreadProposal, now: number = Date.now()): boolean {
  return proposal.status === 'approving' && claimAgeMs(proposal, now) > STALE_APPROVING_MS
}

/**
 * Approve 路径的 stale 处理。返回调用方下一步信号：
 *  - `in_flight`: 仍在 stale 窗口内 — 调用方应返回 409
 *  - `recovered`: 已对既有线程 finalize — 调用方应返回恢复 body
 *  - `race_retry`: 另一写入者竞争获胜 — 调用方应返回 409
 *  - `cleared`: 状态非 approving 或回滚成功 — 调用方继续常规流程
 */
export async function handleApproveStaleClaim(args: {
  proposal: ThreadProposal
  proposalStore: Pick<IProposalStore, 'finalizeApproval' | 'rollbackClaim'>
  reconcileRecoveredProposal?: (proposal: ThreadProposal, threadId: string) => Promise<string[]>
}): Promise<ApproveStaleRecoveryOutcome> {
  const { proposal, proposalStore } = args
  if (proposal.status !== 'approving') return { kind: 'cleared' }

  const ageMs = claimAgeMs(proposal)
  if (ageMs <= STALE_APPROVING_MS) return { kind: 'in_flight', status: 409 }

  if (proposal.createdThreadId) {
    const recovered = await proposalStore.finalizeApproval({
      proposalId: proposal.proposalId,
      createdThreadId: proposal.createdThreadId,
    })
    if (!recovered) return { kind: 'race_retry' }
    const warnings = args.reconcileRecoveredProposal
      ? await args.reconcileRecoveredProposal(recovered, proposal.createdThreadId)
      : []
    void warnings
    return { kind: 'recovered', threadId: proposal.createdThreadId, status: 'approved' }
  }

  // 未建线程 — 安全回滚以便调用方重新 claim。
  await proposalStore.rollbackClaim(proposal.proposalId)
  return { kind: 'cleared' }
}

export type RejectStaleRecoveryOutcome =
  | { kind: 'cleared' }
  | { kind: 'in_flight'; status: 409 }
  | { kind: 'cannot_reject'; status: 409 }

/**
 * Reject 路径的 stale 处理。与 approve 相同的年龄检查 + createdThreadId 分叉，
 * 但若线程已存在则拒绝非法 —— finalize 该孤儿 claim 并返回 cannot_reject。
 */
export async function handleRejectStaleClaim(args: {
  proposal: ThreadProposal
  proposalStore: Pick<IProposalStore, 'finalizeApproval' | 'rollbackClaim'>
}): Promise<RejectStaleRecoveryOutcome> {
  const { proposal, proposalStore } = args
  if (proposal.status !== 'approving') return { kind: 'cleared' }

  const ageMs = claimAgeMs(proposal)
  if (ageMs <= STALE_APPROVING_MS) return { kind: 'in_flight', status: 409 }

  if (proposal.createdThreadId) {
    const recovered = await proposalStore.finalizeApproval({
      proposalId: proposal.proposalId,
      createdThreadId: proposal.createdThreadId,
    })
    void recovered
    return { kind: 'cannot_reject', status: 409 }
  }

  await proposalStore.rollbackClaim(proposal.proposalId)
  return { kind: 'cleared' }
}

/** 终态校验（对齐 clowder-ai proposal-terminal-conflict）：approve/reject 仅限 pending。 */
export function assertDecisionAllowed(proposal: ThreadProposal, action: 'approve' | 'reject'): ProposalStatus | null {
  if (proposal.status === 'pending') return null
  if (action === 'approve' && proposal.status === 'approved') return null // 幂等重放
  return proposal.status
}
