/**
 * Game action controller — low-level MCP callback route (S5-3).
 *
 * Port of clowder-ai `routes/game-actions.ts`: `POST /api/game/:gameId/action`
 * is the single endpoint that the MCP `collab/game-action` toolset callback hits.
 * It runs the full validation matrix (identity → ownership → thread isolation →
 * round/phase/seat/alive → nonce dedup) before dispatching to the engine's
 * {@link GameOrchestrator.handlePlayerAction}. Everything external (ownership,
 * nonce store) is an injected seam so the matrix is unit-testable offline.
 * @module @flowforge/api-rest-controllers/controllers/game-action
 */

import type { GameAction, Seat } from '@flowforge/cats-shared'
import { isSeatId } from '@flowforge/cats-shared'
import type { IGameStore } from '@flowforge/cats-games'
import type { GameOrchestrator } from '@flowforge/cats-games'
import { RestControllerBase, type HttpRequest } from '../ports/http.ts'
import {
  InMemoryNonceDeduplicator,
  type GameActionAuth,
  type NonceDeduplicator,
} from '../ports/game.ts'

/** Injected dependencies for the low-level game action route. */
export interface GameActionControllerOptions {
  /** Engine orchestrator — the sole fall-through destination after validation. */
  orchestrator: GameOrchestrator
  /** Game persistence (reads a runtime to validate round/phase/seat/alive). */
  gameStore: IGameStore
  /** Ownership assertion for the game's thread (MCP callback security gate). */
  ownership?: GameActionAuth
  /** Nonce store shared with the high-level controller; default in-memory. */
  nonce?: NonceDeduplicator
}

/** Successful low-level action submission. */
export interface GameActionResult {
  accepted: true
  deduplicated?: boolean
}

/** Body shape for `POST /api/game/:gameId/action` (MCP template bodyKeys). */
interface ActionRequestBody {
  round?: unknown
  phase?: unknown
  seat?: unknown
  action?: unknown
  target?: unknown
  text?: unknown
  nonce?: unknown
}

export class GameActionController extends RestControllerBase {
  private readonly orchestrator: GameOrchestrator
  private readonly gameStore: IGameStore
  private readonly ownership: GameActionAuth
  private readonly nonce: NonceDeduplicator

  constructor(opts: GameActionControllerOptions) {
    super()
    this.orchestrator = opts.orchestrator
    this.gameStore = opts.gameStore
    this.ownership =
      opts.ownership ?? { assertOwned: async () => ({ ok: true }) }
    this.nonce = opts.nonce ?? new InMemoryNonceDeduplicator()
    this.registerRoutes()
  }

  private registerRoutes(): void {
    this.post('/api/game/:gameId/action', (req) => this.handleAction(req))
  }

  private async handleAction(req: HttpRequest): Promise<{ status: number; headers?: Record<string, string>; body: unknown }> {
    const gameId = typeof req.params?.gameId === 'string' ? req.params.gameId : ''
    if (!gameId) return { status: 400, body: { error: 'gameId required', accepted: false } }

    // --- Identity headers (MCP transport must inject these; see completion criteria) ---
    const catId = req.headers['x-cat-id'] ?? ''
    const userId = req.headers['x-cat-cafe-user'] ?? req.headers['x-user-id'] ?? ''
    if (!catId) return { status: 401, body: { error: 'missing x-cat-id', accepted: false } }
    if (!userId) return { status: 401, body: { error: 'missing user identity', accepted: false } }

    // --- Body shape ---
    const body = req.body as ActionRequestBody | undefined
    if (!body || typeof body !== 'object') {
      return { status: 400, body: { error: 'malformed body', accepted: false } }
    }
    const round = body.round
    const phase = body.phase
    const seatIdRaw = body.seat
    const actionName = body.action
    const target = body.target
    const text = body.text
    const nonce = body.nonce
    if (typeof round !== 'number' || typeof phase !== 'string' || typeof seatIdRaw !== 'string') {
      return { status: 400, body: { error: 'round, phase and seat are required', accepted: false } }
    }
    if (typeof actionName !== 'string' || !actionName) {
      return { status: 400, body: { error: 'action is required', accepted: false } }
    }
    if (!isSeatId(seatIdRaw)) {
      return { status: 400, body: { error: `invalid seat: ${String(seatIdRaw)}`, accepted: false } }
    }
    const nonceStr = typeof nonce === 'string' && nonce ? nonce : 'default'

    // --- Resolve game runtime (authoritative source for round/phase/seats) ---
    const runtime = await this.gameStore.getGame(gameId)
    if (!runtime) return { status: 404, body: { error: `Game ${gameId} not found`, accepted: false } }

    // --- Ownership (host asserts the caller owns the thread) ---
    const ownership = await this.ownership.assertOwned(gameId, runtime.threadId, userId)
    if (!ownership.ok) {
      return { status: 403, body: { error: ownership.reason ?? 'forbidden', accepted: false } }
    }

    // --- Callback thread isolation ---
    const callbackThread = req.headers['x-callback-thread-id']
    if (callbackThread && callbackThread !== runtime.threadId) {
      return { status: 403, body: { error: 'thread mismatch', accepted: false } }
    }

    // --- Status / round / phase ---
    if (runtime.status !== 'playing') {
      return { status: 409, body: { error: `game is ${runtime.status} not playing`, accepted: false } }
    }
    if (round !== runtime.round) {
      return { status: 409, body: { error: `round mismatch: got ${round}, expected ${runtime.round}`, accepted: false } }
    }
    if (phase !== runtime.currentPhase) {
      return { status: 409, body: { error: `phase mismatch: got ${phase}, expected ${runtime.currentPhase}`, accepted: false } }
    }

    // --- Seat existence + actor binding + aliveness ---
    const seat: Seat | undefined = runtime.seats.find((s) => s.seatId === seatIdRaw)
    if (!seat) return { status: 400, body: { error: `seat ${seatIdRaw} not in game`, accepted: false } }
    if (seat.actorId !== catId) {
      return { status: 403, body: { error: `cat ${catId} does not own seat ${seatIdRaw}`, accepted: false } }
    }
    if (!seat.alive) return { status: 409, body: { error: `seat ${seatIdRaw} is not alive`, accepted: false } }

    // --- Nonce dedup: only claim (and dispatch) after all structural gates pass ---
    if (!this.nonce.tryClaim(gameId, nonceStr)) {
      const result: GameActionResult = { accepted: true, deduplicated: true }
      return { status: 200, body: result }
    }

    // --- Build domain action + dispatch to the engine ---
    const action: GameAction = { seatId: seat.seatId, actionName, submittedAt: Date.now() }
    if (target && typeof target === 'string' && isSeatId(target)) {
      action.targetSeat = target
    }
    const params: Record<string, unknown> = {}
    if (typeof text === 'string' && text) params.speechText = text
    if (Object.keys(params).length > 0) action.params = params

    try {
      await this.orchestrator.handlePlayerAction(gameId, seat.seatId, action)
    } catch (err) {
      return { status: 400, body: { error: (err as Error).message, accepted: false } }
    }

    return { status: 200, body: { accepted: true } satisfies GameActionResult }
  }
}