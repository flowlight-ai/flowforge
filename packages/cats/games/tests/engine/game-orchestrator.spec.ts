import { describe, it, expect, vi } from 'vitest'
import { GameOrchestrator } from '../../src/engine/game-orchestrator.ts'
import { createWerewolfDefinition } from '../../src/engine/werewolf-definition.ts'
import { InMemoryGameStore, makeRuntime, makeSeatsFromRoles, RecordingSocket, RecordingMessageStore } from './game.helpers.ts'
import type { GameAction, GameConfig } from '@flowforge/cats-shared'

const CONFIG: GameConfig = { timeoutMs: 30000, voiceMode: false, humanRole: 'player' }

function newOrchestrator(seed: GameRuntime[]) {
  const store = new InMemoryGameStore(seed)
  const socket = new RecordingSocket()
  const orchestrator = new GameOrchestrator({ gameStore: store, socketManager: socket })
  return { store, socket, orchestrator }
}

describe('GameOrchestrator', () => {
  it('startGame creates a playing runtime, skips empty phases, and broadcasts', async () => {
    const { store, socket, orchestrator } = newOrchestrator([])
    const def = createWerewolfDefinition(6) // no guard role → night_guard auto-skipped
    const runtime = await orchestrator.startGame({
      threadId: 't-1',
      definition: def,
      seats: makeSeatsFromRoles(def.roles.map((r) => r.name)),
      config: CONFIG,
    })
    expect(runtime.status).toBe('playing')
    expect(runtime.currentPhase).toBe('night_wolf') // night_guard skipped (no guard on 6p)
    expect(await store.getGame(runtime.gameId)).toBeDefined()
    expect(socket.roomEvents.some((e) => e.event === 'game:started')).toBe(true)
  })

  it('handlePlayerAction records a pending action and broadcasts scoped views', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const { socket, orchestrator } = newOrchestrator([r])
    const action: GameAction = { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: Date.now() }
    await orchestrator.handlePlayerAction('g-1', 'P1', action)
    expect(r.seats.length).toBe(6)
    // One emit per seat.
    expect(socket.userEvents.filter((e) => e.event === 'game:state_update')).toHaveLength(6)
    expect(r.eventLog.some((e) => e.type === 'action.submitted' && e.payload.seatId === 'P1')).toBe(true)
  })

  it('collecting all night_wolf actions advances to night_seer', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const { orchestrator } = newOrchestrator([r])
    await orchestrator.handlePlayerAction('g-1', 'P1', { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: 1 })
    expect(r.currentPhase).toBe('night_wolf') // still waiting for P2
    await orchestrator.handlePlayerAction('g-1', 'P2', { seatId: 'P2', actionName: 'kill', targetSeat: 'P5', submittedAt: 2 })
    expect(r.currentPhase).toBe('night_seer')
    expect(r.eventLog.some((e) => e.type === 'phase_start' && e.payload.to === 'night_seer')).toBe(true)
  })

  it('speak actions dual-write to an injected messageStore', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'day_discuss' })
    const messages = new RecordingMessageStore()
    const socket = new RecordingSocket()
    const orchestrator = new GameOrchestrator({ gameStore: new InMemoryGameStore([r]), socketManager: socket, messageStore: messages })
    await orchestrator.handlePlayerAction('g-1', 'P1', {
      seatId: 'P1',
      actionName: 'speak',
      params: { speechText: '我怀疑P3' },
      submittedAt: 1,
    })
    // Give the fire-and-forget dual-write a chance to flush.
    await vi.waitFor(() => expect(messages.messages.length).toBeGreaterThan(0))
    expect(messages.messages[0]!.catId).toBe('cat-p1')
    expect(r.eventLog.some((e) => e.type === 'speech')).toBe(true)
  })

  it('forceSettle applies fallbacks for pending timeouts', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf', round: 2 })
    const { orchestrator } = newOrchestrator([r])
    await orchestrator.forceSettle('g-1', 'night_wolf')
    expect(r.eventLog.some((e) => e.type === 'action.fallback')).toBe(true)
    // Advanced past night_wolf to night_seer.
    expect(r.currentPhase).toBe('night_seer')
  })

  it('pause/resume/skipPhase mutate status and broadcast', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const { store, socket, orchestrator } = newOrchestrator([r])
    await orchestrator.pauseGame('g-1')
    expect(await store.getGame('g-1')).toMatchObject({ status: 'paused' })
    expect(socket.roomEvents.some((e) => e.event === 'game:paused')).toBe(true)

    await orchestrator.resumeGame('g-1')
    expect(await store.getGame('g-1')).toMatchObject({ status: 'playing' })
    expect(socket.roomEvents.some((e) => e.event === 'game:resumed')).toBe(true)

    await orchestrator.skipPhase('g-1')
    expect(await store.getGame('g-1')).toMatchObject({ currentPhase: 'night_seer' })
    expect((await store.getGame('g-1'))!.eventLog.some((e) => e.type === 'god_skip')).toBe(true)
  })

  it('resolving the last wolf kills on night_resolve finishes the village win', async () => {
    const r = makeRuntime({
      roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'hunter'],
      currentPhase: 'night_resolve',
      round: 1,
    })
    r.seats.find((s) => s.seatId === 'P1')!.alive = false // one wolf already dead
    r.eventLog.push({
      eventId: 'evt-kill',
      round: 1,
      phase: 'night_wolf',
      type: 'action.submitted',
      scope: 'god',
      payload: { seatId: 'P1', actionName: 'kill', target: 'P2' },
      timestamp: Date.now(),
    })

    const onGameEnd = vi.fn()
    const socket = new RecordingSocket()
    const orchestrator = new GameOrchestrator({
      gameStore: new InMemoryGameStore([r]),
      socketManager: socket,
      onGameEnd,
    })

    await orchestrator.forceSettle('g-1', 'night_resolve')

    expect(r.status).toBe('finished')
    expect(r.winner).toBe('village')
    expect(socket.roomEvents.some((e) => e.event === 'game:finished')).toBe(true)
    expect(onGameEnd).toHaveBeenCalledWith('g-1')
  })
})