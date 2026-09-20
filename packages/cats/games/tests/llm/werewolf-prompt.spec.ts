import { describe, it, expect } from 'vitest'
import { buildBaseContext, buildRoleSection, buildWerewolfPrompt } from '../../src/llm/werewolf-prompt.ts'
import { makeGameView, makeSeat } from './game-view.fixture.ts'

/** Unit tests for the shared werewolf prompt context. */
describe('buildBaseContext', () => {
  it('includes round, phase and alive players', () => {
    const ctx = buildBaseContext(makeGameView({ round: 3, currentPhase: 'night_action' }), 3)
    expect(ctx).toContain('Round 3')
    expect(ctx).toContain('phase: night_action')
    expect(ctx).toContain('Alive players: P1, P2')
  })

  it('lists dead players when present', () => {
    const view = makeGameView({ seats: [makeSeat({ seatId: 'P1' }), makeSeat({ seatId: 'P2', alive: false })] })
    expect(buildBaseContext(view, 1)).toContain('Dead players: P2')
  })

  it('omits the dead-players line when no one is dead', () => {
    const ctx = buildBaseContext(makeGameView(), 1)
    expect(ctx).not.toContain('Dead players')
  })

  it('renders visible events', () => {
    const view = makeGameView({
      visibleEvents: [{ eventId: 'e1', round: 1, phase: 'day_vote', type: 'vote_result', scope: 'public', payload: { target: 'P2' }, timestamp: 1 }],
    })
    const ctx = buildBaseContext(view, 1)
    expect(ctx).toContain('vote_result')
    expect(ctx).toContain('"target":"P2"')
  })
})

/** Unit tests for the per-role prompt dispatch. */
describe('buildRoleSection', () => {
  it('wolf prompt surfaces alive wolf teammates and night-kill goal', () => {
    const view = makeGameView({ seats: [makeSeat({ seatId: 'P1', faction: 'wolf' }), makeSeat({ seatId: 'P2', faction: 'wolf' }), makeSeat({ seatId: 'P3', faction: 'village' })] })
    const section = buildRoleSection('wolf', view)
    expect(section).toContain('wolf')
    expect(section).toContain('P1, P2')
    expect(section).toContain('choose a target to kill')
  })

  it('seer prompt embeds past divine results', () => {
    const view = makeGameView({
      visibleEvents: [{ eventId: 'e1', round: 1, phase: 'night_action', type: 'divine_result', scope: 'seat:P1', payload: { target: 'P3', result: 'wolf' }, timestamp: 1 }],
    })
    const section = buildRoleSection('seer', view)
    expect(section).toContain('divine results')
    expect(section).toContain('P3: wolf')
  })

  it('defaults an unknown role to the villager prompt', () => {
    const section = buildRoleSection('mason', makeGameView())
    expect(section).toContain('villager')
  })
})

/** Unit tests for the combined werewolf system prompt. */
describe('buildWerewolfPrompt', () => {
  it('combines base context and role section', () => {
    const prompt = buildWerewolfPrompt('seer', makeGameView({ round: 2 }), 2)
    expect(prompt).toContain('Round 2')
    expect(prompt).toContain('seer')
  })
})