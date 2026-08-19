/**
 * IDossierObservationStore — F208 Phase D observation staging port.
 *
 * operator 观察 + provenance 暂存层（AC-D1）。观察不自动替换 summary 层
 * （AC-D3：peer/operator 判断 + provenance）；晋升到 summary 层走 Phase E
 * 蒸馏提案。
 *
 * Ported from clowder-ai `stores/ports/DossierObservationStore.ts`
 * (batch 5.2 — promoted from the permissive stub).
 *
 * @module @flowforge/cats-stores/ports
 */

import type { AddDossierObservationInput, CatId, DossierObservation } from '@flowforge/cats-shared'

export type { AddDossierObservationInput }

export interface IDossierObservationStore {
  /** Stage an observation (id/createdAt/provenance.date store-owned). */
  add(input: AddDossierObservationInput): DossierObservation | Promise<DossierObservation>
  /** List observations for a cat (newest first). */
  list(catId: CatId, limit?: number): DossierObservation[] | Promise<DossierObservation[]>
  /** List observations grouped by catId (each newest first). */
  listAll(limit?: number): Record<string, DossierObservation[]> | Promise<Record<string, DossierObservation[]>>
  /** Get an observation by ID. */
  get(id: string): DossierObservation | null | Promise<DossierObservation | null>
  /** Delete an observation by ID. Returns whether it existed. */
  delete(id: string): boolean | Promise<boolean>
}
