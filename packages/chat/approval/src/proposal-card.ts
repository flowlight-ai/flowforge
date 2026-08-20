/**
 * proposal-card — F128 提案卡片/enrich-header 纯函数（阶段5 批次4）。
 *
 * 移植 clowder-ai `person-memory-proposal-card.ts` 的展示面语义，但泛化为
 * F128 thread-proposal 卡片：构建富卡片块、状态映射与「去审批」动作。
 * 纯函数，无 I/O，供 ProposalService 与路由层复用。
 *
 * @module @flowforge/chat-approval/proposal-card
 */

import type { ProposalStatus, ThreadProposal } from '@flowforge/cats-shared'

export interface ProposalCardBlock {
  readonly id: string
  readonly kind: 'card'
  readonly v: 1
  readonly title: string
  readonly bodyMarkdown: string
  readonly tone: 'info' | 'success' | 'warning' | 'error'
  readonly fields?: readonly { readonly label: string; readonly value: string }[]
  readonly actions?: readonly { readonly label: string; readonly actionId: string }[]
}

export const PROPOSAL_STATUS_META: Readonly<Record<ProposalStatus, { label: string; tone: ProposalCardBlock['tone'] }>> = {
  pending: { label: '待审批', tone: 'info' },
  approving: { label: '审批中', tone: 'warning' },
  approved: { label: '已批准', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'error' },
  withdrawn: { label: '已撤回', tone: 'warning' },
}

/** 状态 → 卡片 tone 映射（对齐 clowder-ai 状态映射）。 */
export function proposalCardTone(status: ProposalStatus): ProposalCardBlock['tone'] {
  return PROPOSAL_STATUS_META[status].tone
}

/** 决策面标记：当前仅 approval_hub。 */
export type DecisionSurface = 'approval_hub'

/** 构造审批卡片（approvalCardRef 由调用方注入）。 */
export function buildProposalCard(proposal: ThreadProposal, surface: DecisionSurface = 'approval_hub'): ProposalCardBlock {
  const meta = PROPOSAL_STATUS_META[proposal.status]
  const preferred = proposal.preferredCats.length > 0 ? proposal.preferredCats.join(', ') : '（未指定）'
  const actions =
    proposal.status === 'pending' ? [{ label: '去审批', actionId: 'open_approval_hub' }] : undefined
  return {
    id: `proposal-card-${proposal.proposalId}`,
    kind: 'card',
    v: 1,
    title: `提案：${proposal.title}`,
    bodyMarkdown:
      `${proposal.reason}\n\n` +
      `状态：**${meta.label}** · 决策面：${surface}\n` +
      `来源线程：${proposal.sourceThreadId} · 提议灵智体：${proposal.sourceCatId}`,
    tone: meta.tone,
    fields: [
      { label: '标题', value: proposal.title },
      { label: '理由', value: proposal.reason },
      { label: '优先灵智体', value: preferred },
      { label: '项目路径', value: proposal.projectPath },
    ],
    ...(actions ? { actions } : {}),
  }
}

/** enrich-header：为既有卡片补充审批相关 header 字段（source/invocation 溯源）。 */
export function enrichHeader(proposal: ThreadProposal, base: { title?: string; surface?: DecisionSurface } = {}): {
  readonly proposalId: string
  readonly title: string
  readonly surface: DecisionSurface
  readonly status: ProposalStatus
  readonly sourceThreadId: string
  readonly sourceInvocationId: string
  readonly sourceCatId: string
  readonly createdAt: number
} {
  return {
    proposalId: proposal.proposalId,
    title: base.title ?? proposal.title,
    surface: base.surface ?? 'approval_hub',
    status: proposal.status,
    sourceThreadId: proposal.sourceThreadId,
    sourceInvocationId: proposal.sourceInvocationId,
    sourceCatId: proposal.sourceCatId,
    createdAt: proposal.createdAt,
  }
}
