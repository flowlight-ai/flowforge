/**
 * Game controller — high-level lifecycle routes (S5-3).
 *
 * Port of clowder-ai `routes/games.ts`: thread-scoped game lifecycle.
 *   POST   /api/game/start              — create a game (thread + lobby + orchestrator)
 *   GET    /api/threads/:threadId/game  — scoped live view (god / player / detective)
 *   POST   /api/threads/:threadId/game/action    — high-level player action
 *   DELETE /api/threads/:threadId/game           — abort (stop auto-player, clear nonces)
 *   POST   /api/threads/:threadId/game/god-action — pause / resume / skip / stop
 *
 * Identity, thread creation, allowed-cat resolution, nonce store and the auto-player
 * surface are injected seams, so the whole lifecycle is exercisable offline with fakes.
 * @module @flowforge/api-rest-controllers/controllers/game
 */

import { z } from 'zod'
import type { GameAction, GameConfig, GameRuntime, GameView, SeatId } from '@flowforge/cats-shared'
import { createGameAutoPlayerFactory, type GameAutoPlayerFactory } from '@flowforge/cats-games'
import {
  GameOrchestrator,
  GameViewBuilder,
  GameAutoPlayer,
  WerewolfLobby,
  buildGameSeats,
  gameStartSchema,
} from '@flowforge/cats-games'
import type { IGameStore, SocketLike } from '@flowforge/cats-games'
import { RestControllerBase, type HttpRequest } from '../ports/http.ts'
import {
  InMemoryNonceDeduplicator,
  type AutoPlayerSurface,
  type GameThreadHostSeam,
  type NonceDeduplicator,
} from '../ports/game.ts'

const DEFAULT_TIMEOUT_MS = 60000

/** Injected dependencies for the high-level game lifecycle routes. */
export interface GameControllerOptions {
  /** Engine orchestrator — start / action / pause / resume / skip all land here. */
  orchestrator: GameOrchestrator
  /** Game persistence. */
  gameStore: IGameStore
  /** Transport port — room broadcast for lifecycle announcements. */
  sockets: SocketLike
  /** Host-provided thread lifecycle (create / play-mode / pin). Required. */
  hostThreads: GameThreadHostSeam
  /** Resolve the set of cat ids the user may seat (whitelist). */
  resolveAllowedCatIds?: (userId: string) => Promise<string[]>
  /** Nonce store shared with the low-level controller; default in-memory. */
  nonce?: NonceDeduplicator
  /** Auto-player surface; defaults to a `GameAutoPlayer` over the params. */
  autoPlayer?: AutoPlayerSurface
}

/** Response shape for a successful game start. */
export interface GameStartResult {
  status: 'game_started'
  gameId: string
  gameThreadId: string
}

/** Parsed body for a high-level player action. */
const actionSchema = z.object({
  seat: z.string().regex(/^P\d+$/),
  action: z.string().min(1),
  target: z.string().optional(),
  text: z.string().optional(),
})
type ActionInput = z.infer<typeof actionSchema>

/** Parsed body for the god-action endpoint. */
const godActionSchema = z.object({
  type: z.enum(['pause', 'resume', 'skip', 'stop']),
})
type GodActionInput = z.infer<typeof godActionSchema>

export class GameController extends RestControllerBase {
  private readonly orchestrator: GameOrchestrator
  private readonly gameStore: IGameStore
  private readonly sockets: SocketLike
  private readonly hostThreads: GameThreadHostSeam
  private readonly resolveAllowedCatIds: ((userId: string) => Promise<string[]>) | undefined
  private readonly nonce: NonceDeduplicator
  private readonly autoPlayer: AutoPlayerSurface

  constructor(opts: GameControllerOptions) {
    super()
    this.orchestrator = opts.orchestrator
    this.gameStore = opts.gameStore
    this.sockets = opts.sockets
    this.hostThreads = opts.hostThreads
    this.resolveAllowedCatIds = opts.resolveAllowedCatIds
    this.nonce = opts.nonce ?? new InMemoryNonceDeduplicator()
    this.autoPlayer = opts.autoPlayer ?? this.defaultAutoPlayer()
    this.registerRoutes()
  }

  /** Default auto-player built from env-backed factory (S5-3 composition). */
  private defaultAutoPlayer(): AutoPlayerSurface {
    const factory: GameAutoPlayerFactory = createGameAutoPlayerFactory(
      process.env as Record<string, string | undefined>,
    )
    return new GameAutoPlayer({
      gameStore: this.gameStore,
      orchestrator: this.orchestrator,
      aiPlayerFactory: factory,
    })
  }

  private registerRoutes(): void {
    this.post('/api/game/start', (req) => this.startGame(req))
    this.get('/api/threads/:threadId/game', (req) => this.viewGame(req))
    this.post('/api/threads/:threadId/game/action', (req) => this.playerAction(req))
    this.delete('/api/threads/:threadId/game', (req) => this.abortGame(req))
    this.post('/api/threads/:threadId/game/god-action', (req) => this.godAction(req))
  }

  // ── POST /api/game/start ─────────────────────────────────────────────────

