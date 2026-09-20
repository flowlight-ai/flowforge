import { describe, it, expect } from 'vitest'
import { GameWerewolfAIPlayer } from '../../src/llm/ai-player.ts'
import { GameLlmInvariantViolation } from '../../src/llm/ai-provider.ts'
import { ScriptedGameAIProvider } from '../../src/llm/ai-provider-fakes.ts'
import { makeGameView } from './game-view.fixture.ts'

describe('GameWerewolfAIPlayer', () => {
  it('decideNightAction shapes a validated LLM action into a GameAction', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: 'kill', targetSeat: 'P2' }] })
    const player = new GameWerewolfAIPlayer(provider)
    const action = await player.decideNightAction('P1', 'wolf', makeGameView(), 1)

    expect(action.actionName).toBe('kill')
    expect(action.targetSeat).toBe('P2')
    expect(provider.actionCalls).toHaveLength(1)
    expect(provider.actionCalls[0]!.prompt).toContain('Choose your night action')
  })

  it('decideNightAction accepts an action without a target seat', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: 'skip' }] })
    const player = new GameWerewolfAIPlayer(provider)
    const action = await player.decideNightAction('P1', 'wolf', makeGameView(), 1)
    expect(action.actionName).toBe('skip')
    expect(action.targetSeat).toBeUndefined()
  })

  it('decideVote crafts a vote action', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: 'vote', targetSeat: 'P3' }] })
    const player = new GameWerewolfAIPlayer(provider)
    const action = await player.decideVote('P2', 'villager', makeGameView(), 1)
    expect(action.actionName).toBe('vote')
    expect(action.targetSeat).toBe('P3')
    expect(provider.actionCalls[0]!.prompt).toContain('vote for exile')
  })

  it('decideSpeech returns the LLM speech line verbatim', async () => {
    const provider = new ScriptedGameAIProvider({ speeches: ['I suspect P3.'] })
    const player = new GameWerewolfAIPlayer(provider)
    const text = await player.decideSpeech('P1', 'seer', makeGameView(), 1)
    expect(text).toBe('I suspect P3.')
    expect(provider.speechCalls[0]!.prompt).toContain('discussion phase')
  })

  it('decideSpeechWithFormat tags kind=text by default and audio in voice mode', async () => {
    const provider = new ScriptedGameAIProvider({ speeches: ['hello', 'hello'] })
    const player = new GameWerewolfAIPlayer(provider)
    expect(await player.decideSpeechWithFormat('P1', 'seer', makeGameView(), 1, false)).toEqual({
      kind: 'text',
      text: 'hello',
      seatId: 'P1',
    })
    expect(await player.decideSpeechWithFormat('P1', 'seer', makeGameView(), 1, true)).toEqual({
      kind: 'audio',
      text: 'hello',
      seatId: 'P1',
    })
  })

  it('propagates an invariant violation when the LLM returns a malformed action', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: '' }] })
    const player = new GameWerewolfAIPlayer(provider)
    await expect(player.decideNightAction('P1', 'wolf', makeGameView(), 1)).rejects.toThrow(
      GameLlmInvariantViolation,
    )
  })
})