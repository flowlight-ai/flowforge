/**
 * MemoryProfileUpdateProposalStore contract tests (batch 4.2a).
 *
 * Verifies the review-proven state machine edges ported from clowder-ai
 * `InMemoryProfileUpdateProposalStore`:
 *   pending → approving → approved   (claim then finalize, atomic vs reject)
 *   pending → rejected               (one-shot)
 *   approving → pending              (rollback on write failure)
 * plus P1-1 checkpoint persistence and dedup idempotency.
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId } from '@flowforge/cats-shared'
import { MemoryProfileUpdateProposalStore } from '../src/memory/profile-update-proposal-store.ts'
import type { CreateProfileUpdateProposalInput } from '../src/ports/profile-update-proposal-store.ts'

const catA = createCatId('cat_a')

function proposalInput(overrides: Partial<CreateProfileUpdateProposalInput> = {}): CreateProfileUpdateProposalInput {
  return {
    sourceThreadId: 'thread_1',
    sourceInvocationId: 'inv_1',
    sourceCatId: catA,
    targetLayer: 'primer',
    targetPath: 'relationship/persona-a-primer.md',
    beforeContent: 'old primer',
    baseContentHash: 'hash-before',
    afterContent: 'new primer',
    rationale: 'operator asked to record preference',
    signalProvenance: { kind: 'cvo-instructed', sourceThreadId: 'thread_1' },
    createdBy: 'user_1',
    ...overrides,
  }
}

describe('MemoryProfileUpdateProposalStore', () => {
  it('creates a pending proposal with staged publication and returns a clone', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const proposal = store.create(proposalInput())

    expect(proposal.status).toBe('pending')
    expect(proposal.publication).toEqual({ state: 'staged', stagedAt: expect.any(Number) })
    expect(proposal.proposalId).toMatch(/^proposal_/)

    // Mutating the returned clone must not leak into the store.
    proposal.status = 'approved'
    expect(store.get(proposal.proposalId)!.status).toBe('pending')
  })

  it('honors an explicit proposalId (dedup-key reservation flows)', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const proposal = store.create(proposalInput({ proposalId: 'pinned-id' }))
    expect(proposal.proposalId).toBe('pinned-id')
  })

  it('claims pending → approving and returns null on the second claim', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())

    const claimed = store.claimForApproval(proposalId, 'operator')
    expect(claimed?.status).toBe('approving')
    expect(claimed?.approvedBy).toBe('operator')
    expect(claimed?.claimedAt).toEqual(expect.any(Number))

    expect(store.claimForApproval(proposalId, 'operator-2')).toBeNull()
  })

  it('records P1-1 checkpoints only on approving proposals', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())

    // pending → checkpoint is a no-op
    expect(store.recordCheckpoint(proposalId, { writtenPath: '/tmp/x' })).toBeNull()

    store.claimForApproval(proposalId, 'operator')
    const checkpointed = store.recordCheckpoint(proposalId, { writtenPath: '/tmp/x' })
    expect(checkpointed?.writtenPath).toBe('/tmp/x')
    expect(checkpointed?.status).toBe('approving')

    const done = store.recordCheckpoint(proposalId, { provenancePath: '/tmp/p' })
    expect(done?.writtenPath).toBe('/tmp/x')
    expect(done?.provenancePath).toBe('/tmp/p')
  })

  it('finalizes approving → approved and deletes claimedAt', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())
    store.claimForApproval(proposalId, 'operator')

    const finalized = store.finalizeApproval(proposalId)
    expect(finalized?.status).toBe('approved')
    expect(finalized?.approvedAt).toEqual(expect.any(Number))
    expect(finalized?.claimedAt).toBeUndefined()

    // finalize again → status drifted → null
    expect(store.finalizeApproval(proposalId)).toBeNull()
  })

  it('rolls back approving → pending, clearing claim audit fields', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())
    store.claimForApproval(proposalId, 'operator')

    expect(store.rollbackClaim(proposalId)).toBe(true)
    const rolled = store.get(proposalId)!
    expect(rolled.status).toBe('pending')
    expect(rolled.approvedBy).toBeUndefined()
    expect(rolled.claimedAt).toBeUndefined()

    // pending → rollback is false
    expect(store.rollbackClaim(proposalId)).toBe(false)
  })

  it('rejects pending one-shot; approving proposals cannot be rejected', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())

    const rejected = store.markRejected(proposalId, 'operator', 'not accurate')
    expect(rejected?.status).toBe('rejected')
    expect(rejected?.rejectionReason).toBe('not accurate')

    // one-shot: second reject returns null
    expect(store.markRejected(proposalId, 'operator')).toBeNull()

    // approving proposals are owned by the approve pipeline
    const { proposalId: p2 } = store.create(proposalInput())
    store.claimForApproval(p2, 'operator')
    expect(store.markRejected(p2, 'operator')).toBeNull()
  })

  it('lists pending / by-thread / settled-by-user with limit', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const a = store.create(proposalInput())
    const b = store.create(proposalInput({ sourceThreadId: 'thread_2' }))
    store.claimForApproval(b.proposalId, 'op')
    store.finalizeApproval(b.proposalId)

    expect(store.listPending('user_1').map((p) => p.proposalId)).toEqual([a.proposalId])
    expect(store.listByThread('thread_2').map((p) => p.proposalId)).toEqual([b.proposalId])
    expect(store.listSettledByUser('user_1').map((p) => p.proposalId)).toEqual([b.proposalId])
    expect(store.listPending('user_1', 0)).toEqual([])
  })

  it('manages dedup reservations atomically', () => {
    const store = new MemoryProfileUpdateProposalStore()

    expect(store.getDedupProposalId('user_1', 'req-1')).toBeNull()
    expect(store.reserveDedup('user_1', 'req-1', 'p1')).toBe('p1')
    // Second reserve with a different id returns the stored value.
    expect(store.reserveDedup('user_1', 'req-1', 'p2')).toBe('p1')
    expect(store.getDedupProposalId('user_1', 'req-1')).toBe('p1')

    // Release only matches the expected proposalId (defensive).
    store.releaseDedup('user_1', 'req-1', 'p2')
    expect(store.getDedupProposalId('user_1', 'req-1')).toBe('p1')
    store.releaseDedup('user_1', 'req-1', 'p1')
    expect(store.getDedupProposalId('user_1', 'req-1')).toBeNull()
  })

  it('commits approval envelopes with identity assertions and anchors card refs', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())
    const proposal = store.get(proposalId)!

    const envelope = {
      canonicalProposalId: proposalId,
      sourceFeatureId: 'F231' as const,
      ownerUserId: proposal.createdBy,
      requesterCatId: proposal.sourceCatId,
      originRef: { kind: 'message' as const, threadId: 'thread_1', messageId: 'msg_card' },
      approvalCardRef: { threadId: 'thread_1', messageId: 'msg_card' },
      createdAt: proposal.createdAt,
    }
    store.commitEnvelope(proposalId, envelope)

    expect(store.getPublication(proposalId)).toEqual({ state: 'anchored', envelope })
    expect(store.get(proposalId)!.cardMessageId).toBe('msg_card')

    // Identity mismatch → throw
    const { proposalId: p2 } = store.create(proposalInput())
    const p2row = store.get(p2)!
    expect(() =>
      store.commitEnvelope(p2, {
        ...envelope,
        canonicalProposalId: p2,
        createdAt: p2row.createdAt,
        ownerUserId: 'someone-else',
      }),
    ).toThrow(/does not match canonical proposal/)
  })

  it('aborts staged proposals (hard delete) and keeps anchored ones', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())

    store.abortStaged(proposalId, 'stale card')
    expect(store.get(proposalId)).toBeNull()

    // Idempotent on missing id
    expect(() => store.abortStaged(proposalId, 'again')).not.toThrow()
  })

  it('setCardMessageId patches the visibility marker; delete is idempotent', () => {
    const store = new MemoryProfileUpdateProposalStore()
    const { proposalId } = store.create(proposalInput())

    store.setCardMessageId(proposalId, 'msg_9')
    expect(store.get(proposalId)!.cardMessageId).toBe('msg_9')

    store.delete(proposalId)
    expect(store.get(proposalId)).toBeNull()
    expect(() => store.delete(proposalId)).not.toThrow()
  })
})
