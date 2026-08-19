/**
 * MemoryProfileUpdateProposalStore — in-memory IProfileUpdateProposalStore.
 *
 * Ported from clowder-ai `InMemoryProfileUpdateProposalStore` (inside
 * `ProfileUpdateProposalStore.ts`). Review-proven state machine edges are
 * enforced synchronously (single-process dev / tests); the Sqlite backend
 * (batch 2.4, separate package) re-expresses them as transactional CAS.
 *
 * @module @flowforge/cats-stores/memory
 */

import {
  assertApprovalEnvelopeIdentity,
  commitApprovalEnvelope,
  generateProposalId,
  type ApprovalEnvelope,
  type ApprovalPublication,
  type ProfileUpdateProposal,
} from '@flowforge/cats-shared'
import type {
  CreateProfileUpdateProposalInput,
  IProfileUpdateProposalStore,
  ProfileUpdateCheckpoint,
} from '../ports/profile-update-proposal-store.ts'

const DEFAULT_LIST_LIMIT = 100

/** In-memory implementation for tests and single-process dev. */
export class MemoryProfileUpdateProposalStore implements IProfileUpdateProposalStore {
  private readonly proposals = new Map<string, ProfileUpdateProposal>()
  private readonly dedupCache = new Map<string, string>()

  create(input: CreateProfileUpdateProposalInput): ProfileUpdateProposal {
    const now = Date.now()
    const proposal: ProfileUpdateProposal = {
      proposalId: input.proposalId ?? generateProposalId(),
      status: 'pending',
      sourceThreadId: input.sourceThreadId,
      sourceInvocationId: input.sourceInvocationId,
      sourceCatId: input.sourceCatId,
      targetLayer: input.targetLayer,
      targetPath: input.targetPath,
      beforeContent: input.beforeContent,
      baseContentHash: input.baseContentHash,
      afterContent: input.afterContent,
      rationale: input.rationale,
      signalProvenance: { ...input.signalProvenance },
      createdBy: input.createdBy,
      createdAt: now,
      publication: { state: 'staged', stagedAt: now },
    }
    this.proposals.set(proposal.proposalId, proposal)
    return clone(proposal)
  }

  get(proposalId: string): ProfileUpdateProposal | null {
    const found = this.proposals.get(proposalId)
    return found ? clone(found) : null
  }

  listPending(userId: string, limit: number = DEFAULT_LIST_LIMIT): ProfileUpdateProposal[] {
    return this.collect((p) => p.createdBy === userId && p.status === 'pending', limit)
  }

  listByThread(threadId: string, limit: number = DEFAULT_LIST_LIMIT): ProfileUpdateProposal[] {
    return this.collect((p) => p.sourceThreadId === threadId, limit)
  }

  listSettledByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): ProfileUpdateProposal[] {
    return this.collect(
      (p) => p.createdBy === userId && (p.status === 'approved' || p.status === 'rejected'),
      limit,
      // Sort by decision timestamp descending (approvedAt || rejectedAt)
      (a, b) => (b.approvedAt ?? b.rejectedAt ?? 0) - (a.approvedAt ?? a.rejectedAt ?? 0),
    )
  }

  claimForApproval(proposalId: string, approvedBy: string): ProfileUpdateProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return null
    proposal.status = 'approving'
    proposal.approvedBy = approvedBy
    proposal.claimedAt = Date.now()
    return clone(proposal)
  }

  recordCheckpoint(proposalId: string, checkpoint: ProfileUpdateCheckpoint): ProfileUpdateProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'approving') return null
    if (checkpoint.writtenPath !== undefined) proposal.writtenPath = checkpoint.writtenPath
    if (checkpoint.provenancePath !== undefined) proposal.provenancePath = checkpoint.provenancePath
    return clone(proposal)
  }

  finalizeApproval(proposalId: string): ProfileUpdateProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'approving') return null
    proposal.status = 'approved'
    proposal.approvedAt = Date.now()
    delete proposal.claimedAt
    return clone(proposal)
  }

  rollbackClaim(proposalId: string): boolean {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'approving') return false
    proposal.status = 'pending'
    delete proposal.approvedBy
    delete proposal.claimedAt
    return true
  }

  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): ProfileUpdateProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return null
    proposal.status = 'rejected'
    proposal.rejectedBy = rejectedBy
    proposal.rejectedAt = Date.now()
    if (rejectionReason) proposal.rejectionReason = rejectionReason
    return clone(proposal)
  }

  getDedupProposalId(userId: string, clientRequestId: string): string | null {
    return this.dedupCache.get(dedupKey(userId, clientRequestId)) ?? null
  }

  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string {
    const key = dedupKey(userId, clientRequestId)
    const existing = this.dedupCache.get(key)
    if (existing !== undefined) return existing
    this.dedupCache.set(key, proposalId)
    return proposalId
  }

  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void {
    const key = dedupKey(userId, clientRequestId)
    if (this.dedupCache.get(key) === expectedProposalId) this.dedupCache.delete(key)
  }

  setCardMessageId(proposalId: string, cardMessageId: string): void {
    const proposal = this.proposals.get(proposalId)
    if (proposal) proposal.cardMessageId = cardMessageId
  }

  delete(proposalId: string): void {
    this.proposals.delete(proposalId)
  }

  getPublication(proposalId: string): ApprovalPublication | null {
    return this.proposals.get(proposalId)?.publication ?? null
  }

  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`proposal not found: ${proposalId}`)
    assertApprovalEnvelopeIdentity(envelope, {
      canonicalProposalId: proposal.proposalId,
      sourceFeatureId: 'F231',
      ownerUserId: proposal.createdBy,
      requesterCatId: proposal.sourceCatId,
      createdAt: proposal.createdAt,
    })
    proposal.publication = commitApprovalEnvelope(proposal.publication, envelope)
    proposal.cardMessageId = envelope.approvalCardRef.messageId
  }

  abortStaged(proposalId: string, _reason: string): void {
    const proposal = this.proposals.get(proposalId)
    if (proposal?.publication?.state === 'staged') this.delete(proposalId)
  }

  private collect(
    predicate: (p: ProfileUpdateProposal) => boolean,
    limit: number,
    sort: (a: ProfileUpdateProposal, b: ProfileUpdateProposal) => number = (a, b) => b.createdAt - a.createdAt,
  ): ProfileUpdateProposal[] {
    const result: ProfileUpdateProposal[] = []
    for (const proposal of this.proposals.values()) {
      if (predicate(proposal)) result.push(clone(proposal))
    }
    result.sort(sort)
    return result.slice(0, Math.max(0, limit))
  }
}

function dedupKey(userId: string, clientRequestId: string): string {
  return `${userId}::${clientRequestId}`
}

function clone(proposal: ProfileUpdateProposal): ProfileUpdateProposal {
  return {
    ...proposal,
    signalProvenance: { ...proposal.signalProvenance },
    ...(proposal.publication ? { publication: structuredClone(proposal.publication) } : {}),
  }
}
