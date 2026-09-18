/**
 * Session memory port (F093 memory track 3) — temporary, per session.
 *
 * Cleared when the session ends and **never** pollutes canon or relational
 * memory. `markTurnCanon` only flags the session's own copy; writing canon is
 * the Canon Sync Protocol's job (bridge layer, wave 2b).
 */

import type { Turn } from '../citizens.js';

/** Snapshot of one session, for diagnostics / logging. */
export interface SessionDump {
  readonly sessionId: string;
  readonly turnCount: number;
  readonly canonCount: number;
  readonly turns: readonly Turn[];
}

export interface SessionMemoryPort {
  /** Append a turn to its session (bucketed by `turn.roundId`). */
  addTurn(turn: Turn): Promise<void>;
  /** Drop one session. Canon / relational memory are untouched. */
  clearSession(sessionId: string): Promise<void>;
  /** Turns of a session, in insertion order. */
  getTurns(sessionId: string): Promise<readonly Turn[]>;
  /** Currently active session ids (diagnostics / cleanup). */
  getSessionIds(): Promise<readonly string[]>;
  /** Flag the session-local copy of a turn as canon; `false` when absent. */
  markTurnCanon(turnId: string): Promise<boolean>;
  dumpSession(sessionId: string): Promise<SessionDump>;
}
