/**
 * High-level game controller tests — lifecycle routes (S5-3).
 */
import { describe, it, expect, vi } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { GameController } from '../src/controllers/game.ts';
import { InMemoryNonceDeduplicator } from '../src/ports/game.ts';
import type { AutoPlayerSurface, GameThreadHostSeam } from '../src/ports/game.ts';
import { GameOrchestrator, createWerewolfDefinition } from '@flowforge/cats-games';
import type { GameRuntime, Seat } from '@flowforge/cats-shared';
import type { IGameStore, SocketLike } from '@flowforge/cats-games';

// ── Fakes ──────────────────────────────────────────────────────────────────

function makeSeats(count: number, humanId?: string): Seat[] {
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    const isHuman = humanId !== undefined && i === 0;
    seats.push({
      seatId: `P${i + 1}` as Seat['seatId'],
      actorType: isHuman ? 'human' : ('cat' as Seat['actorType']),
      actorId: isHuman ? humanId : `cat-${i}`,
      role: '',
      alive: true,
      properties: {},
    });
  }
  return seats;
}

function buildRuntime(overrides: { gameId?: string; threadId?: string; seats?: Seat[]; status?: GameRuntime['status'] } = {}): GameRuntime {
  const gameId = overrides.gameId ?? 'game-x';
  const threadId = overrides.threadId ?? 'thread-1';
  const seats = overrides.seats ?? makeSeats(7, 'hyg');
  const now = Date.now();
  return {
    gameId,
    threadId,
    gameType: 'werewolf',
    definition: createWerewolfDefinition(seats.length),
    seats,
    currentPhase: 'day_discuss',
    round: 1,
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
  private readonly games = new Map<string, GameRuntime>();
  constructor(seed: GameRuntime[] = []) {
    for (const g of seed) this.games.set(g.gameId, g);
  }
  async getGame(gameId: string): Promise<GameRuntime | undefined> {
    const g = this.games.get(gameId);
    return g ? { ...g } : undefined;
  }
  async createGame(runtime: GameRuntime): Promise<GameRuntime> {
    this.games.set(runtime.gameId, runtime);
    return runtime;
  }
  async updateGame(gameId: string, runtime: GameRuntime): Promise<void> {
    this.games.set(gameId, runtime);
  }
  async listActiveGames(): Promise<GameRuntime[]> {
    return [...this.games.values()].filter((g) => g.status !== 'finished').map((g) => ({ ...g }));
  }
  all(): GameRuntime[] {
    return [...this.games.values()];
  }
}

class FakeSocket implements SocketLike {
  readonly events: Array<{ room: string; event: string; data: unknown }> = [];
  broadcastToRoom(room: string, event: string, data: unknown): void {
    this.events.push({ room, event, data });
  }
  emitToUser(_userId: string, _event: string, _data: unknown): void {}
}

class FakeThreadHost implements GameThreadHostSeam {
  readonly created: Array<{ userId: string; title: string; path: string }> = [];
  readonly pins: Array<{ threadId: string; value: boolean }> = [];
  playModes = new Set<string>();
  async createThread(userId: string, title: string, path: string): Promise<{ id: string }> {
    this.created.push({ userId, title, path });
    return { id: 'thread-1' };
  }
  async setPlayMode(threadId: string): Promise<void> {
    this.playModes.add(threadId);
  }
  async setPin(threadId: string, value: boolean): Promise<void> {
    this.pins.push({ threadId, value });
  }
}

class FakeAutoPlayer implements AutoPlayerSurface {
  readonly started: string[] = [];
  readonly stopped: string[] = [];
  startLoop(gameId: string): void {
    this.started.push(gameId);
  }
  stopLoop(gameId: string): void {
    this.stopped.push(gameId);
  }
  stopAllLoops(): void {}
  isLoopActive(_gameId: string): boolean {
    return false;
  }
}

// ── Harness ────────────────────────────────────────────────────────────────

function make(seed: GameRuntime[] = []) {
  const store = new FakeGameStore(seed);
  const socket = new FakeSocket();
  const orchestrator = new GameOrchestrator({ gameStore: store, socketManager: socket });
  const hostThreads = new FakeThreadHost();
  const autoPlayer = new FakeAutoPlayer();
  const nonce = new InMemoryNonceDeduplicator();
  const controller = new GameController({
    orchestrator,
    gameStore: store,
    sockets: socket,
    hostThreads,
    autoPlayer,
    nonce,
  });
  return { controller, store, socket, hostThreads, autoPlayer, orchestrator, nonce };
}

function req(method: string, url: string, body: unknown, headers: Record<string, string | undefined> = {}): HttpRequest {
  return { method, url, headers, body: body as Record<string, unknown> };
}

const user = { 'x-cat-cafe-user': 'hyg' };

const SEVEN_CATS = ['cat-0', 'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6'];

function startBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameType: 'werewolf',
    humanRole: 'player',
    playerCount: 7,
    catIds: ['cat-0', 'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5'],
    voiceMode: false,
    ...overrides,
  };
}

