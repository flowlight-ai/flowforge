/**
 * In-memory canon memory (F093 memory track 1).
 *
 * Mirrors `canon_memory.py`: a `confirmed_by` whitelist (CL-010), idempotent
 * writes by `decisionId`, and reads ordered by timestamp. The legacy class held
 * the whitelist privately and exposed `can_write`; both are preserved.
 */

import { CANON_WRITERS, type CanonDecision } from './citizens.js';
import type { CanonFilter, CanonMemoryPort } from './ports/canon-memory.js';

const CANON_WRITER_SET: ReadonlySet<string> = new Set(CANON_WRITERS);

export class InMemoryCanonMemory implements CanonMemoryPort {
  /** worldId → decisions, kept ascending by timestamp. */
  private readonly store = new Map<string, CanonDecision[]>();

  async write(decision: CanonDecision, confirmedBy: string): Promise<boolean> {
    // CL-010: the confirmer must hold canon write permission...
    if (!CANON_WRITER_SET.has(confirmedBy)) return false;
    // ...and so must the author recorded on the decision itself.
    if (!CANON_WRITER_SET.has(decision.decidedBy)) return false;

    const bucket = this.store.get(decision.worldId) ?? [];
    if (bucket.some((existing) => existing.decisionId === decision.decisionId)) {
      // Idempotent: the same decision id is never stored twice.
      return true;
    }
    bucket.push(decision);
    bucket.sort((left, right) => (left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0));
    this.store.set(decision.worldId, bucket);
    return true;
  }

  async read(worldId: string): Promise<readonly CanonDecision[]> {
    return [...(this.store.get(worldId) ?? [])];
  }

  async query(worldId: string, filter: CanonFilter = {}): Promise<readonly CanonDecision[]> {
    const decisions = this.store.get(worldId) ?? [];
    const keys = Object.keys(filter) as (keyof CanonFilter)[];
    if (keys.length === 0) return [...decisions];
    return decisions.filter((decision) =>
      keys.every((key) => {
        const expected = filter[key];
        if (expected === undefined) return true;
        return key === 'worldId' ? decision.worldId === expected : decision.decidedBy === expected;
      }),
    );
  }

  canWrite(actor: string): boolean {
    return CANON_WRITER_SET.has(actor);
  }
}

/** Canon write whitelist (CL-010), exposed for hosts that gate on it. */
export function canonWriters(): readonly string[] {
  return [...CANON_WRITERS];
}
