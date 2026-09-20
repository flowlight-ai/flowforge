import { describe, it, expect } from 'vitest'
import { GameLlmInvariantViolation } from '../../src/llm/ai-provider.ts'
import { NoopGameAIProvider, ScriptedGameAIProvider } from '../../src/llm/ai-provider-fakes.ts'

/** Unit tests for the noop provider. */
describe('NoopGameAIProvider', () => {
  it('throws on generateAction and generateSpeech', async () => {
    const provider = new NoopGameAIProvider()
    await expect(provider.generateAction('p', {})).rejects.toThrow(GameLlmInvariantViolation)
    await expect(provider.generateSpeech('p')).rejects.toThrow(GameLlmInvariantViolation)
  })
})

/** Unit tests for the scripted (FIFO, recording) provider. */
describe('ScriptedGameAIProvider', () => {
  it('serves queued actions in order and records the calls', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: 'a' }, { actionName: 'b', targetSeat: 'P4' }] })
    expect(await provider.generateAction('p1', { one: 1 })).toEqual({ actionName: 'a' })
    expect(await provider.generateAction('p2', { two: 2 })).toEqual({ actionName: 'b', targetSeat: 'P4' })
    expect(provider.actionCalls.map((c) => c.prompt)).toEqual(['p1', 'p2'])
  })

  it('serves queued speeches in order', async () => {
    const provider = new ScriptedGameAIProvider({ speeches: ['s1', 's2'] })
    expect(await provider.generateSpeech('q1')).toBe('s1')
    expect(await provider.generateSpeech('q2')).toBe('s2')
    expect(provider.speechCalls.map((c) => c.prompt)).toEqual(['q1', 'q2'])
  })

  it('behaves like noop once the action queue is exhausted', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: 'a' }] })
    await provider.generateAction('p1', {})
    await expect(provider.generateAction('p2', {})).rejects.toThrow(GameLlmInvariantViolation)
  })

  it('behaves like noop once the speech queue is exhausted', async () => {
    const provider = new ScriptedGameAIProvider({ speeches: ['a'] })
    await provider.generateSpeech('q')
    await expect(provider.generateSpeech('q')).rejects.toThrow(GameLlmInvariantViolation)
  })

  it('validates queued actions through the invariant guard', async () => {
    const provider = new ScriptedGameAIProvider({ actions: [{ actionName: '', targetSeat: 'x' }] })
    await expect(provider.generateAction('p', {})).rejects.toThrow(GameLlmInvariantViolation)
  })
})