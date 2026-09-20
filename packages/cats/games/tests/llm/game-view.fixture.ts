/**
 * Minimal valid `GameView` fixtures for LLM-seam tests (S5-2a).
 * @module tests
 */

import type { GameView, SeatView } from '@flowforge/cats-shared'

/** A dead wolf teammate + an alive seer-villager mix for prompt assertions. */
export function makeSeat(overrides: Partial<SeatView> & { seatId: SeatView['seatId'] }): SeatView {
  return {
    actorType: 'cat',
    actorId: `cat-${overrides.seatId.toLowerCase()}`,
    displayName: overrides.seatId,
    alive: true,
    ...overrides,
  }
}

export interface MakeGameViewOptions {
  currentPhase?: string
  round?: number
  seats?: SeatView[]
  visibleEvents?: GameView['visibleEvents']
  humanRole?: 'player' | 'god-view' | 'detective'
}

export function makeGameView(options: MakeGameViewOptions = {}): GameView {
  return {
    gameId: 'g-1',
    threadId: 't-1',
    gameType: 'werewolf',
    status: 'playing',
    currentPhase: options.currentPhase ?? 'day_discuss',
    round: options.round ?? 1,
    seats: options.seats ?? [makeSeat({ seatId: 'P1', faction: 'wolf' }), makeSeat({ seatId: 'P2', faction: 'wolf' })],
    visibleEvents: options.visibleEvents ?? [],
    config: {
      timeoutMs: 60000,
      voiceMode: false,
      humanRole: options.humanRole ?? 'player',
    },
  }
}