/**
 * Shared fixtures + fakes for S5-2c engine tests (`tests/engine/*.spec.ts`).
 * @module tests
 */

import type { GameConfig, GameRuntime, PendingAction, Seat, SeatId } from '@flowforge/cats-shared'
import { createWerewolfDefinition } from '../../src/engine/werewolf-definition.ts'
import { noopAppLogger, type AppLogger, type IGameStore, type IMessageStore, type SocketLike, type StoredGameMessage } from '../../src/engine/engine-ports.ts'

/** Build a `Seat` with sane defaults (AI cat unless overridden). */
export function makeSeat(seatId: string, opts: { actorType?: Seat['actorType']; actorId?: string; role?: string; alive?: boolean; properties?: Record<string, unknown> } = {}): Seat {
  const id = seatId as SeatId
  return {
    seatId: id,
    actorType: opts.actorType ?? 'cat',
    actorId: opts.actorId ?? `cat-${seatId.toLowerCase()}`,
    role: opts.role ?? '',
    alive: opts.alive ?? true,
    properties: opts.properties ?? {},
  }
}

const DEFAULT_CONFIG: GameConfig = {
  timeoutMs: 30000,
  voiceMode: false,
  humanRole: 'player',
}

/** Build seats from a role list, all as alive AI cats. */
export function makeSeatsFromRoles(roles: string[]): Seat[] {
  return roles.map((role, i) => makeSeat(`P${i + 1}`, { role }))
}

export interface MakeRuntimeOptions {
  gameId?: string
  threadId?: string
  playerCount?: number
  seats?: Seat[]
  roles?: string[]
  currentPhase?: string
  round?: number
  status?: GameRuntime['status']
  winner?: string
  phaseStartedAt?: number
  eventLog?: GameRuntime['eventLog']
  pendingActions?: Record<string, PendingAction>
  config?: GameConfig
}

/** Build a werewolf `GameRuntime` (defaults to a valid 6-player board). */
export function makeRuntime(opts: MakeRuntimeOptions = {}): GameRuntime {
  const playerCount =
    opts.playerCount ?? (opts.seats?.length ?? opts.roles?.length ?? 6)
  const definition = createWerewolfDefinition(playerCount)
  const seats = opts.seats ?? (opts.roles ? makeSeatsFromRoles(opts.roles) : makeSeatsFromRoles(['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager']))
  const now = Date.now()

  const runtime: GameRuntime = {
    gameId: opts.gameId ?? 'g-1',
    threadId: opts.threadId ?? 't-1',
    gameType: definition.gameType,
    definition,
    seats,
    currentPhase: opts.currentPhase ?? definition.phases[0]!.name,
    round: opts.round ?? 1,
    eventLog: opts.eventLog ?? [],
    pendingActions: opts.pendingActions ?? {},
    status: opts.status ?? 'playing',
    config: opts.config ?? DEFAULT_CONFIG,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  if (opts.winner !== undefined) runtime.winner = opts.winner
  if (opts.phaseStartedAt !== undefined) runtime.phaseStartedAt = opts.phaseStartedAt
  return runtime
}

/** In-memory game store — records mutations by reference (matches orchestrator flow). */
export class InMemoryGameStore implements IGameStore {
  readonly games = new Map<string, GameRuntime>()
  constructor(seed: GameRuntime[] = []) {
    for (const g of seed) this.games.set(g.gameId, g)
  }
  async getGame(gameId: string): Promise<GameRuntime | undefined> {
    return this.games.get(gameId)
  }
  async createGame(runtime: GameRuntime): Promise<GameRuntime> {
    this.games.set(runtime.gameId, runtime)
    return runtime
  }
  async updateGame(gameId: string, runtime: GameRuntime): Promise<void> {
    this.games.set(gameId, runtime)
  }
  async listActiveGames(): Promise<GameRuntime[]> {
    return [...this.games.values()].filter((g) => g.status !== 'finished')
  }
}

/** Records every broadcast/emit for transport assertions. */
export class RecordingSocket implements SocketLike {
  readonly roomEvents: Array<{ room: string; event: string; data: unknown }> = []
  readonly userEvents: Array<{ userId: string; event: string; data: unknown }> = []
  broadcastToRoom(room: string, event: string, data: unknown): void {
    this.roomEvents.push({ room, event, data })
  }
  emitToUser(userId: string, event: string, data: unknown): void {
    this.userEvents.push({ userId, event, data })
  }
}

/** In-memory message store for dual-write / speech-context assertions. */
export class RecordingMessageStore implements IMessageStore {
  readonly messages: StoredGameMessage[] = []
  readonly byThread = new Map<string, StoredGameMessage[]>()
  async append(msg: { userId: string; catId: string; content: string; mentions: string[]; timestamp: number; threadId: string }): Promise<StoredGameMessage> {
    const stored: StoredGameMessage = {
      id: `m-${this.messages.length + 1}`,
      catId: msg.catId,
      content: msg.content,
      threadId: msg.threadId,
      timestamp: msg.timestamp,
    }
    this.messages.push(stored)
    const list = this.byThread.get(msg.threadId) ?? []
    list.push(stored)
    this.byThread.set(msg.threadId, list)
    return stored
  }
  async getByThread(threadId: string, limit?: number): Promise<StoredGameMessage[]> {
    const list = this.byThread.get(threadId) ?? []
    if (limit && limit > 0) return list.slice(-limit)
    return [...list]
  }
}

/** Collects all `action.submitted` seats/actions off a runtime's event log. */
export function submittedActions(runtime: GameRuntime): Array<{ seatId: string; actionName?: unknown }> {
  return runtime.eventLog
    .filter((e) => e.type === 'action.submitted')
    .map((e) => e.payload as { seatId: string; actionName?: unknown })
}

export function writesSpiedLogger(): AppLogger & { calls: Array<{ level: string; msg: string }> } {
  const calls: Array<{ level: string; msg: string }> = []
  const make = (level: string) => (_obj: Record<string, unknown>, msg: string): void => {
    calls.push({ level, msg })
  }
  return {
    calls,
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
  }
}

export { noopAppLogger }