/**
 * Relational memory port (F093 memory track 2) — long-lived, between characters.
 *
 * Relations evolve freely (朋友 → 师徒) without canon-level confirmation, but an
 * evolved relation still does not become canon by itself.
 */

import type { Relationship } from '../citizens.js';

/** One recorded interaction; `timestamp` is filled in when absent. */
export interface InteractionEntry {
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

export interface RelationalMemoryPort {
  /** Record an interaction; the relationship is auto-registered when new. */
  recordInteraction(
    relationship: Relationship,
    interaction: Record<string, unknown>,
  ): Promise<void>;
  /** Every relationship involving `characterId` (either side). */
  queryRelationships(characterId: string): Promise<readonly Relationship[]>;
  /** Evolve a relationship type. `false` when the relationship is unknown. */
  updateRelationship(relationshipId: string, newType: string): Promise<boolean>;
  /** Interaction history for one relationship, in insertion order. */
  getInteractionHistory(relationshipId: string): Promise<readonly InteractionEntry[]>;
}
