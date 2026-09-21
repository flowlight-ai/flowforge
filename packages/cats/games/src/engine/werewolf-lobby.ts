/**
 * Werewolf lobby (S5-2c).
 *
 * Faithful port of clowder-ai `werewolf/WerewolfLobby.ts`. Creates the initial
 * `GameRuntime` for a thread from a player list and randomizes role assignment
 * on {@link startGame}, emitting a seat-scoped `role_assigned` event per seat.
 * Pure — no I/O; persistence (S5-3) lives behind an injected store.
 * @module @flowforge/cats-games/engine/werewolf-lobby
 */

import type { GameEvent, GameRuntime, Seat } from '@flowforge/cats-shared'
import { createWerewolfDefinition, WEREWOLF_PRESETS } from './werewolf-definition.ts'

/** Seated player input for lobby creation. */
export interface LobbyInput {
  threadId: string
  playerCount: number
  players: Array<{ actorType: string; actorId: string }>
}

/** Builds the initial werewolf game runtime and starts role assignment. */
export class WerewolfLobby {
  createLobby(input: LobbyInput): GameRuntime {
    const { threadId, playerCount, players } = input

    if (!WEREWOLF_PRESETS[playerCount]) {
      throw new Error(`No preset for ${playerCount} players`)
    }

    const definition = createWerewolfDefinition(playerCount)

    const seats: Seat[] = players.map((p, i) => ({
      seatId: `P${i + 1}` as `P${number}`,
      actorType: p.actorType as 'human' | 'cat' | 'system',
      actorId: p.actorId,
      role: '',
      alive: true,
      properties: {},
    }))

    return {
      gameId: `game-${threadId}-${Date.now()}`,
      threadId,
      gameType: 'werewolf',
      definition,
      seats,
      currentPhase: 'lobby',
      round: 0,
      eventLog: [],
      pendingActions: {},
      status: 'lobby' as GameRuntime['status'],
      config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player' },
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  startGame(runtime: GameRuntime): void {
    const roles = this.buildRoleList(runtime)
    this.shuffle(roles)

    // Assign roles to seats
    for (let i = 0; i < runtime.seats.length; i++) {
      const seat = runtime.seats[i]
      const role = roles[i]
      if (!seat || !role) continue
      seat.role = role
    }

    // Emit scoped role_assigned events
    let eventCounter = runtime.eventLog.length
    for (const seat of runtime.seats) {
      eventCounter++
      const event: GameEvent = {
        eventId: `evt-${eventCounter}`,
        round: 1,
        phase: 'role_assignment',
        type: 'role_assigned',
        scope: `seat:${seat.seatId}`,
        payload: { seatId: seat.seatId, role: seat.role },
        timestamp: Date.now(),
      }
      runtime.eventLog.push(event)
    }

    // Transition to playing
    runtime.status = 'playing'
    runtime.currentPhase = runtime.definition.phases[0]?.name ?? 'night_guard'
    runtime.round = 1
    runtime.updatedAt = Date.now()
    runtime.version++
  }

  private buildRoleList(runtime: GameRuntime): string[] {
    const preset = WEREWOLF_PRESETS[runtime.seats.length]
    if (!preset) throw new Error(`No preset for ${runtime.seats.length} players`)

    const roles: string[] = []
    for (const [roleName, count] of Object.entries(preset.roles)) {
      for (let i = 0; i < count; i++) {
        roles.push(roleName)
      }
    }
    return roles
  }

  private shuffle(arr: string[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const a = arr[i]
      const b = arr[j]
      if (a === undefined || b === undefined) continue
      arr[i] = b
      arr[j] = a
    }
  }
}