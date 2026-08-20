/**
 * @flowforge/chat-approval — chat approval/proposal/vote Cordis plugin (stage-5 batch 4).
 *
 * Mounts `ChatApprovalService` at `ctx.chatApproval`:
 * - 提案面（F128）：createProposal / listPending / listSettled / approve / reject /
 *   withdraw + stale-claim 崩溃恢复（Stage 1.5 crash checkpoint）
 * - 投票面（F079）：voteStart / voteCast / voteClose / voteStatus（匿名表决、
 *   指定投票人自动关闭、deadline 约束）
 * - Approval Hub：hubPending / hubSettled 聚合投影
 *
 * 存储经 `ctx.catStores.proposals()/votes()` 解析；realtime 广播为可选依赖
 * （`ctx.chatRealtime` 未装载时事件面广播静默降级）。
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'
 * - name: '@flowforge/chat-approval'
 * # optional collaborators (lazy-resolved at broadcast time):
 * - name: '@flowforge/chat-realtime'
 * ```
 *
 * @module @flowforge/chat-approval
 */

import type { Context } from '@flowforge/cordis'
import { ChatApprovalService } from './proposal-service.ts'

export { ChatApprovalError, ChatApprovalService, ProposalErrorCode } from './proposal-service.ts'
export type {
  ApproveProposalInput,
  ApproveProposalResult,
  ProposeThreadInput,
  RejectProposalInput,
  VoteCastInput,
  VoteStartInput,
} from './proposal-service.ts'

export {
  CANNOT_APPROVE_NON_PENDING,
  CANNOT_REJECT_APPROVED_THREAD,
  EVENT_PROPOSAL_UPDATED,
  EVENT_VOTE_CLOSED,
  EVENT_VOTE_STARTED,
  STALE_APPROVING_MS,
  VOTE_OPTION_MAX,
  VOTE_OPTION_MAX_COUNT,
  VOTE_OPTION_MIN,
  VOTE_QUESTION_MAX,
  VOTE_TIMEOUT_DEFAULT_SEC,
  VOTE_TIMEOUT_MAX_SEC,
  VOTE_TIMEOUT_MIN_SEC,
  VOTE_VOTERS_MAX,
  VOTE_VOTERS_MIN,
} from './invariant.ts'

export {
  assertDecisionAllowed,
  claimAgeMs,
  handleApproveStaleClaim,
  handleRejectStaleClaim,
  isStaleClaim,
} from './stale-recovery.ts'
export type { ApproveStaleRecoveryOutcome, RejectStaleRecoveryOutcome, StaleRecoveryDeps } from './stale-recovery.ts'

export {
  buildVoteNotification,
  buildVoteTally,
  checkVoteCompletion,
  extractVoteFromText,
  listVoters,
  VOTE_RESULT_SOURCE,
} from './votes.ts'

export {
  approvalStatusLabel,
  mergePending,
  mergeSettled,
  toApprovalItem,
  toSettledApprovalItem,
} from './approval-hub.ts'
export type { ApprovalItem, ApprovalItemStatus, SettledApprovalItem } from './approval-hub.ts'

export {
  buildProposalCard,
  enrichHeader,
  PROPOSAL_STATUS_META,
  proposalCardTone,
} from './proposal-card.ts'
export type { DecisionSurface, ProposalCardBlock } from './proposal-card.ts'

export default function Plugin(ctx: Context) {
  ctx.plugin(ChatApprovalService)
}
