/**
 * SqliteSessionHandoffProposalStore — durable ISessionHandoffProposalStore（F225，批次52）.
 *
 * 语义对齐 Memory 版：commit-point checkpoint（KD-8/9，不改 status）、F281
 * 拒绝反馈原子捕获（ledger entry + receipt 幂等/replay/conflict 分类）、
 * A4 守卫查询（per-session active / most-recent / hourly cap）、dedup 幂等。
 * receipt 索引走独立表（`${ownerUserId}\0${sourceRef}` 键控）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import {
  assertApprovalEnvelopeIdentity,
  buildHumanDispositionLedgerEntry,
  buildHumanDispositionLedgerReceipt,
  classifyHumanDispositionFeedbackReplay,
  commitApprovalEnvelope,
  generateProposalId,
  humanDispositionLedgerEntrySchema,
  type ApprovalEnvelope,
  type ApprovalPublication,
  type CatHandoffNote,
  type HumanDispositionLedgerEntry,
  type SessionHandoffProposal,
} from '@flowforge/cats-shared'
import type {
  CreateHandoffProposalInput,
  HandoffCheckpointPatch,
  ISessionHandoffProposalStore,
  RejectSessionHandoffInput,
  SessionHandoffDispositionEntryLookup,
  SessionHandoffRejectionResult,
} from '@flowforge/cats-stores/ports'
import { sessionHandoffProposalIdFromSourceRef } from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

const DEFAULT_LIST_LIMIT = 100
const ACTIVE_STATUSES: ReadonlySet<SessionHandoffProposal['status']> = new Set(['pending', 'approving'])

interface HandoffRow {
  readonly id: string
  readonly source_session_id: string
  readonly user_id: string
  readonly source_cat_id: string
  readonly source_thread_id: string
  readonly status: string
  readonly created_at: number
  readonly updated_at: number
  readonly data: string
}

export class SqliteSessionHandoffProposalStore implements ISessionHandoffProposalStore {
  /** 单调钟：同一 wall-clock ms 的提案 createdAt 仍严格递增（A4 判定确定性）。 */
  private lastTs = 0

  constructor(private readonly db: DatabaseSync) {}

  private monoNow(): number {
    const n = Date.now()
    this.lastTs = n > this.lastTs ? n : this.lastTs + 1
    return this.lastTs
  }

  create(input: CreateHandoffProposalInput): SessionHandoffProposal {
    const now = this.monoNow()
    const proposalId = input.proposalId ?? generateProposalId()
    const note: CatHandoffNote = {
      ...input.note,
      proposalId,
      sourceSessionId: input.sourceSessionId,
      persistedAt: now,
    } as CatHandoffNote
    const proposal: SessionHandoffProposal = {
      kind: 'session_handoff',
      proposalId,
      status: 'pending',
      sourceThreadId: input.sourceThreadId,
      sourceSessionId: input.sourceSessionId,
      sourceCatId: input.sourceCatId,
      sourceMessageId: input.sourceMessageId,
      userId: input.userId,
      note,
      createdAt: now,
      updatedAt: now,
      publication: { state: 'staged', stagedAt: now },
    }
    this.db.prepare(`
      INSERT INTO session_handoff_proposals
        (id, source_session_id, user_id, source_cat_id, source_thread_id, status, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposalId, input.sourceSessionId, input.userId, input.sourceCatId,
      input.sourceThreadId, 'pending', now, now, JSON.stringify(proposal),
    )
    return this.read(proposalId)!
  }

  get(proposalId: string): SessionHandoffProposal | null {
    return this.read(proposalId)
  }

  claimForApproval(proposalId: string): SessionHandoffProposal | null {
    return inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null || p.status !== 'pending') return null
      const next = { ...p, status: 'approving', updatedAt: Date.now() } as SessionHandoffProposal
      this.write(next)
      return next
    })
  }

  recordCheckpoint(proposalId: string, patch: HandoffCheckpointPatch): SessionHandoffProposal | null {
    return inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null) return null
      const next = { ...p } as SessionHandoffProposal
      if (patch.handoffNotePersistedAt !== undefined) next.handoffNotePersistedAt = patch.handoffNotePersistedAt
      if (patch.sealedSessionId !== undefined) next.sealedSessionId = patch.sealedSessionId
      if (patch.sealAcceptedAt !== undefined) next.sealAcceptedAt = patch.sealAcceptedAt
      if (patch.continuationEntryId !== undefined) next.continuationEntryId = patch.continuationEntryId
      if (patch.cardMessageId !== undefined) next.cardMessageId = patch.cardMessageId
      next.updatedAt = Date.now()
      this.write(next)
      return next
    })
  }

  finalizeApproval(proposalId: string): SessionHandoffProposal | null {
    return inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null || p.status !== 'approving') return null
      const next = { ...p, status: 'approved', updatedAt: Date.now() } as SessionHandoffProposal
      this.write(next)
      return next
    })
  }

  markRejected(proposalId: string, input: RejectSessionHandoffInput): SessionHandoffRejectionResult {
    return inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null) return { outcome: 'not_available' }
      if (p.status === 'rejected') return this.classifyTerminal(p, input)
      if (p.status !== 'pending') return { outcome: 'not_available', proposal: p }

      const entry = this.buildLedgerEntry(p, input.decidedAt, input.feedback)
      const receipt = buildHumanDispositionLedgerReceipt(entry)
      const receiptStored = this.readReceipt(p.userId, receipt.sourceRef) !== null
      if (receiptStored || p.humanDispositionLedgerEntry !== undefined) {
        return { outcome: 'invariant_failure', proposal: p }
      }

      const next = {
        ...p,
        status: 'rejected',
        updatedAt: input.decidedAt,
        humanDispositionLedgerEntry: entry,
        ...(entry.episode.feedback
          ? { latestHumanDisposition: entry.episode.feedback }
          : {}),
      } as SessionHandoffProposal
      delete (next as { latestHumanDisposition?: unknown }).latestHumanDisposition
      if (entry.episode.feedback) next.latestHumanDisposition = entry.episode.feedback
      this.write(next)
      this.writeReceipt(p.userId, receipt.sourceRef, JSON.stringify(receipt))
      return { outcome: 'applied', proposal: next }
    })
  }

  loadHumanDispositionEntry(input: SessionHandoffDispositionEntryLookup): HumanDispositionLedgerEntry | null {
    const proposalId = sessionHandoffProposalIdFromSourceRef(input.receipt.sourceRef)
    const p = proposalId !== null ? this.read(proposalId) : null
    if (p === null || p.userId !== input.ownerUserId) return null
    const parsed = humanDispositionLedgerEntrySchema.safeParse(p.humanDispositionLedgerEntry)
    if (!parsed.success) return null
    const storedReceipt = this.readReceipt(input.ownerUserId, input.receipt.sourceRef)
    if (storedReceipt === null) return null
    if (storedReceipt !== JSON.stringify(input.receipt)) return null
    const entryReceipt = buildHumanDispositionLedgerReceipt(parsed.data)
    return JSON.stringify(entryReceipt) === JSON.stringify(input.receipt) ? parsed.data : null
  }

  markExpired(proposalId: string): SessionHandoffProposal | null {
    return inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null || !ACTIVE_STATUSES.has(p.status)) return null
      const next = { ...p, status: 'expired', updatedAt: Date.now() } as SessionHandoffProposal
      this.write(next)
      return next
    })
  }

  listActiveBySession(sourceSessionId: string): SessionHandoffProposal[] {
    return this.collect(
      'source_session_id = ? AND status IN (?, ?)',
      [sourceSessionId, 'pending', 'approving'],
    )
  }

  listPendingByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): SessionHandoffProposal[] {
    return this.collect(
      'user_id = ? AND status = ?',
      [userId, 'pending'],
      limit,
      'ORDER BY created_at DESC',
    )
  }

  listSettledByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): SessionHandoffProposal[] {
    return this.collect(
      "user_id = ? AND status IN (?, ?)",
      [userId, 'approved', 'rejected'],
      limit,
      'ORDER BY updated_at DESC',
    )
  }

  getMostRecentByCatThread(userId: string, sourceCatId: string, sourceThreadId: string): SessionHandoffProposal | null {
    const rows = this.db.prepare(`
      SELECT * FROM session_handoff_proposals
      WHERE user_id = ? AND source_cat_id = ? AND source_thread_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).all(userId, sourceCatId, sourceThreadId) as unknown as HandoffRow[]
    const row = rows[0]
    return row === undefined ? null : (JSON.parse(row.data) as SessionHandoffProposal)
  }

  countRecentByCatThread(userId: string, sourceCatId: string, sourceThreadId: string, sinceTs: number): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM session_handoff_proposals
      WHERE user_id = ? AND source_cat_id = ? AND source_thread_id = ? AND created_at >= ?
    `).get(userId, sourceCatId, sourceThreadId, sinceTs) as { count: number }
    return row.count
  }

  delete(proposalId: string): void {
    this.db.prepare('DELETE FROM session_handoff_proposals WHERE id = ?').run(proposalId)
  }

  getDedupProposalId(userId: string, clientRequestId: string): string | null {
    const row = this.db.prepare(
      'SELECT proposal_id FROM session_handoff_dedup WHERE user_id = ? AND client_request_id = ?',
    ).get(userId, clientRequestId) as unknown as { proposal_id: string } | undefined
    return row === undefined ? null : row.proposal_id
  }

  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string {
    this.db.prepare(`
      INSERT INTO session_handoff_dedup (user_id, client_request_id, proposal_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, client_request_id) DO NOTHING
    `).run(userId, clientRequestId, proposalId)
    return this.getDedupProposalId(userId, clientRequestId)!
  }

  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void {
    this.db.prepare(`
      DELETE FROM session_handoff_dedup
      WHERE user_id = ? AND client_request_id = ? AND proposal_id = ?
    `).run(userId, clientRequestId, expectedProposalId)
  }

  getPublication(proposalId: string): ApprovalPublication | null {
    return this.read(proposalId)?.publication ?? null
  }

  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void {
    inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null) return
      assertApprovalEnvelopeIdentity(envelope, {
        canonicalProposalId: p.proposalId,
        sourceFeatureId: 'F225',
        ownerUserId: p.userId,
        requesterCatId: p.sourceCatId,
        createdAt: p.createdAt,
      })
      const next = {
        ...p,
        publication: commitApprovalEnvelope(p.publication, envelope),
        updatedAt: Date.now(),
      } as SessionHandoffProposal
      this.write(next)
    })
  }

  abortStaged(proposalId: string, reason: string): void {
    inImmediateTransaction(this.db, () => {
      const p = this.read(proposalId)
      if (p === null || p.publication?.state !== 'staged') return
      const publication: ApprovalPublication = { state: 'tombstoned', failedAt: Date.now(), reason }
      this.write({ ...p, publication })
    })
  }

  private buildLedgerEntry(
    p: SessionHandoffProposal,
    decidedAt: number,
    feedback: RejectSessionHandoffInput['feedback'],
  ): HumanDispositionLedgerEntry {
    return buildHumanDispositionLedgerEntry(feedback, {
      interactionKind: 'session_handoff',
      subjectRef: p.sourceSessionId,
      proposalId: p.proposalId,
      decision: 'rejected',
      producerCatId: p.sourceCatId,
      ownerUserId: p.userId,
      decidedAt,
      scope: { kind: 'exact_subject' },
      expiry: { kind: 'none' },
      invalidator: { kind: 'none' },
      sourceRef: `F225:session-handoff:${p.proposalId}:reject`,
    })
  }

  private classifyTerminal(
    p: SessionHandoffProposal,
    input: RejectSessionHandoffInput,
  ): SessionHandoffRejectionResult {
    const parsed = humanDispositionLedgerEntrySchema.safeParse(p.humanDispositionLedgerEntry)
    if (!parsed.success) return { outcome: 'legacy_unmigrated', proposal: p }
    const receipt = buildHumanDispositionLedgerReceipt(parsed.data)
    const storedReceipt = this.readReceipt(p.userId, receipt.sourceRef)
    const canonicalFeedback = parsed.data.episode.feedback
    if (
      storedReceipt === null ||
      storedReceipt !== JSON.stringify(receipt) ||
      classifyHumanDispositionFeedbackReplay(p.latestHumanDisposition, canonicalFeedback) === 'conflict'
    ) {
      return { outcome: 'invariant_failure', proposal: p }
    }
    const replay = classifyHumanDispositionFeedbackReplay(canonicalFeedback, input.feedback)
    return { outcome: replay === 'replay' ? 'replayed' : 'conflict', proposal: p }
  }

  private readReceipt(ownerUserId: string, sourceRef: string): string | null {
    const row = this.db.prepare(
      'SELECT receipt_json FROM session_handoff_receipts WHERE owner_user_id = ? AND source_ref = ?',
    ).get(`${ownerUserId}`, sourceRef) as unknown as { receipt_json: string } | undefined
    return row === undefined ? null : row.receipt_json
  }

  private writeReceipt(ownerUserId: string, sourceRef: string, receiptJson: string): void {
    this.db.prepare(`
      INSERT INTO session_handoff_receipts (owner_user_id, source_ref, receipt_json) VALUES (?, ?, ?)
      ON CONFLICT(owner_user_id, source_ref) DO NOTHING
    `).run(ownerUserId, sourceRef, receiptJson)
  }

  private read(proposalId: string): SessionHandoffProposal | null {
    const row = this.db.prepare('SELECT * FROM session_handoff_proposals WHERE id = ?')
      .get(proposalId) as unknown as HandoffRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as SessionHandoffProposal)
  }

  private write(proposal: SessionHandoffProposal): void {
    this.db.prepare(`
      UPDATE session_handoff_proposals SET status = ?, updated_at = ?, data = ? WHERE id = ?
    `).run(proposal.status, proposal.updatedAt, JSON.stringify(proposal), proposal.proposalId)
  }

  private collect(
    where: string,
    params: readonly unknown[],
    limit?: number,
    order = 'ORDER BY created_at DESC',
  ): SessionHandoffProposal[] {
    const rows = this.db.prepare(
      `SELECT * FROM session_handoff_proposals WHERE ${where} ${order}`,
    ).all(...(params as string[])) as unknown as HandoffRow[]
    return rows
      .slice(0, limit ?? DEFAULT_LIST_LIMIT)
      .map((row) => JSON.parse(row.data) as SessionHandoffProposal)
  }
}
