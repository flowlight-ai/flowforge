/**
 * Game ports (S5-3).
 *
 * Dependency seams for the game REST controllers. Kept in the controller package
 * so the controllers stay thin: persistence / thread / socket / identity all come
 * in through interfaces. The engine itself lives in `@flowforge/cats-games` and is
 * consumed here; this file only declares the "host-provided" seams that bridge the
 * controller layer to the real thread/message/ownership subsystems the engine does
 * not own.
 * @module @flowforge/api-rest-controllers/ports/game
 */

/**
 * Nonce dedup port replacing clowder's module-level global `submittedNonces` map.
 * Shared by the high-level controller (clears on abort) and the low-level action
 * controller (claims on each submission).
 */
export interface NonceDeduplicator {
  /**
   * Atomically claim a nonce. Returns true on first claim (proceed normally);
   * returns false on a duplicate (silently deduplicate for MCP callbacks).
   */
  tryClaim(gameId: string, nonce: string): boolean;
  /** Drop all recorded nonces for a game (abort / god-stop / delete). */
  clear(gameId: string): void;
}

/** In-memory {@link NonceDeduplicator} — the offline/contract-test default. */
export class InMemoryNonceDeduplicator implements NonceDeduplicator {
  private readonly store = new Map<string, Set<string>>();

  tryClaim(gameId: string, nonce: string): boolean {
    let set = this.store.get(gameId);
    if (!set) {
      set = new Set<string>();
      this.store.set(gameId, set);
    }
    if (set.has(nonce)) return false;
    set.add(nonce);
    return true;
  }

  clear(gameId: string): void {
    this.store.delete(gameId);
  }
}

/**
 * Host-provided thread lifecycle seam for the high-level game routes. flowforge's
 * thread model has no clowder threadStore.create/updateThinkingMode/updatePin, so
 * the controller delegates game-thread creation/play-mode/pin to the host.
 */
export interface GameThreadHostSeam {
  /** Create an isolated game thread; returns its id. */
  createThread(userId: string, title: string, path: string): Promise<{ id: string }>;
  /** Mark the thread as play mode (info isolation). */
  setPlayMode(threadId: string): Promise<void>;
  /** Pin/unpin the thread (attention pinning in the conversation list). */
  setPin(threadId: string, value: boolean): Promise<void>;
}

/**
 * Ownership assertion for the low-level (/game/:gameId/action) callback gate.
 * flowforge's engine has no `thread.createdBy`, so the host must verify the caller
 * owns the thread a game belongs to. Tests/offline hosts supply a permissive fake.
 */
export interface GameActionAuth {
  /**
   * Assert the caller (userId) owns the thread for gameId. Return ok:false with a
   * reason when ownership cannot be established.
   */
  assertOwned(
    gameId: string,
    threadId: string,
    userId: string,
  ): Promise<{ ok: boolean; reason?: string }>;
}

/** Narrow auto-player surface the game controllers depend on for start/stop lifecycle. */
export interface AutoPlayerSurface {
  startLoop(gameId: string): void;
  stopLoop(gameId: string): void;
  stopAllLoops(): void;
  isLoopActive?(gameId: string): boolean;
}