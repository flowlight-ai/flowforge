/**
 * MemoryDossierObservationStore — in-memory IDossierObservationStore
 * (F208 Phase D observation staging).
 *
 * Ported from clowder-ai `InMemoryDossierObservationStore`. Observations are
 * staged with provenance (AC-D1) and never auto-replace the summary layer
 * (AC-D3) — promotion happens through Phase E distillation proposals.
 *
 * @module @flowforge/cats-stores/memory
 */

import {
  generateId,
  type AddDossierObservationInput,
  type CatId,
  type DossierObservation,
} from '@flowforge/cats-shared'
import type { IDossierObservationStore } from '../ports/dossier-observation-store.ts'

const DEFAULT_LIST_LIMIT = 100

/** In-memory implementation for tests and single-process dev. */
export class MemoryDossierObservationStore implements IDossierObservationStore {
  private readonly observations = new Map<string, DossierObservation>()

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
    this.observations.set(observation.id, observation)
    return { ...observation, provenance: { ...observation.provenance } }
  }

  list(catId: CatId, limit: number = DEFAULT_LIST_LIMIT): DossierObservation[] {
    return this.collect((o) => o.catId === catId, limit)
  }

  listAll(limit: number = DEFAULT_LIST_LIMIT): Record<string, DossierObservation[]> {
    const grouped = new Map<string, DossierObservation[]>()
    const cap = Math.max(0, limit)
    for (const observation of this.collect(() => true, Number.POSITIVE_INFINITY)) {
      const key = observation.catId as string
      const bucket = grouped.get(key)
      if (bucket) {
        if (bucket.length < cap) bucket.push(observation)
      } else {
        grouped.set(key, [observation])
      }
    }
    return Object.fromEntries(grouped)
  }

  get(id: string): DossierObservation | null {
    const found = this.observations.get(id)
    return found ? { ...found, provenance: { ...found.provenance } } : null
  }

  delete(id: string): boolean {
    return this.observations.delete(id)
  }

  private collect(
    predicate: (o: DossierObservation) => boolean,
    limit: number,
  ): DossierObservation[] {
    const result: DossierObservation[] = []
    for (const observation of this.observations.values()) {
      if (predicate(observation)) {
        result.push({ ...observation, provenance: { ...observation.provenance } })
      }
    }
    // Newest first.
    result.sort((a, b) => b.createdAt - a.createdAt)
    return Number.isFinite(limit) ? result.slice(0, Math.max(0, limit)) : result
  }
}
