/**
 * IDossierDistillationProposalStore — F208 Phase E distillation proposal port.
 *
 * 经验蒸馏提案：observation/evidence → cat-dossier.md summary 层，operator
 * 审批后由猫应用（KD-18）。
 *
 * 状态机（比 F231 简单——approve 不写文件）：
 *   pending  → approved   (operator approves)
 *   pending  → rejected   (operator rejects)
 *   approved → applied    (cat applies draft to dossier + git commit)
 *
 * 幂等：sourceId per 触发事件唯一（如 "feat-phase-close:F208:D"）。
 * 同 sourceId → getBySourceId 返回既有提案，create 应跳过。
 *
 * 安全（KD-17 FM-2 fail-closed）：create 时 evidenceRefs 必须非空。
 *
 * Ported from clowder-ai `stores/ports/DossierDistillationProposalStore.ts`
 * (batch 5.2 — promoted from the permissive stub; CAS transitions preserved).
 *
 * @module @flowforge/cats-stores/ports
 */

import type {
  CatId,
  DistillationEvidenceRef,
  DistillationSourceEvent,
  DossierDistillationProposal,
} from '@flowforge/cats-shared'

/** Input for creating a distillation proposal. */
export interface CreateDistillationProposalInput {
  sourceEvent: DistillationSourceEvent;
  sourceId: string;
  targetCatId: CatId;
  targetFields: string[];
  beforeSnapshot: string;
  afterDraft: string;
  rationale: string;
  evidenceRefs: DistillationEvidenceRef[];
  baseHash: string;
  createdBy: string;
  /** Optional explicit proposalId (for pre-reserved IDs). */
  proposalId?: string;
}

export interface IDossierDistillationProposalStore {
  /** Create a new proposal. Throws if evidenceRefs is empty (fail-closed). */
  create(input: CreateDistillationProposalInput): DossierDistillationProposal | Promise<DossierDistillationProposal>
  /** Get a proposal by ID. */
  get(proposalId: string): DossierDistillationProposal | null | Promise<DossierDistillationProposal | null>
  /** List all pending proposals (newest first). */
  listPending(limit?: number): DossierDistillationProposal[] | Promise<DossierDistillationProposal[]>
  /** List proposals for a specific cat (all statuses, newest first). */
  listByCat(catId: CatId, limit?: number): DossierDistillationProposal[] | Promise<DossierDistillationProposal[]>
  /** Idempotency: find existing proposal by sourceId. */
  getBySourceId(sourceId: string): DossierDistillationProposal | null | Promise<DossierDistillationProposal | null>
  /** CAS pending → approved. Returns null if not pending. */
  markApproved(
    proposalId: string,
    approvedBy: string,
  ): DossierDistillationProposal | null | Promise<DossierDistillationProposal | null>
  /** CAS pending → rejected. Returns null if not pending. */
  markRejected(
    proposalId: string,
    rejectedBy: string,
    rejectionReason?: string,
  ): DossierDistillationProposal | null | Promise<DossierDistillationProposal | null>
  /** CAS approved → applied. Returns null if not approved. */
  markApplied(
    proposalId: string,
    appliedBy: string,
    commitSha: string,
  ): DossierDistillationProposal | null | Promise<DossierDistillationProposal | null>
}
