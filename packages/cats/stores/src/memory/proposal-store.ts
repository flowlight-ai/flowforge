/**
 * MemoryProposalStore — in-memory IProposalStore.
 *
 * Ported from clowder-ai `InMemoryProposalStore` (inside `ProposalStore.ts`).
 * F128 状态机边（review-proven）同步强制（单进程 dev/tests）；Sqlite 后端
 * 将其重写为事务性 CAS。`recordCreatedThread` 的 Stage 1.5 崩溃检查点语义保留：
 * finalize 前持久化 createdThreadId，使 stale-claim recovery 可复用已建线程。
 *
 * @module @flowforge/cats-stores/memory
 */

import {
  assertApprovalEnvelopeIdentity,
  commitApprovalEnvelope,
  generateProposalId,
  type ApprovalEnvelope,
  type ApprovalPublication,
  type ProposalApproveOverrides,
  type ThreadProposal,
} from '@flowforge/cats-shared'
import type {
  CreateThreadProposalInput,
  FinalizeApprovalInput,
  IProposalStore,
} from '../ports/proposal-store.ts'

const DEFAULT_LIST_LIMIT = 100

/** In-memory implementation for tests and single-process dev. */
export class MemoryProposalStore implements IProposalStore {
  private readonly proposals = new Map<string, ThreadProposal>()
  private readonly dedupCache = new Map<string, string>()

  create(input: CreateThreadProposalInput): ThreadProposal {
    const now = Date.now()
    const proposal: ThreadProposal = {
      proposalId: input.proposalId ?? generateProposalId(),
      status: 'pending',
      sourceThreadId: input.sourceThreadId,
      sourceInvocationId: input.sourceInvocationId,
      sourceCatId: input.sourceCatId,
      title: input.title,
      reason: input.reason,
      parentThreadId: input.parentThreadId,
      preferredCats: [...input.preferredCats],
      projectPath: input.projectPath,
      createdBy: input.createdBy,
      createdAt: now,
      publication: { state: 'staged', stagedAt: now },
    }
    if (input.sourceMessageId !== undefined) proposal.sourceMessageId = input.sourceMessageId
    if (input.initialMessage !== undefined) proposal.initialMessage = input.initialMessage
    if (input.reportingMode !== undefined) proposal.reportingMode = input.reportingMode
    this.proposals.set(proposal.proposalId, proposal)
    return clone(proposal)
  }

  get(proposalId: string): ThreadProposal | null {
    const found = this.proposals.get(proposalId)
    return found ? clone(found) : null
  }

  listPending(userId: string, limit: number = DEFAULT_LIST_LIMIT): ThreadProposal[] {
    // pending 与 approving 均属「待决」（approving 卡住时需经 stale-claim 恢复重试）。
    return this.collect((p) => p.createdBy === userId && (p.status === 'pending' || p.status === 'approving'), limit)
  }

  listByThread(threadId: string, limit: number = DEFAULT_LIST_LIMIT): ThreadProposal[] {
    return this.collect((p) => p.sourceThreadId === threadId, limit)
  }

  listSettledByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): ThreadProposal[] {
    return this.collect(
      (p) => p.createdBy === userId && (p.status === 'approved' || p.status === 'rejected'),
      limit,
      (a, b) => (b.approvedAt ?? b.rejectedAt ?? 0) - (a.approvedAt ?? a.rejectedAt ?? 0),
    )
  }

  claimForApproval(proposalId: string, approvedBy: string): ThreadProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return null
    proposal.status = 'approving'
    proposal.approvedBy = approvedBy
    proposal.claimedAt = Date.now()
    return clone(proposal)
  }

  recordCreatedThread(
    proposalId: string,
    createdThreadId: string,
    overrides?: ProposalApproveOverrides,
  ): ThreadProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'approving') return null
    proposal.createdThreadId = createdThreadId
    if (overrides) this.applyOverrides(proposal, overrides)
    return clone(proposal)
  }

  finalizeApproval(input: FinalizeApprovalInput): ThreadProposal | null {
    const proposal = this.proposals.get(input.proposalId)
    if (!proposal || proposal.status !== 'approving') return null
    proposal.status = 'approved'
    proposal.createdThreadId = input.createdThreadId
    proposal.approvedAt = Date.now()
    delete proposal.claimedAt
    if (input.overrides) this.applyOverrides(proposal, input.overrides)
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

  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): ThreadProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return null
    proposal.status = 'rejected'
    proposal.rejectedBy = rejectedBy
    proposal.rejectedAt = Date.now()
    if (rejectionReason) proposal.rejectionReason = rejectionReason
    return clone(proposal)
  }

  markWithdrawn(proposalId: string, withdrawnBy: string): ThreadProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status === 'approved' || proposal.status === 'rejected' || proposal.status === 'withdrawn') {
      return null
    }
    proposal.status = 'withdrawn'
    proposal.withdrawnBy = withdrawnBy as never
    proposal.withdrawnAt = Date.now()
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
    this.dedupCache.forEach((v, k) => {
      if (v === proposalId) this.dedupCache.delete(k)
    })
  }

  getPublication(proposalId: string): ApprovalPublication | null {
    const proposal = this.proposals.get(proposalId)
    return proposal?.publication ? structuredClone(proposal.publication) : null
  }

  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return
    assertApprovalEnvelopeIdentity(envelope, {
      canonicalProposalId: proposal.proposalId,
      sourceFeatureId: 'F128',
      ownerUserId: proposal.createdBy,
      requesterCatId: proposal.sourceCatId,
      createdAt: proposal.createdAt,
    })
    proposal.publication = commitApprovalEnvelope(proposal.publication, envelope)
  }

  abortStaged(proposalId: string, reason: string): void {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.publication?.state !== 'staged') return
    proposal.publication = { state: 'tombstoned', failedAt: Date.now(), reason }
  }

  reset(): void {
    this.proposals.clear()
    this.dedupCache.clear()
  }

  private applyOverrides(proposal: ThreadProposal, overrides: ProposalApproveOverrides): void {
    if (typeof overrides.title === 'string') proposal.title = overrides.title
    if (typeof overrides.parentThreadId === 'string') proposal.parentThreadId = overrides.parentThreadId
    if (Array.isArray(overrides.preferredCats)) proposal.preferredCats = [...overrides.preferredCats]
    if (overrides.initialMessage === null) {
      delete proposal.initialMessage
    } else if (overrides.initialMessage !== undefined) {
      proposal.initialMessage = overrides.initialMessage
    }
    if (typeof overrides.projectPath === 'string') proposal.projectPath = overrides.projectPath
    if (overrides.reportingMode !== undefined) proposal.reportingMode = overrides.reportingMode
  }

  private collect(
    predicate: (p: ThreadProposal) => boolean,
    limit: number,
    sort?: (a: ThreadProposal, b: ThreadProposal) => number,
  ): ThreadProposal[] {
    let items: ThreadProposal[] = []
    for (const p of this.proposals.values()) {
      if (predicate(p)) items.push(clone(p))
    }
    if (sort) items = items.sort(sort)
    if (limit !== Infinity && items.length > limit) items = items.slice(0, limit)
    return items
  }
}

function dedupKey(userId: string, clientRequestId: string): string {
  return `${userId}::${clientRequestId}`
}

function clone(proposal: ThreadProposal): ThreadProposal {
  return {
    ...proposal,
    preferredCats: [...proposal.preferredCats],
    ...(proposal.publication ? { publication: structuredClone(proposal.publication) } : {}),
    ...(proposal.communityPrContext ? { communityPrContext: { ...proposal.communityPrContext } } : {}),
  }
}
