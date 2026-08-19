/**
 * DossierDistillationService — 经验 → dossier 蒸馏管线 Cordis 服务（F208 Phase D/E）。
 *
 * 移植自 clowder-ai distillation 域（R13 一切皆插件改造）：
 * - Phase D：observation 暂存（operator 观察 + provenance，不自动替换 summary 层 AC-D3）
 * - Phase E：observation/evidence → 蒸馏提案（KD-17 契约：sourceId 幂等 +
 *   evidenceRefs 非空 fail-closed + baseHash stale-write lock）
 * - 应用：纯函数 prepareDraft（`./dossier-applier.ts`）校验 + 计算修改内容；
 *   git commit/push 由宿主执行，成功后以 commitSha 调 markApplied（KD-18）
 * - 存储经 `ctx.catStores.dossierObservations() / dossierDistillationProposals()`
 * - `Context` 扩展挂载点：`ctx.catsDistiller`（对齐 24-stage4 计划 T4.5.4）
 *
 * @module @flowforge/cats-orchestration/distiller
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  AddDossierObservationInput,
  CatId,
  DossierDistillationProposal,
  DossierObservation,
} from '@flowforge/cats-shared'
import type { CreateDistillationProposalInput } from '@flowforge/cats-stores'
import {
  type ApplyDraftResult,
  computeFileHash,
  prepareDraft,
} from './dossier-applier.ts'

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 经验蒸馏管线 — mounted by `@flowforge/cats-orchestration`.
     */
    catsDistiller: DossierDistillationService
  }
}

/** Result of applyProposal: applied proposal + draft payload on success. */
export type ApplyProposalOutcome =
  | { ok: true; proposal: DossierDistillationProposal; draft: ApplyDraftResult }
  | { ok: false; error: { code: 'NOT_FOUND' | 'NOT_APPROVED' | 'BASE_HASH_MISMATCH' | 'BEFORE_SNAPSHOT_NOT_FOUND'; message: string } }

/**
 * Cordis service exposing the dossier distillation pipeline at `ctx.catsDistiller`.
 */
export class DossierDistillationService extends Service {
  static inject = ['catStores']

  constructor(ctx: Context) {
    super(ctx, 'catsDistiller')
  }

  // ---------------------------------------------------------------------------
  // Phase D — observation staging (AC-D1 / AC-D3)
  // ---------------------------------------------------------------------------

  /** Stage an operator observation (id/createdAt/provenance.date store-owned). */
  async addObservation(input: AddDossierObservationInput): Promise<DossierObservation> {
    return this.ctx.catStores.dossierObservations().add(input)
  }

  /** List staged observations for a cat (newest first). */
  async listObservations(catId: CatId, limit?: number): Promise<DossierObservation[]> {
    return this.ctx.catStores.dossierObservations().list(catId, limit)
  }

  // ---------------------------------------------------------------------------
  // Phase E — distillation proposals (KD-17 / KD-18)
  // ---------------------------------------------------------------------------

  /**
   * Create a distillation proposal (idempotent by sourceId; fail-closed on
   * empty evidenceRefs — store-level KD-17 enforcement).
   */
  async propose(input: CreateDistillationProposalInput): Promise<DossierDistillationProposal> {
    return this.ctx.catStores.dossierDistillationProposals().create(input)
  }

  /** Get a proposal by ID. */
  async getProposal(proposalId: string): Promise<DossierDistillationProposal | null> {
    return this.ctx.catStores.dossierDistillationProposals().get(proposalId)
  }

  /** List pending proposals (newest first). */
  async listPendingProposals(limit?: number): Promise<DossierDistillationProposal[]> {
    return this.ctx.catStores.dossierDistillationProposals().listPending(limit)
  }

  /** CAS pending → approved (operator approves in Hub). */
  async approveProposal(proposalId: string, approvedBy: string): Promise<DossierDistillationProposal | null> {
    return this.ctx.catStores.dossierDistillationProposals().markApproved(proposalId, approvedBy)
  }

  /** CAS pending → rejected. */
  async rejectProposal(
    proposalId: string,
    rejectedBy: string,
    rejectionReason?: string,
  ): Promise<DossierDistillationProposal | null> {
    return this.ctx.catStores.dossierDistillationProposals().markRejected(proposalId, rejectedBy, rejectionReason)
  }

  /**
   * Apply an approved proposal: validate the stale-write lock (baseHash vs
   * current dossier content) and compute the modified content. On success the
   * proposal is CAS-advanced to `applied` with the caller-provided commitSha
   * (git commit/push stays host-side, KD-18).
   *
   * @param commitShaOverride When provided, used as the applied commit SHA;
   *   otherwise a deterministic pseudo-SHA (hash of modified content) is
   *   recorded so in-process tests can assert the applied transition.
   */
  async applyProposal(
    proposalId: string,
    appliedBy: string,
    currentDossierContent: string,
    commitShaOverride?: string,
  ): Promise<ApplyProposalOutcome> {
    const store = this.ctx.catStores.dossierDistillationProposals()
    const proposal = await store.get(proposalId)
    if (!proposal) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Proposal not found: ${proposalId}` } }
    }

    const draft = prepareDraft(proposal, currentDossierContent)
    if (!draft.ok) {
      return { ok: false, error: draft.error }
    }

    const commitSha = commitShaOverride ?? computeFileHash(draft.result.modifiedContent)
    const applied = await store.markApplied(proposalId, appliedBy, commitSha)
    if (!applied) {
      return { ok: false, error: { code: 'NOT_APPROVED', message: `Proposal ${proposalId} was not in approved state at apply time` } }
    }

    return { ok: true, proposal: applied, draft: draft.result }
  }
}
