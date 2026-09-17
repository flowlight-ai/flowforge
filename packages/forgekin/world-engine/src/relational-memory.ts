/**
 * In-memory relational memory (F093 memory track 2).
 *
 * Mirrors `relational_memory.py`: relationships auto-register on first
 * interaction, interaction entries get a timestamp when absent, and evolving a
 * relationship returns a new immutable record.
 */

import { isoNow, type Clock } from './clock.js';
import { withRelationType, type Relationship } from './citizens.js';
import type { InteractionEntry, RelationalMemoryPort } from './ports/relational-memory.js';

export interface RelationalMemoryOptions {
  readonly clock?: Clock;
}

export class InMemoryRelationalMemory implements RelationalMemoryPort {
  private readonly relationships = new Map<string, Relationship>();
  private readonly interactions = new Map<string, InteractionEntry[]>();
  private readonly clock: Clock | undefined;

  constructor(options: RelationalMemoryOptions = {}) {
    this.clock = options.clock;
  }

  async recordInteraction(
    relationship: Relationship,
    interaction: Record<string, unknown>,
  ): Promise<void> {
    if (!this.relationships.has(relationship.relationshipId)) {
      this.relationships.set(relationship.relationshipId, relationship);
    }
    const entry: InteractionEntry = Object.freeze({
      ...interaction,
      timestamp: typeof interaction['timestamp'] === 'string' ? interaction['timestamp'] : isoNow(this.clock),
    });
    const history = this.interactions.get(relationship.relationshipId) ?? [];
    history.push(entry);
    this.interactions.set(relationship.relationshipId, history);
  }

  async queryRelationships(characterId: string): Promise<readonly Relationship[]> {
    return [...this.relationships.values()].filter(
      (relationship) =>
        relationship.characterA === characterId || relationship.characterB === characterId,
    );
  }

  async updateRelationship(relationshipId: string, newType: string): Promise<boolean> {
    const current = this.relationships.get(relationshipId);
    if (current === undefined) return false;
    this.relationships.set(relationshipId, withRelationType(current, newType));
    return true;
  }

  async getInteractionHistory(relationshipId: string): Promise<readonly InteractionEntry[]> {
    return [...(this.interactions.get(relationshipId) ?? [])];
  }
}
