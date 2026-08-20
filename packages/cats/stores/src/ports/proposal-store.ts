/**
 * IProposalStore — F128 cross-thread/cat proposal store (stage-5 batch 4).
 *
 * 从 `stub-ports.ts` 的宽松 `Record<string, unknown>` 提升为完整 branded 契约，
 * 参考批次4.2 `IProfileUpdateProposalStore` 的祖先 F128 状态机，并以
 * clowder-ai `ProposalStore.ts` / `proposal-routes.ts` / `proposal-stale-recovery.ts`
 * 语义为准：
 *
 *   pending → approving → approved   (claim → recordCreatedThread → finalize, atomic vs reject)
 *   pending → rejected               (one-shot, decision)
 *   pending → withdrawn              (requester-only, one-shot)
 *   approving → pending              (rollbackClaim on thread-creation failure)
 *   approving → approved             (stale-claim recovery: finalize against persisted thread)
 *   approving → pending              (stale-claim recovery: rollback when no thread was created)
 *
 * 关键崩溃恢复点：`recordCreatedThread` 在 finalize 前原子持久化
 * `createdThreadId`（Stage 1.5），使 `claimedAt` 超窗（STALE_APPROVING_MS）后的
 * `claimForApproval`/`finalize` 竞争可恢复，避免重复建线程。
 *
 * @module @flowforge/cats-stores/ports
 */

import type {
  ApprovalEnvelope,
  ApprovalPublication,
  CatId,
  ProposalApproveOverrides,
  ReportingMode,
  ThreadProposal,
} from '@flowforge/cats-shared'

/** Create input for an F128 thread proposal (cat-side propose). */
export interface CreateThreadProposalInput {
  sourceThreadId: string
  sourceInvocationId: string
  sourceCatId: CatId
  /** Exact trigger message id — persisted for lineage; optional for legacy callers. */
  sourceMessageId?: string
  title: string
  reason: string
  /** Defaults to sourceThreadId at create time. */
  parentThreadId: string
  preferredCats: CatId[]
  initialMessage?: string
  reportingMode?: ReportingMode
  projectPath: string
  createdBy: string
  /** Optional explicit proposalId (propose route reserves a dedup key before create). */
  proposalId?: string
}

/** Finalize input — carries the created thread id + approve-time overrides. */
export interface FinalizeApprovalInput {
  proposalId: string
  createdThreadId: string
  overrides?: ProposalApproveOverrides
}

export interface IProposalStore {
  create(input: CreateThreadProposalInput): ThreadProposal | Promise<ThreadProposal>
  get(proposalId: string): ThreadProposal | null | Promise<ThreadProposal | null>
  /** Approval Hub pending feed: user-owned proposals awaiting decision. */
  listPending(userId: string, limit?: number): ThreadProposal[] | Promise<ThreadProposal[]>
  listByThread(threadId: string, limit?: number): ThreadProposal[] | Promise<ThreadProposal[]>
  /** Approval Hub settled feed: decided proposals, sorted by decision ts desc. */
  listSettledByUser(userId: string, limit?: number): ThreadProposal[] | Promise<ThreadProposal[]>
  /** CAS pending → approving. Returns claimed snapshot, or null if not pending. */
  claimForApproval(
    proposalId: string,
    approvedBy: string,
  ): ThreadProposal | null | Promise<ThreadProposal | null>
  /**
   * Stage 1.5 crash checkpoint — persist createdThreadId on an `approving` proposal
   * WITHOUT changing status (crash-recovery idempotent). No-op if not approving.
   */
  recordCreatedThread(
    proposalId: string,
    createdThreadId: string,
    overrides?: ProposalApproveOverrides,
  ): ThreadProposal | null | Promise<ThreadProposal | null>
  /** CAS approving → approved (createdThreadId atomically committed). null if status drifted. */
  finalizeApproval(input: FinalizeApprovalInput): ThreadProposal | null | Promise<ThreadProposal | null>
  /** CAS approving → pending. Used when thread creation fails after claim. */
  rollbackClaim(proposalId: string): boolean | Promise<boolean>
  /** CAS pending → rejected. Returns null if not pending. */
  markRejected(
    proposalId: string,
    rejectedBy: string,
    rejectionReason?: string,
  ): ThreadProposal | null | Promise<ThreadProposal | null>
  /** CAS pending|approving → withdrawn (requester-only). Returns null if not allowed. */
  markWithdrawn(proposalId: string, withdrawnBy: CatId): ThreadProposal | null | Promise<ThreadProposal | null>
  /** Idempotency: cached proposalId for (userId, clientRequestId). */
  getDedupProposalId(userId: string, clientRequestId: string): string | null | Promise<string | null>
  /** Idempotency: atomically reserve (userId, clientRequestId) → proposalId. */
  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string | Promise<string>
  /** Release the dedup reservation IF it points at expectedProposalId (defensive). */
  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void | Promise<void>
  /** Visibility commit marker — set once the proposal card is appended. */
  setCardMessageId(proposalId: string, cardMessageId: string): void | Promise<void>
  /** Hard delete (cleanup after propose partial-commit). Idempotent. */
  delete(proposalId: string): void | Promise<void>
  getPublication(proposalId: string): ApprovalPublication | null | Promise<ApprovalPublication | null>
  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void | Promise<void>
  abortStaged(proposalId: string, reason: string): void | Promise<void>
}
