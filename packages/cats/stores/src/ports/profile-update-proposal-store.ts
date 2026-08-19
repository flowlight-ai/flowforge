/**
 * IProfileUpdateProposalStore — profile-update proposal port (batch 4.2a).
 *
 * Ported from clowder-ai `ProfileUpdateProposalStore.ts`
 * (api/src/domains/cats/services/stores/ports/), promoted out of
 * `stub-ports.ts` alongside its Memory implementation as the cats-profile
 * services (batch 4) landed.
 *
 * Cats propose their authenticated persona-primer update; operator
 * approves/rejects. Mirrors the F128 ProposalStore state machine
 * (review-proven edges):
 *   pending → approving → approved   (claim then finalize, atomic vs reject)
 *   pending → rejected               (one-shot)
 *   approving → pending              (rollback on write failure)
 *
 * AC-C1 additions over ThreadProposal:
 *  - P1-1 two-path crash checkpoint (recordCheckpoint persists BOTH
 *    writtenPath and provenancePath before finalize, so partial commits
 *    are recoverable).
 *  - P1-2 optimistic lock fields (baseContentHash pinned at propose; the
 *    approve pipeline re-reads + compares under a per-target lock before
 *    writing — that lock lives in ProfileApprovalService, not this store).
 *
 * Domain types (ProfileUpdateProposal / ProfileUpdateSignalProvenance /
 * ApprovalEnvelope / ApprovalPublication) come from `@flowforge/cats-shared`.
 *
 * @module @flowforge/cats-stores/ports
 */

import type {
  ApprovalEnvelope,
  ApprovalPublication,
  CatId,
  ProfileUpdateProposal,
  ProfileUpdateSignalProvenance,
  ProfileUpdateTargetLayer,
} from '@flowforge/cats-shared'

export interface CreateProfileUpdateProposalInput {
  sourceThreadId: string
  sourceInvocationId: string
  sourceCatId: CatId
  targetLayer: ProfileUpdateTargetLayer
  targetPath: string
  beforeContent: string
  baseContentHash: string
  afterContent: string
  rationale: string
  signalProvenance: ProfileUpdateSignalProvenance
  createdBy: string
  /** Optional explicit proposalId (propose route reserves a dedup key before create). */
  proposalId?: string
}

/** P1-1 partial-commit checkpoint — BOTH paths recorded before finalize. */
export interface ProfileUpdateCheckpoint {
  writtenPath?: string
  provenancePath?: string
}

export interface IProfileUpdateProposalStore {
  create(input: CreateProfileUpdateProposalInput): ProfileUpdateProposal | Promise<ProfileUpdateProposal>
  get(proposalId: string): ProfileUpdateProposal | null | Promise<ProfileUpdateProposal | null>
  listPending(userId: string, limit?: number): ProfileUpdateProposal[] | Promise<ProfileUpdateProposal[]>
  listByThread(threadId: string, limit?: number): ProfileUpdateProposal[] | Promise<ProfileUpdateProposal[]>
  /** List approved/rejected proposals for a user, sorted by decision timestamp desc (F246 Phase H). */
  listSettledByUser(userId: string, limit?: number): ProfileUpdateProposal[] | Promise<ProfileUpdateProposal[]>
  /** CAS pending → approving. Returns claimed snapshot, or null if not pending. */
  claimForApproval(
    proposalId: string,
    approvedBy: string,
  ): ProfileUpdateProposal | null | Promise<ProfileUpdateProposal | null>
  /**
   * Persist writtenPath/provenancePath on an `approving` proposal WITHOUT
   * changing status (P1-1 partial-commit checkpoint; deterministic paths →
   * retry-idempotent). No-op if not approving.
   */
  recordCheckpoint(
    proposalId: string,
    checkpoint: ProfileUpdateCheckpoint,
  ): ProfileUpdateProposal | null | Promise<ProfileUpdateProposal | null>
  /** CAS approving → approved. Returns updated proposal or null if status drifted. */
  finalizeApproval(proposalId: string): ProfileUpdateProposal | null | Promise<ProfileUpdateProposal | null>
  /** CAS approving → pending. Used when the primer write fails after claim. */
  rollbackClaim(proposalId: string): boolean | Promise<boolean>
  /** CAS pending → rejected. Returns null if not pending. */
  markRejected(
    proposalId: string,
    rejectedBy: string,
    rejectionReason?: string,
  ): ProfileUpdateProposal | null | Promise<ProfileUpdateProposal | null>
  /** Idempotency: cached proposalId for (userId, clientRequestId). */
  getDedupProposalId(userId: string, clientRequestId: string): string | null | Promise<string | null>
  /** Idempotency: atomically reserve (userId, clientRequestId) → proposalId; returns the stored value. */
  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string | Promise<string>
  /** Release the dedup reservation IF it points at expectedProposalId (defensive). */
  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void | Promise<void>
  setCardMessageId(proposalId: string, cardMessageId: string): void | Promise<void>
  /** Hard delete (cleanup after propose partial-commit). Idempotent. */
  delete(proposalId: string): void | Promise<void>
  getPublication(proposalId: string): ApprovalPublication | null | Promise<ApprovalPublication | null>
  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void | Promise<void>
  abortStaged(proposalId: string, reason: string): void | Promise<void>
}
