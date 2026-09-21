/**
 * Low-level game action controller tests — validation matrix (S5-3).
 */
import { describe, it, expect, vi } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { GameActionController } from '../src/controllers/game-action.ts';
import { InMemoryNonceDeduplicator } from '../src/ports/game.ts';
import { GameOrchestrator, createWerewolfDefinition } from '@flowforge/cats-games';
import type { GameRuntime, Seat } from '@flowforge/cats-shared';
import { isSeatId } from '@flowforge/cats-shared';
import type { IGameStore, SocketLike } from '@flowforge/cats-games';

// ── Fakes ──────────────────────────────────────────────────────────────────

function buildRuntime(overrides: { round?: number; phase?: string; status?: GameRuntime['status']; seats?: Seat[] } = {}): GameRuntime {
  const definition = createWerewolfDefinition(7);
  const seats: Seat[] = overrides.seats ?? [
    { seatId: 'P1', actorType: 'human', actorId: 'cat-hyu', role: 'witch', alive: true, properties: {} },
    { seatId: 'P2', actorType: 'cat', actorId: 'cat-wolf', role: 'wolf', alive: true, properties: {} },
    { seatId: 'P3', actorType: 'cat', actorId: 'cat-seer', role: 'seer', alive: true, properties: {} },
  ];
  const now = Date.now();
  return {
    gameId: 'game-test',
    threadId: 'thread-1',
    gameType: 'werewolf',
    definition,
    seats,
    currentPhase: overrides.phase ?? 'night_witch',
    round: overrides.round ?? 1,
    eventLog: [],
    pendingActions: {},
    status: overrides.status ?? 'playing',
    config: { timeoutMs: 60000, voiceMode: false, humanRole: 'player', humanSeat: 'P1' },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

class FakeGameStore implements IGameStore {
  constructor(private runtime: GameRuntime) {}
  getRuntime(): GameRuntime {
    return this.runtime;
  }
  setRuntime(runtime: GameRuntime): void {
    this.runtime = runtime;
  }
  async getGame(gameId: string): Promise<GameRuntime | undefined> {
    return this.runtime.gameId === gameId ? { ...this.runtime } : undefined;
  }
  async createGame(runtime: GameRuntime): Promise<GameRuntime> {
    this.runtime = runtime;
    return runtime;
  }
  async updateGame(_gameId: string, runtime: GameRuntime): Promise<void> {
    this.runtime = runtime;
  }
  async listActiveGames(): Promise<GameRuntime[]> {
    return this.runtime.status !== 'finished' ? [{ ...this.runtime }] : [];
  }
}

class FakeSocket implements SocketLike {
  readonly events: Array<{ room: string; event: string; data: unknown }> = [];
  broadcastToRoom(room: string, event: string, data: unknown): void {
    this.events.push({ room, event, data });
  }
  emitToUser(_userId: string, _event: string, _data: unknown): void {}
}

// ── Request builder ────────────────────────────────────────────────────────

function actReq(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined> = {},
): HttpRequest {
  return { method: 'POST', url: `/api/game/game-test/action`, headers, body };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { round: 1, phase: 'night_witch', seat: 'P1', action: 'heal', nonce: 'n1', ...overrides };
}

function make(
  runtime: GameRuntime,
  opts: { ownershipOk?: boolean } = {},
): { controller: GameActionController; orchestrator: GameOrchestrator; store: FakeGameStore; nonce: InMemoryNonceDeduplicator } {
  const store = new FakeGameStore(runtime);
  const socket = new FakeSocket();
  const orchestrator = new GameOrchestrator({ gameStore: store, socketManager: socket });
  const nonce = new InMemoryNonceDeduplicator();
  const controller = new GameActionController({
    orchestrator,
    gameStore: store,
    ownership: { assertOwned: async () => ({ ok: opts.ownershipOk ?? true }) },
    nonce,
  });
  return { controller, orchestrator, store, nonce };
}

const userHeaders = { 'x-cat-id': 'cat-hyu', 'x-cat-cafe-user': 'hyg', 'x-callback-thread-id': 'thread-1' };

describe('GameActionController matrix', () => {
  it('rejects a non-existent gameId with 404', async () => {
    const { controller } = make(buildRuntime());
    const res = await controller.handle({ method: 'POST', url: '/api/game/nope/action', headers: userHeaders, body: validBody() });
    expect(res.status).toBe(404);
  });

  it.each([
    ['malformed body (no array)', {}],
    ['missing round', { phase: 'night_witch', seat: 'P1', action: 'heal' }],
    ['missing phase', { round: 1, seat: 'P1', action: 'heal' }],
    ['missing seat', { round: 1, phase: 'night_witch', action: 'heal' }],
    ['missing action', { round: 1, phase: 'night_witch', seat: 'P1' }],
    ['invalid seat id', { round: 1, phase: 'night_witch', seat: 'X9', action: 'heal' }],
  ])('rejects %s with 400', async (_label, body) => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(body as Record<string, unknown>, userHeaders));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects missing x-cat-id with 401', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), { 'x-cat-cafe-user': 'hyg' }));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects missing user identity with 401', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), { 'x-cat-id': 'cat-hyu' }));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects ownership failure with 403', async () => {
    const { controller, orchestrator } = make(buildRuntime(), { ownershipOk: false });
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), userHeaders));
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a callback thread mismatch with 403', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), { ...userHeaders, 'x-callback-thread-id': 'thread-other' }));
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a non-playing game with 409', async () => {
    const { controller, orchestrator } = make(buildRuntime({ status: 'paused' }));
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), userHeaders));
    expect(res.status).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a round mismatch with 409', async () => {
    const { controller, orchestrator } = make(buildRuntime({ round: 2 }));
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody({ round: 1 }), userHeaders));
    expect(res.status).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a phase mismatch with 409', async () => {
    const { controller, orchestrator } = make(buildRuntime({ phase: 'night_resolve' }));
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody({ phase: 'night_witch' }), userHeaders));
    expect(res.status).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a seat not in the game with 400', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody({ seat: 'P9' }), userHeaders));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an actor that does not own the seat with 403', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), { ...userHeaders, 'x-cat-id': 'cat-wolf' }));
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a dead seat with 409', async () => {
    const deadSeats: Seat[] = [
      { seatId: 'P1', actorType: 'human', actorId: 'cat-hyu', role: 'witch', alive: false, properties: {} },
    ];
    const { controller, orchestrator } = make(buildRuntime({ seats: deadSeats }));
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), userHeaders));
    expect(res.status).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });

  it('deduplicates a repeated nonce and does not call the orchestrator', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const first = await controller.handle(actReq(validBody({ nonce: 'dup' }), userHeaders));
    expect(first.status).toBe(200);
    expect((first.body as { accepted: boolean }).accepted).toBe(true);
    const second = await controller.handle(actReq(validBody({ nonce: 'dup' }), userHeaders));
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ accepted: true, deduplicated: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dispatches a valid, uniquely-nonced action to the orchestrator', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(actReq(validBody(), userHeaders));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    const [gameId, seatId, action] = spy.mock.calls[0]!;
    expect(gameId).toBe('game-test');
    expect(seatId).toBe('P1');
    expect(isSeatId(action.seatId)).toBe(true);
    expect(action.actionName).toBe('heal');
    // Nonce is cleared on abort (shared store) so the same nonce is reusable.
    const second = await controller.handle(actReq(validBody({ nonce: 'n1' }), userHeaders));
    expect(second.status).toBe(200);
    expect((second.body as { deduplicated?: boolean }).deduplicated).toBe(true);
    void controller;
  });

  it('returns 400 when the orchestrator rejects the action', async () => {
    const { controller, orchestrator } = make(buildRuntime());
    vi.spyOn(orchestrator, 'handlePlayerAction').mockRejectedValue(new Error('not allowed in phase'));
    const res = await controller.handle(actReq(validBody(), userHeaders));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('not allowed in phase');
  });
});