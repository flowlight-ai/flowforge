import { describe, it, expect } from 'vitest'
import { WerewolfEngine } from '../../src/engine/werewolf-engine.ts'
import { makeRuntime } from './game.helpers.ts'

/**
 * Board: P1 wolf, P2 wolf, P3 seer, P4 witch, P5 villager, P6 hunter
 * (6-player default roles: 2 wolf / 1 seer / 1 witch / 2 villager — hunter overridden here).
 */
function runtime(props: { phase?: string; roleOf?: Record<string, string> } = {}) {
  const r = makeRuntime({
    roles: ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager'],
    currentPhase: props.phase ?? 'night_wolf',
  })
  return r
}

function engine(props?: { phase?: string }) {
  const r = runtime(props)
  return new WerewolfEngine(r)
}

describe('WerewolfEngine — night resolution', () => {
  it('unprotected wolf kill kills the target', () => {
    const e = engine()
    e.submitNightBallot('P1', 'P3')
    e.submitNightBallot('P2', 'P3')
    const result = e.resolveNight()
    expect(result.deaths).toContain('P3')
    expect(e.getRuntime().seats.find((s) => s.seatId === 'P3')!.alive).toBe(false)
  })

  it('tied wolf ballots produce no kill', () => {
    const e = engine()
    e.submitNightBallot('P1', 'P3')
    e.submitNightBallot('P2', 'P6')
    const result = e.resolveNight()
    expect(result.deaths).toHaveLength(0)
  })

  it('single guard saves the knife target', () => {
    const e = engine()
    e.submitNightBallot('P1', 'P5')
    e.submitNightBallot('P2', 'P5')
    e.setNightAction('P3', 'guard', 'P5')
    const result = e.resolveNight()
    expect(result.deaths).not.toContain('P5')
  })

  it('同守同救 (guard + witch heal same target) still dies', () => {
    const e = engine()
    e.submitNightBallot('P1', 'P5')
    e.submitNightBallot('P2', 'P5')
    e.setNightAction('P3', 'guard', 'P5')
    e.setNightAction('P4', 'heal', 'P5')
    const result = e.resolveNight()
    expect(result.deaths).toContain('P5')
  })

  it('records the guard last-guard-target for consecutive-night restriction', () => {
    const e = engine()
    e.setNightAction('P3', 'guard', 'P5')
    e.resolveNight()
    expect(e.getRuntime().seats.find((s) => s.seatId === 'P3')!.properties.lastGuardTarget).toBe('P5')
    expect(() => e.setNightAction('P3', 'guard', 'P5')).toThrow(/consecutive nights/)
  })

  it('witch self-heal is allowed on round 1 but not later', () => {
    const e = engine({ phase: 'night_witch' })
    e.getRuntime().round = 1
    expect(() => {
      e.setNightAction('P4', 'heal', 'P4')
      e.resolveNight()
    }).not.toThrow()
    e.getRuntime().round = 2
    expect(() => e.setNightAction('P4', 'heal', 'P4')).not.toThrow()
  })

  it('witch poison kills independently of the knife', () => {
    const e = engine()
    e.setNightAction('P4', 'poison', 'P6')
    const result = e.resolveNight()
    expect(result.deaths).toContain('P6')
  })

  it('hunter killed by knife can shoot; poisoned cannot', () => {
    // Board roles: P1 wolf, P2 wolf, P3 seer, P4 witch, P5 hunter, P6 villager.
    const byKnife = engine()
    byKnife.setNightAction('P4', 'poison', 'P1') // witch poisons a wolf; knives target P5 hunter
    byKnife.submitNightBallot('P1', 'P5')
    byKnife.submitNightBallot('P2', 'P5')
    expect(byKnife.resolveNight().hunterCanShoot).toBe(true)

    const byPoison = engine()
    byPoison.setNightAction('P4', 'poison', 'P5')
    byPoison.submitNightBallot('P1', 'P3')
    byPoison.submitNightBallot('P2', 'P3')
    expect(byPoison.resolveNight().hunterCanShoot).toBe(false)
  })
})

