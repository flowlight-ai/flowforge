/**
 * ISessionHandoffProposalStore — F225 cat-initiated session handoff proposal store
 * (stage-5 batch 6.2). Promoted from `stub-ports.ts`'s permissive
 * `Record<string, unknown>` to the full branded contract, porting clowder-ai
 * `SessionHandoffProposalStore.ts` 1:1.
 *
 * 猫在干净断点主动提议封印当前 session → co-creator gate → spawn 同 thread 同 catId
 * 续接 + 注入猫亲手写的五件套交接留言。复用 F128 ProposalStore 的 CAS claim 思路，
 * 但不复用 ThreadProposal shape（KD-5）。approve 用 commit-point 模型（KD-8/9）：
 *
 *   pending → approving → approved   (claim → 持久化 note → requestSeal(commit point)
 *                                      → enqueue → finalize)
 *   pending → rejected               (gate reject, one-shot, F281 反馈原子捕获)
 *   pending/approving → expired      (cooldown / stale / session 已变)
 *
 * 崩溃恢复（KD-9）按 checkpoint 字段续跑：
 *   handoffNotePersistedAt / sealedSessionId / sealAcceptedAt / continuationEntryId，
 * 由 `recordCheckpoint` 持久化（不改 status）。
 *
 * 品牌类型（CatId / SessionHandoffProposal / CatHandoffNote / ApprovalPublication /
 * ApprovalEnvelope / HumanDispositionLedgerEntry / HumanDispositionLedgerReceipt /
 * HumanDispositionFeedbackInput）来自 @flowforge/cats-shared，本文件不重导出。
 *
 * @module @flowforge/cats-stores/ports
 */

import type {
  ApprovalEnvelope,
  ApprovalPublication,
  CatHandoffNote,
  CatId,
  HumanDispositionFeedbackInput,
  HumanDispositionLedgerEntry,
  HumanDispositionLedgerReceipt,
  SessionHandoffProposal,
} from '@flowforge/cats-shared'

export interface CreateHandoffProposalInput {
  sourceThreadId: string
  sourceSessionId: string
  sourceCatId: CatId
  sourceMessageId: string
  userId: string
  /** 五件套留言（proposalId / sourceSessionId / persistedAt 由 store 填） */
  note: Omit<CatHandoffNote, 'proposalId' | 'sourceSessionId' | 'persistedAt'>
  /** 预留 proposalId（dedup 用，对齐 ProposalStore） */
  proposalId?: string
}

/** commit-point checkpoint patch（不改 status，KD-8/9 crash recovery） */
export interface HandoffCheckpointPatch {
  handoffNotePersistedAt?: number
  sealedSessionId?: string
  sealAcceptedAt?: number
  continuationEntryId?: string
  cardMessageId?: string
}

/** F281 rejection input（markRejected 原子捕获反馈）。 */
export interface RejectSessionHandoffInput {
  decidedAt: number
  feedback?: HumanDispositionFeedbackInput
}

export type SessionHandoffRejectionOutcome =
  | 'applied'
  | 'replayed'
  | 'conflict'
  | 'legacy_unmigrated'
  | 'invariant_failure'
  | 'not_available'

export interface SessionHandoffRejectionResult {
  outcome: SessionHandoffRejectionOutcome
  proposal?: SessionHandoffProposal
}

export interface SessionHandoffDispositionEntryLookup {
  ownerUserId: string
  receipt: HumanDispositionLedgerReceipt
}

const SOURCE_PREFIX = 'F225:session-handoff:'
const SOURCE_SUFFIX = ':reject'

/** Parse a handoff proposalId back out of an F281 disposition sourceRef. */
export function sessionHandoffProposalIdFromSourceRef(sourceRef: string): string | null {
  if (!sourceRef.startsWith(SOURCE_PREFIX) || !sourceRef.endsWith(SOURCE_SUFFIX)) return null
  const proposalId = sourceRef.slice(SOURCE_PREFIX.length, -SOURCE_SUFFIX.length)
  return proposalId.length > 0 ? proposalId : null
}

export interface ISessionHandoffProposalStore {
  create(input: CreateHandoffProposalInput): SessionHandoffProposal | Promise<SessionHandoffProposal>
  get(proposalId: string): SessionHandoffProposal | null | Promise<SessionHandoffProposal | null>
  /** CAS pending → approving. Returns claimed snapshot, or null if status drifted (not pending). */
  claimForApproval(proposalId: string): SessionHandoffProposal | null | Promise<SessionHandoffProposal | null>
  /** Persist monotonic commit-point fields without changing status. */
  recordCheckpoint(
    proposalId: string,
    patch: HandoffCheckpointPatch,
  ): SessionHandoffProposal | null | Promise<SessionHandoffProposal | null>
  /** CAS approving → approved. Returns updated proposal or null if status drifted. */
  finalizeApproval(proposalId: string): SessionHandoffProposal | null | Promise<SessionHandoffProposal | null>
  /** Atomic pending → rejected + F281 feedback capture. */
  markRejected(proposalId: string, input: RejectSessionHandoffInput): SessionHandoffRejectionResult | Promise<SessionHandoffRejectionResult>
  loadHumanDispositionEntry(
    input: SessionHandoffDispositionEntryLookup,
  ): HumanDispositionLedgerEntry | null | Promise<HumanDispositionLedgerEntry | null>
  /** CAS pending|approving → expired. null if already terminal. */
  markExpired(proposalId: string): SessionHandoffProposal | null | Promise<SessionHandoffProposal | null>
  /** A4 abuse guard: pending|approving proposals for one source session. */
  listActiveBySession(sourceSessionId: string): SessionHandoffProposal[] | Promise<SessionHandoffProposal[]>
  /** F246 Approval Hub: pending proposals for a user, newest first. */
  listPendingByUser(userId: string, limit?: number): SessionHandoffProposal[] | Promise<SessionHandoffProposal[]>
  /** F246 Phase G: settled (approved|rejected) proposals for a user, newest-decided first. */
  listSettledByUser(userId: string, limit?: number): SessionHandoffProposal[] | Promise<SessionHandoffProposal[]>
  /** A4 cooldown: most recent proposal (ANY status) for this (user,cat,thread). */
  getMostRecentByCatThread(
    userId: string,
    sourceCatId: CatId,
    sourceThreadId: string,
  ): SessionHandoffProposal | null | Promise<SessionHandoffProposal | null>
  /** A4 hourly cap: count proposals (ANY status) created at/after sinceTs. */
  countRecentByCatThread(
    userId: string,
    sourceCatId: CatId,
    sourceThreadId: string,
    sinceTs: number,
  ): number | Promise<number>
  /** Hard delete (idempotent) — phantom card cleanup, frees the A4 gate. */
  delete(proposalId: string): void | Promise<void>
  /** Transport-retry idempotency: cached proposalId for (userId, clientRequestId). */
  getDedupProposalId(userId: string, clientRequestId: string): string | null | Promise<string | null>
  /** Atomic reserve: returns the proposalId actually stored. */
  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string | Promise<string>
  /** Release a reserved dedup key IFF it still points at expectedProposalId. */
  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void | Promise<void>
  getPublication(proposalId: string): ApprovalPublication | null | Promise<ApprovalPublication | null>
  commitEnvelope(proposalId: string, envelope: ApprovalEnvelope): void | Promise<void>
  abortStaged(proposalId: string, reason: string): void | Promise<void>
}