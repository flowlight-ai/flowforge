/**
 * SqliteDossierDistillationProposalStore + SqliteDossierObservationStore +
 * SqliteMemoryGovernanceStore（批次52）.
 *
 * - DistillationProposal：F208 Phase E 状态机 pending→approved→applied /
 *   pending→rejected（事务内 CAS），sourceId 幂等唯一索引。
 * - Observation：F208 Phase D 观察暂存（id/createdAt store-owned）。
 * - MemoryGovernance：发布门禁状态机 draft→pending_review→published→archived
 *   （复用 ports 的 resolveTransition / GovernanceConflictError）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import { generateId } from '@flowforge/cats-shared'
import type {
  AddDossierObservationInput,
  CatId,
  DistillationEvidenceRef,
  DossierDistillationProposal,
  DossierObservation,
} from '@flowforge/cats-shared'
import type {
  CreateDistillationProposalInput,
  IDossierDistillationProposalStore,
  IDossierObservationStore,
  IMemoryGovernanceStore,
  PublishAction,
} from '@flowforge/cats-stores/ports'
import {
  GovernanceConflictError,
  resolveTransition,
  type GovernanceEntry,
} from '@flowforge/cats-stores/ports'
import { inImmediateTransaction } from '../schema.ts'

// ── DossierDistillationProposalStore ────────────────────────

interface DistillationRow {
  readonly id: string
  readonly source_id: string
  readonly target_cat_id: string
  readonly status: string
  readonly created_at: number
  readonly data: string
}

export class SqliteDossierDistillationProposalStore implements IDossierDistillationProposalStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateDistillationProposalInput): DossierDistillationProposal {
    // KD-17 FM-2 fail-closed：无证据引用的提案直接拒绝。
    if (input.evidenceRefs.length === 0) {
      throw new Error('distillation proposal requires at least one evidenceRef (fail-closed)')
    }
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
      evidenceRefs: [...input.evidenceRefs] as DistillationEvidenceRef[],
      baseHash: input.baseHash,
      createdBy: input.createdBy,
      createdAt: Date.now(),
    }
    this.db.prepare(`
      INSERT INTO dossier_distillation_proposals (id, source_id, target_cat_id, status, created_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      proposal.proposalId, proposal.sourceId, proposal.targetCatId,
      proposal.status, proposal.createdAt, JSON.stringify(proposal),
    )
    return { ...proposal }
  }

  get(proposalId: string): DossierDistillationProposal | null {
    return this.read(proposalId)
  }

  listPending(limit?: number): DossierDistillationProposal[] {
    return this.collect('status = ?', ['pending'], limit)
  }

  listByCat(catId: CatId, limit?: number): DossierDistillationProposal[] {
    return this.collect('target_cat_id = ?', [catId], limit)
  }

  getBySourceId(sourceId: string): DossierDistillationProposal | null {
    const row = this.db.prepare(
      'SELECT * FROM dossier_distillation_proposals WHERE source_id = ?',
    ).get(sourceId) as unknown as DistillationRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as DossierDistillationProposal)
  }

  markApproved(proposalId: string, approvedBy: string): DossierDistillationProposal | null {
    return this.transition(proposalId, 'approved', { approvedBy })
  }

  markRejected(proposalId: string, rejectedBy: string, rejectionReason?: string): DossierDistillationProposal | null {
    return this.transition(proposalId, 'rejected', { rejectedBy, rejectionReason })
  }

  markApplied(proposalId: string, appliedBy: string, commitSha: string): DossierDistillationProposal | null {
    return this.transition(proposalId, 'applied', { appliedBy, commitSha })
  }

  private transition(
    proposalId: string,
    toStatus: string,
    fields: Record<string, unknown>,
  ): DossierDistillationProposal | null {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(proposalId)
      const expectedFrom = toStatus === 'applied' ? 'approved' : 'pending'
      if (current === null || current.status !== expectedFrom) return null
      const next = { ...current, ...fields, status: toStatus } as DossierDistillationProposal
      this.db.prepare(
        'UPDATE dossier_distillation_proposals SET status = ?, data = ? WHERE id = ? AND status = ?',
      ).run(next.status, JSON.stringify(next), proposalId, current.status)
      return next
    })
  }

  private read(proposalId: string): DossierDistillationProposal | null {
    const row = this.db.prepare(
      'SELECT * FROM dossier_distillation_proposals WHERE id = ?',
    ).get(proposalId) as unknown as DistillationRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as DossierDistillationProposal)
  }

  private collect(where: string, params: readonly unknown[], limit?: number): DossierDistillationProposal[] {
    const rows = this.db.prepare(
      `SELECT * FROM dossier_distillation_proposals WHERE ${where} ORDER BY created_at DESC`,
    ).all(...(params as string[])) as unknown as DistillationRow[]
    return rows
      .slice(0, limit ?? 100)
      .map((row) => JSON.parse(row.data) as DossierDistillationProposal)
  }
}

// ── DossierObservationStore ─────────────────────────────────

interface ObservationRow {
  readonly id: string
  readonly cat_id: string
  readonly created_at: number
  readonly data: string
}

export class SqliteDossierObservationStore implements IDossierObservationStore {
  constructor(private readonly db: DatabaseSync) {}

  add(input: AddDossierObservationInput): DossierObservation {
    const observation: DossierObservation = {
      id: generateId('obs'),
      catId: input.catId,
      content: input.content,
      provenance: {
        type: 'cvo',
        author: input.author,
        date: new Date().toISOString().slice(0, 10),
      },
      createdAt: Date.now(),
    }
    this.db.prepare(`
      INSERT INTO dossier_observations (id, cat_id, created_at, data) VALUES (?, ?, ?, ?)
    `).run(observation.id, observation.catId, observation.createdAt, JSON.stringify(observation))
    return { ...observation }
  }

  list(catId: CatId, limit?: number): DossierObservation[] {
    const rows = this.db.prepare(
      'SELECT * FROM dossier_observations WHERE cat_id = ? ORDER BY created_at DESC, rowid DESC',
    ).all(catId) as unknown as ObservationRow[]
    return rows.slice(0, limit ?? 100).map((row) => JSON.parse(row.data) as DossierObservation)
  }

  listAll(limit?: number): Record<string, DossierObservation[]> {
    const rows = this.db.prepare(
      'SELECT * FROM dossier_observations ORDER BY created_at DESC, rowid DESC',
    ).all() as unknown as ObservationRow[]
    const grouped: Record<string, DossierObservation[]> = {}
    for (const row of rows) {
      const observation = JSON.parse(row.data) as DossierObservation
      const bucket = grouped[observation.catId] ?? (grouped[observation.catId] = [])
      if (limit === undefined || bucket.length < limit) bucket.push(observation)
    }
    return grouped
  }

  get(id: string): DossierObservation | null {
    const row = this.db.prepare('SELECT * FROM dossier_observations WHERE id = ?')
      .get(id) as unknown as ObservationRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as DossierObservation)
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM dossier_observations WHERE id = ?').run(id).changes > 0
  }
}

// ── MemoryGovernanceStore ───────────────────────────────────

interface GovernanceRow {
  readonly entry_id: string
  readonly status: string
  readonly updated_at: number
  readonly data: string
}

export class SqliteMemoryGovernanceStore implements IMemoryGovernanceStore {
  constructor(private readonly db: DatabaseSync) {}

  create(entryId: string, actor: string, anchors?: string[]): GovernanceEntry {
    const entry: GovernanceEntry = {
      entryId,
      status: 'draft',
      updatedBy: actor,
      updatedAt: Date.now(),
      ...(anchors ? { anchors: [...anchors] } : {}),
    }
    this.db.prepare(`
      INSERT INTO memory_governance (entry_id, status, updated_at, data) VALUES (?, ?, ?, ?)
    `).run(entry.entryId, entry.status, entry.updatedAt, JSON.stringify(entry))
    return { ...entry }
  }

  transition(entryId: string, action: PublishAction, actor: string): GovernanceEntry {
    return inImmediateTransaction(this.db, () => {
      const current = this.read(entryId)
      if (current === null) {
        throw new GovernanceConflictError(`Unknown governance entry "${entryId}"`, 'draft', action)
      }
      const nextStatus = resolveTransition(current.status, action)
      const next: GovernanceEntry = { ...current, status: nextStatus, updatedBy: actor, updatedAt: Date.now() }
      this.db.prepare(
        'UPDATE memory_governance SET status = ?, updated_at = ?, data = ? WHERE entry_id = ? AND status = ?',
      ).run(next.status, next.updatedAt, JSON.stringify(next), entryId, current.status)
      return next
    })
  }

  get(entryId: string): GovernanceEntry | null {
    return this.read(entryId)
  }

  list(): GovernanceEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_governance ORDER BY updated_at DESC',
    ).all() as unknown as GovernanceRow[]
    return rows.map((row) => JSON.parse(row.data) as GovernanceEntry)
  }

  private read(entryId: string): GovernanceEntry | null {
    const row = this.db.prepare('SELECT * FROM memory_governance WHERE entry_id = ?')
      .get(entryId) as unknown as GovernanceRow | undefined
    return row === undefined ? null : (JSON.parse(row.data) as GovernanceEntry)
  }
}