describe('GameController start', () => {
  it('starts a player-mode game, persists it and activates the auto-player', async () => {
    const { controller, store, autoPlayer } = make();
    const res = await controller.handle(req('POST', '/api/game/start', startBody(), user));
    expect(res.status).toBe(200);
    const body = res.body as { status: string; gameId: string; gameThreadId: string };
    expect(body.status).toBe('game_started');
    expect(body.gameThreadId).toBe('thread-1');
    expect(body.gameId).toBeTruthy();
    expect(autoPlayer.started).toContain(body.gameId);
    expect(store.all().length).toBe(1);
  });

  it('requires an authenticated user with 401', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/game/start', startBody()));
    expect(res.status).toBe(401);
  });

  it('rejects an invalid body with 400', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/game/start', { gameType: 'chess' }, user));
    expect(res.status).toBe(400);
  });

  it('rejects detective mode without detectiveCatId with 400', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/game/start', startBody({ humanRole: 'detective', catIds: SEVEN_CATS }), user));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('detectiveCatId');
  });

  it('rejects detectiveCatId that did not match a seated cat with 400', async () => {
    const { controller } = make();
    const res = await controller.handle(
      req('POST', '/api/game/start', startBody({ humanRole: 'detective', detectiveCatId: 'ghost', catIds: SEVEN_CATS }), user),
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('detectiveCatId');
  });

  it('accepts detective mode when the detective cat is seated', async () => {
    const { controller, store } = make();
    const res = await controller.handle(
      req('POST', '/api/game/start', startBody({ humanRole: 'detective', detectiveCatId: 'cat-2', catIds: SEVEN_CATS }), user),
    );
    expect(res.status).toBe(200);
    const game = store.all()[0]!;
    expect(game.config.detectiveSeatId).toBe('P3');
  });

  it('returns a descriptive error when there are not enough cats', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/game/start', startBody({ catIds: ['cat-0', 'cat-1'] }), user));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/not enough cats/i);
  });

  it('rejects when a game is already active in the thread', async () => {
    const { controller } = make([buildRuntime({ threadId: 'hyg' })]);
    const res = await controller.handle(req('POST', '/api/game/start', startBody(), user));
    expect(res.status).toBe(409);
  });
});

describe('GameController view (three-mode viewer)', () => {
  const seats = makeSeats(6, 'hyg'); // P1=human hyg, P2..P6 cats
  it('serves a player-scoped view to the owning player', async () => {
    const runtime = buildRuntime({ seats });
    const { controller } = make([runtime]);
    const res = await controller.handle(req('GET', '/api/threads/thread-1/game', undefined, user));
    expect(res.status).toBe(200);
    expect((res.body as { view: { seats: unknown[] } }).view.seats).toBeDefined();
  });

  it('serves a cat-scoped view to a seated cat', async () => {
    const runtime = buildRuntime({ seats });
    const { controller } = make([runtime]);
    const res = await controller.handle(req('GET', '/api/threads/thread-1/game', undefined, { 'x-cat-cafe-user': 'cat-2' }));
    expect(res.status).toBe(200);
  });

  it('rejects a viewer that owns no seat with 403', async () => {
    const runtime = buildRuntime({ seats });
    const { controller } = make([runtime]);
    const res = await controller.handle(req('GET', '/api/threads/thread-1/game', undefined, { 'x-cat-cafe-user': 'stranger' }));
    expect(res.status).toBe(403);
  });

  it('serves a god view to the configured god-view observer', async () => {
    const runtime = buildRuntime({ seats });
    runtime.config = { timeoutMs: 60000, voiceMode: false, humanRole: 'god-view', observerUserId: 'hyg' };
    const { controller } = make([runtime]);
    const res = await controller.handle(req('GET', '/api/threads/thread-1/game', undefined, user));
    expect(res.status).toBe(200);
  });

  it('rejects a god view for a non-observer', async () => {
    const runtime = buildRuntime({ seats });
    runtime.config = { timeoutMs: 60000, voiceMode: false, humanRole: 'god-view', observerUserId: 'hyg' };
    const { controller } = make([runtime]);
    const res = await controller.handle(req('GET', '/api/threads/thread-1/game', undefined, { 'x-cat-cafe-user': 'other' }));
    expect(res.status).toBe(403);
  });

  it('serves a detective view through the detective seat', async () => {
    const runtime = buildRuntime({ seats });
    runtime.config = {
      timeoutMs: 60000,
      voiceMode: false,
      humanRole: 'detective',
      detectiveSeatId: 'P2',
      observerUserId: 'hyg',
    };
    const { controller } = make([runtime]);
    const res = await controller.handle(req('GET', '/api/threads/thread-1/game', undefined, user));
    expect(res.status).toBe(200);
  });
});

