import { describe, it, expect } from 'vitest'
import { GameViewBuilder } from '../../src/engine/game-view-builder.ts'
import { makeRuntime } from './game.helpers.ts'
import type { PendingAction } from '@flowforge/cats-shared'

function board(props?: { phase?: string; status?: 'lobby' | 'playing' | 'paused' | 'finished'; winner?: string; pending?: Record<string, PendingAction> }) {
  const r = makeRuntime({
    roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'],
    currentPhase: props?.phase ?? 'night_wolf',
    ...(props?.status !== undefined ? { status: props.status } : {}),
    ...(props?.winner !== undefined ? { winner: props.winner } : {}),
    ...(props?.pending !== undefined ? { pendingActions: props.pending } : {}),
  })
  return r
}

describe('GameViewBuilder.buildView', () => {
  it('god view exposes every role with per-seat actionStatus', () => {
    const pending: Record<string, PendingAction> = {
      P1: { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: 1, status: 'acted', requestedAt: 1 },
    }
    const view = GameViewBuilder.buildView(board({ phase: 'night_wolf', pending }), 'god')
    expect(view.seats).toHaveLength(6)
    const wolf = view.seats.find((s) => s.seatId === 'P1')!
    expect(wolf.role).toBe('wolf')
    expect(wolf.faction).toBe('wolf')
    expect(wolf.actionStatus).toBe('acted')
    // P2 (wolf, no pending) is expected to act at night_wolf → waiting.
    expect(view.seats.find((s) => s.seatId === 'P2')!.actionStatus).toBe('waiting')
    // P3 (seer) is not expected to act at night_wolf → no status exposed.
    expect(view.seats.find((s) => s.seatId === 'P3')!.actionStatus).toBeUndefined()
  })

  it('a player sees their own role and faction mates, and only public/own events', () => {
    const r = board({ phase: 'day_discuss' })
    const view = GameViewBuilder.buildView(r, 'P1') // P1 is wolf
    const p1 = view.seats.find((s) => s.seatId === 'P1')!
    expect(p1.role).toBe('wolf')
    // Faction mate P2 (wolf) sees roles; P3 (seer) does not.
    expect(view.seats.find((s) => s.seatId === 'P2')!.role).toBe('wolf')
    expect(view.seats.find((s) => s.seatId === 'P3')!.role).toBeUndefined()
  })

  it('dead players no longer see faction-scoped role info (no faction leak)', () => {
    const r = board({ phase: 'day_discuss' })
    r.seats.find((s) => s.seatId === 'P1')!.alive = false
    const view = GameViewBuilder.buildView(r, 'P1')
    expect(view.seats.find((s) => s.seatId === 'P2')!.role).toBeUndefined()
  })

  it('detective view inherits the bound seat perspective', () => {
    const r = board({ phase: 'day_discuss' })
    r.config.detectiveSeatId = 'P3' // bound to seer
    const view = GameViewBuilder.buildView(r, 'detective:P3')
    expect(view.seats.find((s) => s.seatId === 'P3')!.role).toBe('seer')
  })

  it('hasActed is hidden during night phases for third-party players', () => {
    const pending: Record<string, PendingAction> = {
      P1: { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: 1, status: 'acted', requestedAt: 1 },
    }
    const night = board({ phase: 'night_wolf', pending })
    const nightView = GameViewBuilder.buildView(night, 'P3')
    expect(nightView.seats.find((s) => s.seatId === 'P1')!.hasActed).toBeUndefined()
    // Own hasActed is visible even at night.
    expect(GameViewBuilder.buildView(night, 'P1').seats.find((s) => s.seatId === 'P1')!.hasActed).toBe(true)
  })

  it('aggregates action progress for non-god views', () => {
    const pending: Record<string, PendingAction> = {
      P1: { seatId: 'P1', actionName: 'kill', targetSeat: 'P3', submittedAt: 1, status: 'acted', requestedAt: 1 },
    }
    const view = GameViewBuilder.buildView(board({ phase: 'night_wolf', pending }), 'P3')
    expect(view.submittedCount).toBe(1)
    expect(view.totalExpected).toBe(2) // two wolves
  })

  it('attaches detailed stats to a finished view', () => {
    const r = board({ phase: 'day_exile', status: 'finished', winner: 'village' })
    r.eventLog.push({
      eventId: 'evt-1',
      round: 1,
      phase: 'night_wolf',
      type: 'action.submitted',
      scope: 'god',
      payload: { seatId: 'P1', actionName: 'kill', target: 'P3' },
      timestamp: Date.now(),
    })
    const view = GameViewBuilder.buildView(r, 'god')
    expect(view.winner).toBe('village')
    expect(view.gameStats?.winner).toBe('village')
    expect(view.gameStats?.players).toHaveLength(6)
    expect(view.gameStats?.players.find((p) => p.seatId === 'P1')!.killCount).toBe(1)
  })

  it('applies custom display-name enrichment', () => {
    const view = GameViewBuilder.buildView(board({ phase: 'day_discuss' }), 'P1', {
      displayName: (id) => `猫咪·${id}`,
    })
    // actorId is cat-p1 for P1 (default). Verify mapping applied.
    expect(view.seats.find((s) => s.seatId === 'P1')!.displayName).toBe('猫咪·cat-p1')
  })

  it('default display-name is identity', () => {
    const view = GameViewBuilder.buildView(board({ phase: 'day_discuss' }), 'P1')
    expect(view.seats.find((s) => s.seatId === 'P1')!.displayName).toBe('cat-p1')
  })
})