/**
 * MemorySessionHandoffProposalStore — in-memory ISessionHandoffProposalStore.
 *
 * Ported from clowder-ai `InMemorySessionHandoffProposalStore` (inside
 * `SessionHandoffProposalStore.ts`) + `InMemorySessionHandoffDisposition`
 * (self-contained). 单线程 Node.js 同步 Map 操作，CAS 语义由事件循环保证；
 * commit-point checkpoint（KD-8/9）与 F281 反馈 ledger 语义照搬源码。F281
 * ledger 通过 @flowforge/cats-shared 的 `buildHumanDispositionLedgerEntry` 构建，
 * 不再依赖 clowder 的独立 receipt-index 子模块（厂家内聚到本 store）。
 *
 * @module @flowforge/cats-stores/memory
 */

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
} from '../ports/session-handoff-proposal-store.ts'
import { sessionHandoffProposalIdFromSourceRef } from '../ports/session-handoff-proposal-store.ts'

const DEFAULT_LIST_LIMIT = 100

const ACTIVE_STATUSES: ReadonlySet<SessionHandoffProposal['status']> = new Set(['pending', 'approving'])

/** In-memory implementation for tests and single-process dev. */
export class MemorySessionHandoffProposalStore implements ISessionHandoffProposalStore {
  private readonly proposals = new Map<string, SessionHandoffProposal>()
  /** F281: approval receipts keyed by `${ownerUserId}\0${sourceRef}`. */
  private readonly receipts = new Map<string, string>()
  // clientRequestId → proposalId dedup index (transport-retry idempotency).
  private readonly dedupCache = new Map<string, string>()
  // Monotonic clock: proposals in the same wall-clock ms still get strictly
  // increasing createdAt so the A4 cooldown / hourly cap are deterministic.
  private lastTs = 0

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
    }
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
    this.proposals.set(proposalId, proposal)
    return clone(proposal)
  }

  get(proposalId: string): SessionHandoffProposal | null {
    const found = this.proposals.get(proposalId)
    return found ? clone(found) : null
  }

  claimForApproval(proposalId: string): SessionHandoffProposal | null {
    const p = this.proposals.get(proposalId)
    if (!p || p.status !== 'pending') return null
    p.status = 'approving'
    p.updatedAt = Date.now()
    return clone(p)
  }

  recordCheckpoint(proposalId: string, patch: HandoffCheckpointPatch): SessionHandoffProposal | null {
    const p = this.proposals.get(proposalId)
    if (!p) return null
    if (patch.handoffNotePersistedAt !== undefined) p.handoffNotePersistedAt = patch.handoffNotePersistedAt
    if (patch.sealedSessionId !== undefined) p.sealedSessionId = patch.sealedSessionId
    if (patch.sealAcceptedAt !== undefined) p.sealAcceptedAt = patch.sealAcceptedAt
    if (patch.continuationEntryId !== undefined) p.continuationEntryId = patch.continuationEntryId
    if (patch.cardMessageId !== undefined) p.cardMessageId = patch.cardMessageId
    p.updatedAt = Date.now()
    return clone(p)
  }

  finalizeApproval(proposalId: string): SessionHandoffProposal | null {
    const p = this.proposals.get(proposalId)
    if (!p || p.status !== 'approving') return null
    p.status = 'approved'
    p.updatedAt = Date.now()
    return clone(p)
  }

  markRejected(proposalId: string, input: RejectSessionHandoffInput): SessionHandoffRejectionResult {
    const p = this.proposals.get(proposalId)
    if (!p) return { outcome: 'not_available' }
    if (p.status === 'rejected') return this.classifyTerminal(p, input)
    if (p.status !== 'pending') return { outcome: 'not_available', proposal: clone(p) }

    const entry = this.buildLedgerEntry(p, input.decidedAt, input.feedback)
    const receipt = buildHumanDispositionLedgerReceipt(entry)
    if (this.receipts.get(receiptKey(p.userId, receipt.sourceRef)) || p.humanDispositionLedgerEntry) {
      return { outcome: 'invariant_failure', proposal: clone(p) }
    }

    p.status = 'rejected'
    p.updatedAt = input.decidedAt
    p.humanDispositionLedgerEntry = entry
    if (entry.episode.feedback) p.latestHumanDisposition = entry.episode.feedback
    else delete p.latestHumanDisposition
    this.receipts.set(receiptKey(p.userId, receipt.sourceRef), JSON.stringify(receipt))
    return { outcome: 'applied', proposal: clone(p) }
  }

  loadHumanDispositionEntry(input: SessionHandoffDispositionEntryLookup): HumanDispositionLedgerEntry | null {
    const proposalId = sessionHandoffProposalIdFromSourceRef(input.receipt.sourceRef)
    const p = proposalId ? this.proposals.get(proposalId) : undefined
    if (!p || p.userId !== input.ownerUserId) return null
    const parsed = humanDispositionLedgerEntrySchema.safeParse(p.humanDispositionLedgerEntry)
    if (!parsed.success) return null
    const storedReceipt = this.receipts.get(receiptKey(input.ownerUserId, input.receipt.sourceRef))
    if (storedReceipt === undefined) return null
    if (storedReceipt !== JSON.stringify(input.receipt)) return null
    const entryReceipt = buildHumanDispositionLedgerReceipt(parsed.data)
    return JSON.stringify(entryReceipt) === JSON.stringify(input.receipt) ? parsed.data : null
  }

  markExpired(proposalId: string): SessionHandoffProposal | null {
    const p = this.proposals.get(proposalId)
    if (!p || !ACTIVE_STATUSES.has(p.status)) return null
    p.status = 'expired'
    p.updatedAt = Date.now()
    return clone(p)
  }

  listActiveBySession(sourceSessionId: string): SessionHandoffProposal[] {
    const result: SessionHandoffProposal[] = []
    for (const p of this.proposals.values()) {
      if (p.sourceSessionId === sourceSessionId && ACTIVE_STATUSES.has(p.status)) result.push(clone(p))
    }
    return result
  }

  listPendingByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): SessionHandoffProposal[] {
    const result = this.collect((p) => p.userId === userId && p.status === 'pending')
    result.sort((a, b) => b.createdAt - a.createdAt)
    return result.slice(0, Math.max(0, limit))
  }

  listSettledByUser(userId: string, limit: number = DEFAULT_LIST_LIMIT): SessionHandoffProposal[] {
    const result = this.collect(
      (p) => p.userId === userId && (p.status === 'approved' || p.status === 'rejected'),
      (a, b) => b.updatedAt - a.updatedAt,
    )
    return result.slice(0, Math.max(0, limit))
  }

  getMostRecentByCatThread(userId: string, sourceCatId: string, sourceThreadId: string): SessionHandoffProposal | null {
    let latest: SessionHandoffProposal | null = null
    for (const p of this.proposals.values()) {
      if (p.userId === userId && p.sourceCatId === sourceCatId && p.sourceThreadId === sourceThreadId) {
        if (!latest || p.createdAt > latest.createdAt) latest = p
      }
    }
    return latest ? clone(latest) : null
  }

  countRecentByCatThread(userId: string, sourceCatId: string, sourceThreadId: string, sinceTs: number): number {
    let count = 0
    for (const p of this.proposals.values()) {
      if (
        p.userId === userId &&
        p.sourceCatId === sourceCatId &&
        p.sourceThreadId === sourceThreadId &&
        p.createdAt >= sinceTs
      ) {
        count++
      }
    }
    return count
  }

  delete(proposalId: string): void {
    this.proposals.delete(proposalId)
    for (const [k, v] of this.dedupCache) {
      if (v === proposalId) this.dedupCache.delete(k)
    }
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

  getPublication(proposalId: string): ApprovalPublication | null {
    const p = this.proposals.get(proposalId)
    return p?.publication ? structuredClone(p.publication) : null
  }

  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void {
    const p = this.proposals.get(proposalId)
    if (!p) return
    assertApprovalEnvelopeIdentity(envelope, {
      canonicalProposalId: p.proposalId,
      sourceFeatureId: 'F225',
      ownerUserId: p.userId,
      requesterCatId: p.sourceCatId,
      createdAt: p.createdAt,
    })
    p.publication = commitApprovalEnvelope(p.publication, envelope)
    p.updatedAt = Date.now()
  }

  abortStaged(proposalId: string, reason: string): void {
    const p = this.proposals.get(proposalId)
    if (!p || p.publication?.state !== 'staged') return
    p.publication = { state: 'tombstoned', failedAt: Date.now(), reason }
  }

  reset(): void {
    this.proposals.clear()
    this.receipts.clear()
    this.dedupCache.clear()
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

  private classifyTerminal(p: SessionHandoffProposal, input: RejectSessionHandoffInput): SessionHandoffRejectionResult {
    const parsed = humanDispositionLedgerEntrySchema.safeParse(p.humanDispositionLedgerEntry)
    if (!parsed.success) return { outcome: 'legacy_unmigrated', proposal: clone(p) }
    const receipt = buildHumanDispositionLedgerReceipt(parsed.data)
    const storedReceipt = this.receipts.get(receiptKey(p.userId, receipt.sourceRef))
    const canonicalFeedback = parsed.data.episode.feedback
    if (
      !storedReceipt ||
      storedReceipt !== JSON.stringify(receipt) ||
      classifyHumanDispositionFeedbackReplay(p.latestHumanDisposition, canonicalFeedback) === 'conflict'
    ) {
      return { outcome: 'invariant_failure', proposal: clone(p) }
    }
    const replay = classifyHumanDispositionFeedbackReplay(canonicalFeedback, input.feedback)
    return { outcome: replay === 'replay' ? 'replayed' : 'conflict', proposal: clone(p) }
  }

  private collect(
    predicate: (p: SessionHandoffProposal) => boolean,
    sort?: (a: SessionHandoffProposal, b: SessionHandoffProposal) => number,
  ): SessionHandoffProposal[] {
    const items: SessionHandoffProposal[] = []
    for (const p of this.proposals.values()) {
      if (predicate(p)) items.push(clone(p))
    }
    return sort ? items.sort(sort) : items
  }
}

function dedupKey(userId: string, clientRequestId: string): string {
  return `${userId}::${clientRequestId}`
}

function receiptKey(ownerUserId: string, sourceRef: string): string {
  return `${ownerUserId}\u0000${sourceRef}`
}

function clone(p: SessionHandoffProposal): SessionHandoffProposal {
  return {
    ...p,
    note: { ...p.note, ...(p.note.commits ? { commits: [...p.note.commits] } : {}) },
    ...(p.publication ? { publication: structuredClone(p.publication) } : {}),
    ...(p.humanDispositionLedgerEntry
      ? { humanDispositionLedgerEntry: structuredClone(p.humanDispositionLedgerEntry) }
      : {}),
  }
}