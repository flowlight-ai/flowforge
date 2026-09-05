/**
 * SqliteProfileUpdateProposalStore — durable IProfileUpdateProposalStore（批次52）.
 *
 * F231 状态机（F128 同构）：pending→approving→approved / pending→rejected /
 * approving→pending（rollback）；P1-1 两路崩溃检查点（writtenPath+provenancePath
 * 在 finalize 前持久化）；P1-2 baseContentHash 提案时钉住。commitEnvelope 与
 * Memory 版一致：proposal 缺失时抛错、成功后同步 cardMessageId。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateProposalId } from '@flowforge/cats-shared'
import type { ApprovalEnvelope, ApprovalPublication, ProfileUpdateProposal } from '@flowforge/cats-shared'
import { assertApprovalEnvelopeIdentity, commitApprovalEnvelope } from '@flowforge/cats-shared'
import type {
  CreateProfileUpdateProposalInput,
  IProfileUpdateProposalStore,
  ProfileUpdateCheckpoint,
} from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

const DEFAULT_LIST_LIMIT = 100

interface ProfileProposalRow {
  readonly id: string
  readonly source_thread_id: string
  readonly created_by: string
  readonly status: string
  readonly decided_at: number | null
  readonly created_at: number
  readonly data: string
}

export class SqliteProfileUpdateProposalStore implements IProfileUpdateProposalStore {
  constructor(private readonly db: DatabaseSync) {}

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
    this.db.prepare(`
      INSERT INTO profile_update_proposals (id, source_thread_id, created_by, status, decided_at, created_at, data)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(
      proposal.proposalId, proposal.sourceThreadId, proposal.createdBy,
      proposal.status, proposal.createdAt, JSON.stringify(proposal),
    )
    return this.read(proposal.proposalId)!
  }

  get(proposalId: string): ProfileUpdateProposal | null {
    return this.read(proposalId)
  }

  listPending(userId: string, limit: number = DEFAULT_LIST_LIMIT): ProfileUpdateProposal[] {
    return this.collect('created_by = ? AND status IN (?, ?)', [userId, 'pending', 'approving'], limit)
  }

  listByThread(threadId: string, limit: number = DEFAULT_LIST_LIMIT): ProfileUpdateProposal[] {
    return this.collect('source_thread_id = ?', [threadId], limit)
  }

  listSettledByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): ProfileUpdateProposal[] {
    return this.collect(
      'created_by = ? AND status IN (?, ?)',
      [userId, 'approved', 'rejected'],
      limit,
      'ORDER BY COALESCE(decided_at, 0) DESC',
    )
  }

  claimForApproval(proposalId: string, approvedBy: string): ProfileUpdateProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'pending') return null
      const next = { ...current, status: 'approving', approvedBy, claimedAt: Date.now() } as ProfileUpdateProposal
      this.write(next)
      return next
    })
  }

  recordCheckpoint(proposalId: string, checkpoint: ProfileUpdateCheckpoint): ProfileUpdateProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'approving') return null
      const next = { ...current } as ProfileUpdateProposal
      if (checkpoint.writtenPath !== undefined) next.writtenPath = checkpoint.writtenPath
      if (checkpoint.provenancePath !== undefined) next.provenancePath = checkpoint.provenancePath
      this.write(next)
      return next
    })
  }

  finalizeApproval(proposalId: string): ProfileUpdateProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'approving') return null
      const next = { ...current, status: 'approved', approvedAt: Date.now() } as ProfileUpdateProposal
      delete next.claimedAt
      this.write(next, Date.now())
      return next
    })
  }

  rollbackClaim(proposalId: string): boolean {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'approving') return false
      const next = { ...current, status: 'pending' } as ProfileUpdateProposal
      delete next.approvedBy
      delete next.claimedAt
      this.write(next)
      return true
    })
  }

  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): ProfileUpdateProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'pending') return null
      const now = Date.now()
      const next = {
        ...current,
        status: 'rejected',
        rejectedBy,
        rejectedAt: now,
        ...(rejectionReason ? { rejectionReason } : {}),
      } as ProfileUpdateProposal
      this.write(next, now)
      return next
    })
  }

  getDedupProposalId(userId: string, clientRequestId: string): string | null {
    return this.dedupLookup(userId, clientRequestId)
  }

  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string {
    this.db.prepare(`
      INSERT INTO profile_update_dedup (user_id, client_request_id, proposal_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, client_request_id) DO NOTHING
    `).run(userId, clientRequestId, proposalId)
    return this.dedupLookup(userId, clientRequestId)!
  }

  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void {
    this.db.prepare(`
      DELETE FROM profile_update_dedup
      WHERE user_id = ? AND client_request_id = ? AND proposal_id = ?
    `).run(userId, clientRequestId, expectedProposalId)
  }

  setCardMessageId(proposalId: string, cardMessageId: string): void {
    inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null) return
      this.write({ ...current, cardMessageId })
    })
  }

  delete(proposalId: string): void {
    this.db.prepare('DELETE FROM profile_update_proposals WHERE id = ?').run(proposalId)
  }

  getPublication(proposalId: string): ApprovalPublication | null {
    return this.read(proposalId)?.publication ?? null
  }

  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void {
    inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null) throw new Error(`proposal not found: ${proposalId}`)
      assertApprovalEnvelopeIdentity(envelope, {
        canonicalProposalId: current.proposalId,
        sourceFeatureId: 'F231',
        ownerUserId: current.createdBy,
        requesterCatId: current.sourceCatId,
        createdAt: current.createdAt,
      })
      const next = {
        ...current,
        publication: commitApprovalEnvelope(current.publication, envelope),
        cardMessageId: envelope.approvalCardRef.messageId,
      } as ProfileUpdateProposal
      this.write(next)
    })
  }

  abortStaged(proposalId: string, reason: string): void {
    inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.publication?.state !== 'staged') return
      const publication: ApprovalPublication = { state: 'tombstoned', failedAt: Date.now(), reason }
      this.write({ ...current, publication })
    })
  }

  private dedupLookup(userId: string, clientRequestId: string): string | null {
    const row = this.db.prepare(
      'SELECT proposal_id FROM profile_update_dedup WHERE user_id = ? AND client_request_id = ?',
    ).get(userId, clientRequestId) as unknown as { proposal_id: string } | undefined
    return row === undefined ? null : row.proposal_id
  }

  private read(proposalId: string): ProfileUpdateProposal | null {
    const row = this.db.prepare('SELECT * FROM profile_update_proposals WHERE id = ?')
      .get(proposalId) as unknown as ProfileProposalRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as ProfileUpdateProposal)
  }

  private write(proposal: ProfileUpdateProposal, decidedAt?: number): void {
    this.db.prepare(`
      UPDATE profile_update_proposals SET status = ?, decided_at = COALESCE(?, decided_at), data = ?
      WHERE id = ?
    `).run(proposal.status, decidedAt ?? null, JSON.stringify(proposal), proposal.proposalId)
  }

  private collect(
    where: string,
    params: readonly unknown[],
    limit: number,
    order = 'ORDER BY created_at DESC',
  ): ProfileUpdateProposal[] {
    const rows = this.db.prepare(
      `SELECT * FROM profile_update_proposals WHERE ${where} ${order}`,
    ).all(...(params as string[])) as unknown as ProfileProposalRow[]
    return rows.slice(0, Math.max(0, limit)).map((row) => JSON.parse(row.data) as ProfileUpdateProposal)
  }
}
