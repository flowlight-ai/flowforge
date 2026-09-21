import { describe, it, expect } from 'vitest'
import { GameEngine } from '../../src/engine/game-engine.ts'
import { makeRuntime } from './game.helpers.ts'
import type { GameAction } from '@flowforge/cats-shared'

function nightWolfRuntime() {
  return makeRuntime({
    roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'],
    currentPhase: 'night_wolf',
  })
}

describe('GameEngine', () => {
  it('appends auto-incrementing events to the runtime log', () => {
    const runtime = nightWolfRuntime()
    const engine = new GameEngine(runtime)
    engine.appendEvent({ round: 1, phase: 'night_wolf', type: 'probe', scope: 'public', payload: {} })
    expect(runtime.eventLog).toHaveLength(1)
    expect(runtime.eventLog[0]!.eventId).toBe('evt-1')
    engine.appendEvent({ round: 1, phase: 'night_wolf', type: 'probe2', scope: 'public', payload: {} })
    expect(runtime.eventLog[1]!.eventId).toBe('evt-2')
  })

  it('submitAction accepts a valid phase+role action', () => {
    const runtime = nightWolfRuntime()
    const engine = new GameEngine(runtime)
    const action: GameAction = { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: Date.now() }
    engine.submitAction('P1', action)
    expect(runtime.pendingActions['P1']).toMatchObject({ actionName: 'kill', status: 'waiting' })
  })

  it('submitAction rejects a dead seat', () => {
    const runtime = nightWolfRuntime()
    runtime.seats[0]!.alive = false
    const engine = new GameEngine(runtime)
    expect(() =>
      engine.submitAction('P1', { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: Date.now() }),
    ).toThrow(/not alive/)
  })

  it('submitAction rejects wrong-phase and wrong-role actions', () => {
    const engine = new GameEngine(nightWolfRuntime())
    expect(() =>
      engine.submitAction('P1', { seatId: 'P1', actionName: 'divine', targetSeat: 'P2', submittedAt: Date.now() }),
    ).toThrow(/not allowed in phase|not allowed for role/)
  })

  it('allActionsCollected reports true once every expected actor has submitted', () => {
    const runtime = nightWolfRuntime() // night_wolf acting role = wolf
    const engine = new GameEngine(runtime)
    expect(engine.allActionsCollected()).toBe(false)
    engine.submitAction('P1', { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: Date.now() })
    expect(engine.allActionsCollected()).toBe(false)
    engine.submitAction('P2', { seatId: 'P2', actionName: 'kill', targetSeat: 'P5', submittedAt: Date.now() })
    expect(engine.allActionsCollected()).toBe(true)
  })

  it('clearPendingActions empties the pending map', () => {
    const engine = new GameEngine(nightWolfRuntime())
    engine.submitAction('P1', { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: Date.now() })
    engine.clearPendingActions()
    expect(engine.getRuntime().pendingActions).toEqual({})
  })

  it('base checkWinCondition returns null (subclass overrides)', () => {
    expect(new GameEngine(nightWolfRuntime()).checkWinCondition()).toBeNull()
  })

  it('getVisibleEvents hides god-scoped events from players but shows public ones', () => {
    const runtime = nightWolfRuntime()
    const engine = new GameEngine(runtime)
    engine.appendEvent({ round: 1, phase: 'night_wolf', type: 'secret', scope: 'god', payload: {} })
    engine.appendEvent({ round: 1, phase: 'night_wolf', type: 'notice', scope: 'public', payload: {} })
    expect(engine.getVisibleEvents('P1').map((e) => e.type)).toEqual(['notice'])
    expect(engine.getVisibleEvents('god').map((e) => e.type).sort()).toEqual(['notice', 'secret'])
  })

  it('getVisibleEvents shows faction-scoped events only to faction members', () => {
    const runtime = nightWolfRuntime()
    const engine = new GameEngine(runtime)
    engine.appendEvent({ round: 1, phase: 'night_wolf', type: 'intel', scope: 'faction:wolf', payload: {} })
    expect(engine.getVisibleEvents('P1').some((e) => e.type === 'intel')).toBe(true) // P1 is wolf
    expect(engine.getVisibleEvents('P3').some((e) => e.type === 'intel')).toBe(false) // P3 is seer
  })
})