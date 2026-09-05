/**
 * SqliteProposalStore — durable IProposalStore（F128，批次52）.
 *
 * 语义对齐 Memory 版（F128 状态机 review-proven 边）：pending→approving→approved /
 * pending→rejected / pending|approving→withdrawn / approving→pending（rollback）。
 * recordCreatedThread 为 Stage 1.5 崩溃检查点（不改 status，finalize 前原子持久化
 * createdThreadId）。CAS 迁移在 `BEGIN IMMEDIATE` 事务内以 status 守卫更新实现。
 * dedup 走独立表（transport-retry 幂等）。publication/envelope 语义复用
 * cats-shared 的 assertApprovalEnvelopeIdentity / commitApprovalEnvelope。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateProposalId } from '@flowforge/cats-shared'
import type { ApprovalEnvelope, ApprovalPublication, ProposalApproveOverrides, ThreadProposal } from '@flowforge/cats-shared'
import {
  assertApprovalEnvelopeIdentity,
  commitApprovalEnvelope,
} from '@flowforge/cats-shared'
import type {
  CreateThreadProposalInput,
  FinalizeApprovalInput,
  IProposalStore,
} from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

const DEFAULT_LIST_LIMIT = 100

interface ProposalRow {
  readonly id: string
  readonly source_thread_id: string
  readonly created_by: string
  readonly status: string
  readonly decided_at: number | null
  readonly created_at: number
  readonly data: string
}

interface DedupRow {
  readonly user_id: string
  readonly client_request_id: string
  readonly proposal_id: string
}

export class SqliteProposalStore implements IProposalStore {
  constructor(private readonly db: DatabaseSync) {}

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
    this.db.prepare(`
      INSERT INTO thread_proposals (id, source_thread_id, created_by, status, decided_at, created_at, data)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(
      proposal.proposalId, proposal.sourceThreadId, proposal.createdBy,
      proposal.status, proposal.createdAt, JSON.stringify(proposal),
    )
    return this.read(proposal.proposalId)!
  }

  get(proposalId: string): ThreadProposal | null {
    return this.read(proposalId)
  }

  listPending(userId: string, limit: number = DEFAULT_LIST_LIMIT): ThreadProposal[] {
    return this.collect(
      'created_by = ? AND status IN (?, ?)',
      [userId, 'pending', 'approving'],
      limit,
    )
  }

  listByThread(threadId: string, limit: number = DEFAULT_LIST_LIMIT): ThreadProposal[] {
    return this.collect('source_thread_id = ?', [threadId], limit)
  }

  listSettledByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): ThreadProposal[] {
    return this.collect(
      'created_by = ? AND status IN (?, ?)',
      [userId, 'approved', 'rejected'],
      limit,
      'ORDER BY COALESCE(decided_at, 0) DESC',
    )
  }

  claimForApproval(proposalId: string, approvedBy: string): ThreadProposal | null {
    return this.transition(proposalId, 'pending', 'approving', (p) => ({
      ...p,
      status: 'approving',
      approvedBy,
      claimedAt: Date.now(),
    }))
  }

  recordCreatedThread(
    proposalId: string,
    createdThreadId: string,
    overrides?: ProposalApproveOverrides,
  ): ThreadProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'approving') return null
      const next: ThreadProposal = { ...current, createdThreadId }
      if (overrides !== undefined) applyOverrides(next, overrides)
      this.write(next)
      return next
    })
  }

  finalizeApproval(input: FinalizeApprovalInput): ThreadProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(input.proposalId)
      if (current === null || current.status !== 'approving') return null
      const next: ThreadProposal = {
        ...current,
        status: 'approved',
        createdThreadId: input.createdThreadId,
        approvedAt: Date.now(),
      }
      delete (next as Partial<ThreadProposal>).claimedAt
      if (input.overrides !== undefined) applyOverrides(next, input.overrides)
      this.write(next, Date.now())
      return next
    })
  }

  rollbackClaim(proposalId: string): boolean {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'approving') return false
      const next = { ...current, status: 'pending' } as ThreadProposal
      delete (next as Partial<ThreadProposal>).approvedBy
      delete (next as Partial<ThreadProposal>).claimedAt
      this.write(next)
      return true
    })
  }

  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): ThreadProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== 'pending') return null
      const now = Date.now()
      const next: ThreadProposal = {
        ...current,
        status: 'rejected',
        rejectedBy,
        rejectedAt: now,
        ...(rejectionReason ? { rejectionReason } : {}),
      }
      this.write(next, now)
      return next
    })
  }

  markWithdrawn(proposalId: string, withdrawnBy: NonNullable<ThreadProposal['withdrawnBy']>): ThreadProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status === 'approved' || current.status === 'rejected' || current.status === 'withdrawn') {
        return null
      }
      const next: ThreadProposal = {
        ...current,
        status: 'withdrawn',
        withdrawnBy,
        withdrawnAt: Date.now(),
      }
      this.write(next, Date.now())
      return next
    })
  }

  getDedupProposalId(userId: string, clientRequestId: string): string | null {
    const row = this.db.prepare(
      'SELECT proposal_id FROM thread_proposal_dedup WHERE user_id = ? AND client_request_id = ?',
    ).get(userId, clientRequestId) as unknown as DedupRow | undefined
    return row === undefined ? null : row.proposal_id
  }

  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string {
    this.db.prepare(`
      INSERT INTO thread_proposal_dedup (user_id, client_request_id, proposal_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, client_request_id) DO NOTHING
    `).run(userId, clientRequestId, proposalId)
    return this.getDedupProposalId(userId, clientRequestId)!
  }

  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void {
    this.db.prepare(`
      DELETE FROM thread_proposal_dedup
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
    this.db.prepare('DELETE FROM thread_proposals WHERE id = ?').run(proposalId)
  }

  getPublication(proposalId: string): ApprovalPublication | null {
    return this.read(proposalId)?.publication ?? null
  }

  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void {
    inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null) return
      assertApprovalEnvelopeIdentity(envelope, {
        canonicalProposalId: current.proposalId,
        sourceFeatureId: 'F128',
        ownerUserId: current.createdBy,
        requesterCatId: current.sourceCatId,
        createdAt: current.createdAt,
      })
      this.write({ ...current, publication: commitApprovalEnvelope(current.publication, envelope) })
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

  private transition(
    proposalId: string,
    fromStatus: string,
    toStatus: string,
    build: (current: ThreadProposal) => ThreadProposal,
  ): ThreadProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      if (current === null || current.status !== fromStatus) return null
      const next = build(current)
      this.write(next, toStatus === 'approving' ? undefined : Date.now())
      return next
    })
  }

  private read(proposalId: string): ThreadProposal | null {
    const row = this.db.prepare('SELECT * FROM thread_proposals WHERE id = ?')
      .get(proposalId) as unknown as ProposalRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as ThreadProposal)
  }

  private write(proposal: ThreadProposal, decidedAt?: number): void {
    this.db.prepare(`
      UPDATE thread_proposals SET status = ?, decided_at = COALESCE(?, decided_at), data = ?
      WHERE id = ?
    `).run(
      proposal.status,
      decidedAt ?? null,
      JSON.stringify(proposal),
      proposal.proposalId,
    )
  }

  private collect(
    where: string,
    params: readonly unknown[],
    limit: number,
    order = 'ORDER BY created_at DESC',
  ): ThreadProposal[] {
    const rows = this.db.prepare(
      `SELECT * FROM thread_proposals WHERE ${where} ${order}`,
    ).all(...(params as string[])) as unknown as ProposalRow[]
    return rows.slice(0, Math.max(0, limit)).map((row) => JSON.parse(row.data) as ThreadProposal)
  }
}

function applyOverrides(proposal: ThreadProposal, overrides: ProposalApproveOverrides): void {
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
