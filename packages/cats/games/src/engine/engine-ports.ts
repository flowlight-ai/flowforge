/**
 * Engine ports (S5-2c).
 *
 * Dependency seams for the game engine / orchestrator / auto-player. Ported from
 * clowder-ai `stores/ports/{GameStore,MessageStore}`, `game/gameSystemMessage.ts`
 * and `infrastructure/logger.ts`, but declared here as plain interfaces with
 * `noop`/nullable defaults so the engine layer stays pure and offline-testable.
 * Concrete persistence / socket / log wiring lands with S5-3.
 * @module @flowforge/cats-games/engine/engine-ports
 */

import type { GameRuntime } from '@flowforge/cats-shared'

/** Persistence port for game runtimes. */
export interface IGameStore {
  getGame(gameId: string): Promise<GameRuntime | undefined>
  createGame(runtime: GameRuntime): Promise<GameRuntime>
  updateGame(gameId: string, runtime: GameRuntime): Promise<void>
  /** Active (non-finished) games — used to recover auto-play loops at startup. */
  listActiveGames(): Promise<GameRuntime[]>
}

/** A stored thread message read/written by the message port. */
export interface StoredGameMessage {
  id: string
  catId?: string
  content: string
  threadId: string
  visibility?: string
  extra?: Record<string, unknown>
  timestamp: number
}

/** Message store port — dual-writes speeches/announcements. */
export interface IMessageStore {
  append(msg: {
    userId: string
    catId: string
    content: string
    mentions: string[]
    timestamp: number
    threadId: string
  }): Promise<StoredGameMessage>
  getByThread(threadId: string, limit?: number): Promise<StoredGameMessage[]>
}

/** Transport port — room broadcast + per-user emit (socket / SSE / mock). */
export interface SocketLike {
  broadcastToRoom(room: string, event: string, data: unknown): void
  emitToUser(userId: string, event: string, data: unknown): void
}

/** Structured logger port (defaults to a noop). */
export interface AppLogger {
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
  error(obj: Record<string, unknown>, msg: string): void
  debug(obj: Record<string, unknown>, msg: string): void
}

/** A logger that discards everything — the offline-testing default. */
export const noopAppLogger: AppLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

/** Narrow socket surface used by {@link appendGameSystemMessage}. */
interface NarrativeSocketLike {
  broadcastToRoom(room: string, event: string, data: unknown): void
}

/**
 * Append a system message to the message store (if provided) and broadcast it to
 * the thread's room. Ported from clowder `gameSystemMessage.ts`.
 */
export async function appendGameSystemMessage(params: {
  threadId: string
  content: string
  messageStore?: IMessageStore
  socketManager?: NarrativeSocketLike
  timestamp?: number
}): Promise<StoredGameMessage | null> {
  const timestamp = params.timestamp ?? Date.now()
  const stored = params.messageStore
    ? await Promise.resolve(
        params.messageStore.append({
          userId: 'system',
          catId: 'system',
          content: params.content,
          mentions: [],
          timestamp,
          threadId: params.threadId,
        }),
      )
    : null

  params.socketManager?.broadcastToRoom(`thread:${params.threadId}`, 'game:narrative', {
    threadId: params.threadId,
    message: {
      id: stored?.id ?? `game-system-${timestamp}`,
      type: 'system',
      content: params.content,
      timestamp,
    },
  })

  return stored
}