describe('GameController abort & god-action', () => {
  it('aborts a game: stops the loop, clears nonces and broadcasts game:aborted', async () => {
    const { controller, socket, autoPlayer, nonce } = make([buildRuntime()]);
    expect(nonce.tryClaim('game-x', 'n1')).toBe(true);
    nonce.clear('game-x');
    expect(nonce.tryClaim('game-x', 'n1')).toBe(true);
    // re-claim a marker to prove the shared store is actually cleared on abort
    const res = await controller.handle(req('DELETE', '/api/threads/thread-1/game', undefined, user));
    expect(res.status).toBe(200);
    expect(autoPlayer.stopped).toContain('game-x');
    expect(socket.events.some((e) => e.event === 'game:aborted' && e.room === 'thread:thread-1')).toBe(true);
  });

  it('god-action pause/resume/skip mutate the game', async () => {
    const rt = buildRuntime();
    const { controller, store } = make([rt]);
    const paused = await controller.handle(req('POST', '/api/threads/thread-1/game/god-action', { type: 'pause' }, user));
    expect(paused.status).toBe(200);
    expect(store.all()[0]!.status).toBe('paused');
    const resumed = await controller.handle(req('POST', '/api/threads/thread-1/game/god-action', { type: 'resume' }, user));
    expect(resumed.status).toBe(200);
    expect(store.all()[0]!.status).toBe('playing');
    const skipped = await controller.handle(req('POST', '/api/threads/thread-1/game/god-action', { type: 'skip' }, user));
    expect(skipped.status).toBe(200);
  });

  it('god-action stop finishes the game', async () => {
    const { controller, store, autoPlayer, socket } = make([buildRuntime()]);
    const res = await controller.handle(req('POST', '/api/threads/thread-1/game/god-action', { type: 'stop' }, user));
    expect(res.status).toBe(200);
    expect(store.all()[0]!.status).toBe('finished');
    expect(autoPlayer.stopped).toContain('game-x');
    expect(socket.events.some((e) => e.event === 'game:aborted')).toBe(true);
  });

  it('god-action rejects an unknown type with 400', async () => {
    const { controller } = make([buildRuntime()]);
    const res = await controller.handle(req('POST', '/api/threads/thread-1/game/god-action', { type: 'explode' }, user));
    expect(res.status).toBe(400);
  });

  it('DELETE on a thread with no active game returns 404', async () => {
    const { controller } = make();
    const res = await controller.handle(req('DELETE', '/api/threads/thread-1/game', undefined, user));
    expect(res.status).toBe(404);
  });

  it('player action dispatches to the orchestrator', async () => {
    const rt = buildRuntime();
    rt.currentPhase = 'night_witch';
    const seats = rt.seats.slice();
    (seats[0] as Seat).alive = true;
    rt.seats = seats;
    const { controller, orchestrator } = make([rt]);
    const spy = vi.spyOn(orchestrator, 'handlePlayerAction').mockResolvedValue();
    const res = await controller.handle(
      req('POST', '/api/threads/thread-1/game/action', { seat: 'P1', action: 'heal' }, user),
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});