  private async startGame(req: HttpRequest): Promise<{ status: number; body: unknown }> {
    const userId = req.headers['x-cat-cafe-user'] ?? req.headers['x-user-id'] ?? ''
    if (!userId) return { status: 401, body: { error: 'missing user identity' } }

    const parsed = gameStartSchema.safeParse(req.body)
    if (!parsed.success) return { status: 400, body: { error: 'invalid body', details: parsed.error.issues } }
    const input = parsed.data

    // Whitelist + dedup the requested cats (unless the host provides an allowed set).
    let allowed = input.catIds
    if (this.resolveAllowedCatIds) {
      const available = await this.resolveAllowedCatIds(userId)
      allowed = input.catIds.filter((id) => available.includes(id))
    }
    const deduped = [...new Set(allowed)]
    if (deduped.length === 0) {
      return { status: 400, body: { error: 'not enough cats: no available cats to seat' } }
    }

    // Detective mode requires a cat perspective seat up front.
    if (input.humanRole === 'detective' && !input.detectiveCatId) {
      return { status: 400, body: { error: 'detective mode requires detectiveCatId' } }
    }

    // Reject if the user already has an active game in this thread.
    const requestedThread = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined
    const active = await this.findActiveGameByThread(requestedThread ?? userId)
    if (active) return { status: 409, body: { error: 'a game is already active in this thread' } }

    // Host-thread lifecycle.
    const thread = await this.hostThreads.createThread(userId, 'Werewolf Game', '/game')
    await this.hostThreads.setPlayMode(thread.id)
    await this.hostThreads.setPin(thread.id, true)
    const threadId = thread.id

    // Seat assignment (throws descriptive errors for insufficient cats).
    let seats
    try {
      seats = buildGameSeats({
        humanRole: input.humanRole,
        userId,
        catIds: deduped,
        playerCount: input.playerCount,
      })
    } catch (err) {
      await this.hostThreads.setPin(threadId, false)
      return { status: 400, body: { error: (err as Error).message } }
    }

    // Detective mode: the detective cat must land on a seat.
    let detectiveSeatId: SeatId | undefined
    if (input.humanRole === 'detective') {
      const dCatId = input.detectiveCatId ?? ''
      const hit = seats.find((s) => s.actorId === dCatId)
      if (!hit) {
        await this.hostThreads.setPin(threadId, false)
        return { status: 400, body: { error: 'detectiveCatId did not match a seated cat' } }
      }
      detectiveSeatId = hit.seatId
    }

    // Create a lobby runtime to assign roles, then hand off to the orchestrator.
    const lobby = new WerewolfLobby()
    const lobbyRuntime = lobby.createLobby({
      threadId,
      playerCount: seats.length,
      players: seats.map((s) => ({ actorType: s.actorType, actorId: s.actorId })),
    })
    lobby.startGame(lobbyRuntime)

    const config: GameConfig = this.buildConfig(input, userId, detectiveSeatId)

    const runtime = await this.orchestrator.startGame({
      threadId,
      definition: lobbyRuntime.definition,
      seats: lobbyRuntime.seats,
      config,
    })

    this.autoPlayer.startLoop(runtime.gameId)

    const result: GameStartResult = { status: 'game_started', gameId: runtime.gameId, gameThreadId: threadId }
    return { status: 200, body: result }
  }

