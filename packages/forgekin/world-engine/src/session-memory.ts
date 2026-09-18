/**
 * In-memory session memory (F093 memory track 3).
 *
 * Mirrors `session_memory.py`: sessions are bucketed by `turn.roundId`,
 * `clearSession` touches nothing else, and `markTurnCanon` rewrites only the
 * session-local copy of a turn (CL-010 — writing canon belongs to the Canon
 * Sync Protocol).
 */

import { withCanonFlag, type Turn } from './citizens.js';
import type { SessionDump, SessionMemoryPort } from './ports/session-memory.js';

export class InMemorySessionMemory implements SessionMemoryPort {
  private readonly sessions = new Map<string, Turn[]>();

  async addTurn(turn: Turn): Promise<void> {
    // The legacy skeleton used `round_id` as the session key.
    const sessionId = turn.roundId;
    const turns = this.sessions.get(sessionId) ?? [];
    turns.push(turn);
    this.sessions.set(sessionId, turns);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async getTurns(sessionId: string): Promise<readonly Turn[]> {
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  async getSessionIds(): Promise<readonly string[]> {
    return [...this.sessions.keys()];
  }

  async markTurnCanon(turnId: string): Promise<boolean> {
    for (const turns of this.sessions.values()) {
      const index = turns.findIndex((turn) => turn.turnId === turnId);
      if (index >= 0) {
        const current = turns[index] as Turn;
        turns[index] = withCanonFlag(current, true);
        return true;
      }
    }
    return false;
  }

  async dumpSession(sessionId: string): Promise<SessionDump> {
    const turns = this.sessions.get(sessionId) ?? [];
    return Object.freeze({
      sessionId,
      turnCount: turns.length,
      canonCount: turns.filter((turn) => turn.isCanon).length,
      turns: [...turns],
    });
  }
}
