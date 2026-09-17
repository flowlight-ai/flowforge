/**
 * Canon memory port (F093 memory track 1) — permanent, world-level truth.
 *
 * Stores `CanonDecision`s: decisions that are irreversible at world level.
 *
 * Iron law (CL-010): "RP 台词不自动入典" — content produced during role play must
 * never enter canon automatically; it requires explicit confirmation by a
 * permitted writer (operator / canon_driver / council).
 *
 * The port exists so hosts can inject a durable backend (SQLite / PostgreSQL);
 * the legacy module documented exactly that replacement point.
 */

import type { CanonDecision, CanonWriter } from '../citizens.js';

/** Structured filter replacing the legacy `getattr`-based dict filter. */
export interface CanonFilter {
  readonly decidedBy?: CanonWriter;
  readonly worldId?: string;
}

export interface CanonMemoryPort {
  /**
   * Write a decision. Returns `false` when the writer is not permitted — the
   * legacy implementation returned `false` rather than raising, and callers
   * depend on that.
   */
  write(decision: CanonDecision, confirmedBy: string): Promise<boolean>;
  /** All decisions for a world, ascending by timestamp. */
  read(worldId: string): Promise<readonly CanonDecision[]>;
  /** Decisions matching `filter` (empty filter = all). */
  query(worldId: string, filter?: CanonFilter): Promise<readonly CanonDecision[]>;
  /** Whether `actor` holds canon write permission. */
  canWrite(actor: string): boolean;
}