  private buildConfig(input: z.infer<typeof gameStartSchema>, userId: string, detectiveSeatId?: SeatId): GameConfig {
    const config: GameConfig = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      voiceMode: input.voiceMode,
      humanRole: input.humanRole,
    }
    if (input.humanRole === 'player') config.humanSeat = 'P1'
    if (input.humanRole !== 'player') config.observerUserId = userId
    if (detectiveSeatId !== undefined) config.detectiveSeatId = detectiveSeatId
    return config
  }

  // ── GET /api/threads/:threadId/game ──────────────────────────────────────

  private async viewGame(req: HttpRequest): Promise<{ status: number; body: unknown }> {
    const threadId = typeof req.params?.threadId === 'string' ? req.params.threadId : ''
    const userId = req.headers['x-cat-cafe-user'] ?? req.headers['x-user-id'] ?? ''
    if (!threadId) return { status: 400, body: { error: 'threadId required' } }
    if (!userId) return { status: 401, body: { error: 'missing user identity' } }

    const runtime = await this.getActiveGameByThread(threadId)
    if (!runtime) return { status: 404, body: { error: 'no active game in thread' } }

    const viewer = this.resolveViewer(runtime, userId)
    if (!viewer.ok) return { status: 403, body: { error: viewer.reason } }

    const view: GameView = GameViewBuilder.buildView(
      runtime,
      viewer.viewer as SeatId | 'god' | `detective:${string}`,
    )
    return { status: 200, body: { gameId: runtime.gameId, view } }
  }

  /** Resolve the scoped viewer for a requesting user; rejects cross-access. */
  private resolveViewer(
    runtime: GameRuntime,
    userId: string,
  ): { ok: true; viewer: SeatId | 'god' | `detective:${string}` } | { ok: false; reason: string } {
    const { humanRole, detectiveSeatId, observerUserId } = runtime.config
    if (humanRole === 'player') {
      const ownSeat = runtime.seats.find((s) => s.actorId === userId)
      if (!ownSeat) return { ok: false, reason: 'not a player in this game' }
      return { ok: true, viewer: ownSeat.seatId }
    }
    if (observerUserId && observerUserId !== userId) {
      return { ok: false, reason: 'observer identity mismatch' }
    }
    if (humanRole === 'detective' && detectiveSeatId) {
      return { ok: true, viewer: `detective:${detectiveSeatId}` }
    }
    return { ok: true, viewer: 'god' }
  }

  // ── POST /api/threads/:threadId/game/action ──────────────────────────────

  private async playerAction(req: HttpRequest): Promise<{ status: number; body: unknown }> {
    const threadId = typeof req.params?.threadId === 'string' ? req.params.threadId : ''
    if (!threadId) return { status: 400, body: { error: 'threadId required' } }
    const parsed = actionSchema.safeParse(req.body)
    if (!parsed.success) return { status: 400, body: { error: 'invalid action body' } }
    const input: ActionInput = parsed.data

    const runtime = await this.getActiveGameByThread(threadId)
    if (!runtime) return { status: 404, body: { error: 'no active game in thread' } }
    if (runtime.status !== 'playing') return { status: 409, body: { error: 'game is not playing' } }

    const seat = runtime.seats.find((s) => s.seatId === input.seat)
    if (!seat) return { status: 400, body: { error: `seat ${input.seat} not in game` } }

    const action: GameAction = { seatId: seat.seatId as SeatId, actionName: input.action, submittedAt: Date.now() }
    if (input.target) action.targetSeat = input.target as SeatId
    if (input.text) action.params = { speechText: input.text }

    try {
      await this.orchestrator.handlePlayerAction(runtime.gameId, seat.seatId, action)
    } catch (err) {
      return { status: 400, body: { error: (err as Error).message } }
    }
    return { status: 200, body: { accepted: true } }
  }

  // ── DELETE /api/threads/:threadId/game ──────────────────────────────────

  private async abortGame(req: HttpRequest): Promise<{ status: number; body: unknown }> {
    const threadId = typeof req.params?.threadId === 'string' ? req.params.threadId : ''
    if (!threadId) return { status: 400, body: { error: 'threadId required' } }

    const runtime = await this.getActiveGameByThread(threadId)
    if (!runtime) return { status: 404, body: { error: 'no active game in thread' } }

    this.autoPlayer.stopLoop(runtime.gameId)
    this.nonce.clear(runtime.gameId)

    if (runtime.status !== 'finished') {
      runtime.status = 'finished'
      runtime.updatedAt = Date.now()
      await this.gameStore.updateGame(runtime.gameId, runtime)
    }

    this.sockets.broadcastToRoom(`thread:${threadId}`, 'game:aborted', { gameId: runtime.gameId, timestamp: Date.now() })
    await this.hostThreads.setPin(threadId, false)

    return { status: 200, body: { ok: true, gameId: runtime.gameId } }
  }

  // ── POST /api/threads/:threadId/game/god-action ─────────────────────────

  private async godAction(req: HttpRequest): Promise<{ status: number; body: unknown }> {
    const threadId = typeof req.params?.threadId === 'string' ? req.params.threadId : ''
    if (!threadId) return { status: 400, body: { error: 'threadId required' } }
    const parsed = godActionSchema.safeParse(req.body)
    if (!parsed.success) return { status: 400, body: { error: 'unknown god-action type' } }

    const runtime = await this.getActiveGameByThread(threadId)
    if (!runtime) return { status: 404, body: { error: 'no active game in thread' } }
    const gameId = runtime.gameId

    const input: GodActionInput = parsed.data
    switch (input.type) {
      case 'pause': {
        await this.orchestrator.pauseGame(gameId)
        return { status: 200, body: { ok: true, gameId, status: 'paused' } }
      }
      case 'resume': {
        await this.orchestrator.resumeGame(gameId)
        return { status: 200, body: { ok: true, gameId, status: 'playing' } }
      }
      case 'skip': {
        await this.orchestrator.skipPhase(gameId)
        return { status: 200, body: { ok: true, gameId, status: 'skipped' } }
      }
      case 'stop': {
        this.autoPlayer.stopLoop(gameId)
        this.nonce.clear(gameId)
        runtime.status = 'finished'
        runtime.updatedAt = Date.now()
        await this.gameStore.updateGame(gameId, runtime)
        this.sockets.broadcastToRoom(`thread:${threadId}`, 'game:aborted', { gameId, timestamp: Date.now() })
        await this.hostThreads.setPin(threadId, false)
        return { status: 200, body: { ok: true, gameId, status: 'finished' } }
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findActiveGameByThread(threadId: string): Promise<GameRuntime | null> {
    const active = await this.gameStore.listActiveGames()
    return active.find((g) => g.threadId === threadId) ?? null
  }

  private async getActiveGameByThread(threadId: string): Promise<GameRuntime | null> {
    return this.findActiveGameByThread(threadId)
  }
}