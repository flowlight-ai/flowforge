/**
 * MemoryDossierDistillationProposalStore — in-memory
 * IDossierDistillationProposalStore (F208 Phase E 画像蒸馏).
 *
 * Ported from clowder-ai `InMemoryDossierDistillationProposalStore`.
 * Enforces the KD-17 fail-closed rule (empty evidenceRefs → create throws),
 * sourceId idempotency, and the CAS state machine
 * pending → approved/rejected → applied.
 *
 * @module @flowforge/cats-stores/memory
 */

import {
  generateId,
  type DossierDistillationProposal,
} from '@flowforge/cats-shared'
import type {
  CreateDistillationProposalInput,
  IDossierDistillationProposalStore,
} from '../ports/dossier-distillation-proposal-store.ts'

const DEFAULT_LIST_LIMIT = 100

/** In-memory implementation for tests and single-process dev. */
export class MemoryDossierDistillationProposalStore implements IDossierDistillationProposalStore {
  private readonly proposals = new Map<string, DossierDistillationProposal>()

  create(input: CreateDistillationProposalInput): DossierDistillationProposal {
    // KD-17 FM-2: fail-closed on empty evidence.
    if (input.evidenceRefs.length === 0) {
      throw new Error('DossierDistillationProposal create failed: evidenceRefs must be non-empty (KD-17 fail-closed)')
    }
    // Idempotency: same sourceId → same proposal.
    const existing = this.getBySourceId(input.sourceId)
    if (existing) return clone(existing)

    const proposal: DossierDistillationProposal = {
      proposalId: input.proposalId ?? generateId('distill'),
      status: 'pending',
      sourceEvent: input.sourceEvent,
      sourceId: input.sourceId,
      targetCatId: input.targetCatId,
      targetFields: [...input.targetFields],
      beforeSnapshot: input.beforeSnapshot,
      afterDraft: input.afterDraft,
      rationale: input.rationale,
      evidenceRefs: input.evidenceRefs.map((ref) => ({ ...ref })),
      baseHash: input.baseHash,
      createdBy: input.createdBy,
      createdAt: Date.now(),
    }
    this.proposals.set(proposal.proposalId, proposal)
    return clone(proposal)
  }

  get(proposalId: string): DossierDistillationProposal | null {
    const found = this.proposals.get(proposalId)
    return found ? clone(found) : null
  }

  listPending(limit: number = DEFAULT_LIST_LIMIT): DossierDistillationProposal[] {
    return this.collect((p) => p.status === 'pending', limit)
  }

  listByCat(catId: DossierDistillationProposal['targetCatId'], limit: number = DEFAULT_LIST_LIMIT): DossierDistillationProposal[] {
    return this.collect((p) => p.targetCatId === catId, limit)
  }

  getBySourceId(sourceId: string): DossierDistillationProposal | null {
    for (const proposal of this.proposals.values()) {
      if (proposal.sourceId === sourceId) return clone(proposal)
    }
    return null
  }

  markApproved(proposalId: string, approvedBy: string): DossierDistillationProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return null
    proposal.status = 'approved'
    proposal.approvedBy = approvedBy
    proposal.approvedAt = Date.now()
    return clone(proposal)
  }

  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): DossierDistillationProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'pending') return null
    proposal.status = 'rejected'
    proposal.rejectedBy = rejectedBy
    proposal.rejectedAt = Date.now()
    if (rejectionReason) proposal.rejectionReason = rejectionReason
    return clone(proposal)
  }

  markApplied(proposalId: string, appliedBy: string, commitSha: string): DossierDistillationProposal | null {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.status !== 'approved') return null
    proposal.status = 'applied'
    proposal.appliedBy = appliedBy
    proposal.appliedAt = Date.now()
    proposal.appliedCommitSha = commitSha
    return clone(proposal)
  }

  private collect(
    predicate: (p: DossierDistillationProposal) => boolean,
    limit: number,
  ): DossierDistillationProposal[] {
    const result: DossierDistillationProposal[] = []
    for (const proposal of this.proposals.values()) {
      if (predicate(proposal)) result.push(clone(proposal))
    }
    // Newest first.
    result.sort((a, b) => b.createdAt - a.createdAt)
    return result.slice(0, Math.max(0, limit))
  }
}

function clone(proposal: DossierDistillationProposal): DossierDistillationProposal {
  return {
    ...proposal,
    targetFields: [...proposal.targetFields],
    evidenceRefs: proposal.evidenceRefs.map((ref) => ({ ...ref })),
  }
}