describe('WerewolfEngine — day votes & PK', () => {
  it('resolveDayVotes exiles the plurality target', () => {
    const r = runtime({ phase: 'day_vote' })
    const e = new WerewolfEngine(r)
    e.castDayVote('P1', 'P3')
    e.castDayVote('P2', 'P3')
    e.castDayVote('P5', 'P6')
    const result = e.resolveDayVotes()
    expect(result.exiled).toBe('P3')
    expect(r.seats.find((s) => s.seatId === 'P3')!.alive).toBe(false)
  })

  it('locked votes cannot change', () => {
    const r = runtime({ phase: 'day_vote' })
    const e = new WerewolfEngine(r)
    e.castDayVote('P1', 'P3')
    e.lockDayVote('P1')
    expect(() => e.castDayVote('P1', 'P5')).toThrow(/locked/)
  })

  it('allDayVotesLocked tracks the eligible (non-revealed-idiot) seats', () => {
    const r = runtime({ phase: 'day_vote' })
    const e = new WerewolfEngine(r)
    for (const seat of r.seats) e.castDayVote(seat.seatId, 'P3')
    for (const seat of r.seats) e.lockDayVote(seat.seatId)
    expect(e.allDayVotesLocked()).toBe(true)
  })

  it('a tied day vote surfaces PK candidates and exiles nobody', () => {
    const r = runtime({ phase: 'day_vote' })
    const e = new WerewolfEngine(r)
    // 6 seats: even → P3, odd → P5 → exactly 3 votes each.
    for (const seat of r.seats) {
      e.castVote(seat.seatId, Number(seat.seatId.slice(1)) % 2 === 0 ? 'P3' : 'P5')
    }
    const result = e.resolveVotes()
    expect(result.exiled).toBeNull()
    expect(result.tied).toBe(true)
    expect(result.pkCandidates.sort()).toEqual(['P3', 'P5'])
  })
})

describe('WerewolfEngine — exile & hunter', () => {
  it('idiots survive an exile and are marked revealed', () => {
    const r = makeRuntime({
      roles: ['wolf', 'wolf', 'idiot', 'witch', 'villager', 'villager'],
      currentPhase: 'day_vote',
    })
    const e = new WerewolfEngine(r)
    e.castDayVote('P1', 'P3')
    e.castDayVote('P2', 'P3')
    const result = e.resolveDayVotes()
    expect(result.exiled).toBe('P3')
    const seat = r.seats.find((s) => s.seatId === 'P3')!
    expect(seat.alive).toBe(true)
    expect(seat.properties.idiotRevealed).toBe(true)
  })

  it('hunterShoot kills a public target and logs the event', () => {
    const r = runtime({ phase: 'day_hunter' })
    const e = new WerewolfEngine(r)
    e.hunterShoot('P6', 'P1')
    expect(r.seats.find((s) => s.seatId === 'P1')!.alive).toBe(false)
    expect(r.eventLog.some((evt) => evt.type === 'hunter_shoot')).toBe(true)
  })

  it('recordSpeech and recordLastWords append public events', () => {
    const r = runtime({ phase: 'day_discuss' })
    const e = new WerewolfEngine(r)
    e.recordSpeech('P1', 'hello')
    e.recordLastWords('P1', 'bye')
    expect(r.eventLog.map((evt) => evt.type)).toEqual(['speech', 'last_words'])
  })
})

describe('WerewolfEngine — win conditions', () => {
  it('returns village when all wolves are dead', () => {
    const r = runtime()
    r.seats.find((s) => s.seatId === 'P1')!.alive = false
    r.seats.find((s) => s.seatId === 'P2')!.alive = false
    expect(new WerewolfEngine(r).checkWinCondition()).toBe('village')
  })

  it('returns wolf when wolves reach majority', () => {
    const r = runtime()
    // Kill all non-wolves except P5 (villager) — wolves 2 >= good 1.
    for (const id of ['P3', 'P4', 'P6', 'P5']) r.seats.find((s) => s.seatId === id)!.alive = false
    r.seats.find((s) => s.seatId === 'P5')!.alive = true
    expect(new WerewolfEngine(r).checkWinCondition()).toBe('wolf')
  })

  it('returns null while the game is in the balance', () => {
    const r = runtime()
    r.seats.find((s) => s.seatId === 'P1')!.alive = false
    expect(new WerewolfEngine(r).checkWinCondition()).toBeNull()
  })
})