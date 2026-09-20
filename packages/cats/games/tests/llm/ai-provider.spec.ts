import { describe, it, expect } from 'vitest'
import {
  assertAIActionResponse,
  GameLlmInvariantViolation,
  type AIActionResponse,
} from '../../src/llm/ai-provider.ts'

/** Unit tests for the AI action response invariant guard. */
describe('assertAIActionResponse', () => {
  it('accepts a well-formed response with targetSeat', () => {
    const out = assertAIActionResponse({ actionName: 'kill', targetSeat: 'P3' })
    expect(out).toEqual({ actionName: 'kill', targetSeat: 'P3' })
  })

  it('accepts a response without a targetSeat (strips the key)', () => {
    const out = assertAIActionResponse({ actionName: 'skip' })
    expect(out.actionName).toBe('skip')
    expect('targetSeat' in out).toBe(false)
  })

  it('returns a clean copy, dropping unknown extra fields', () => {
    const out = assertAIActionResponse({ actionName: 'vote', targetSeat: 'P2', hack: 1 })
    expect(out).toEqual({ actionName: 'vote', targetSeat: 'P2' })
  })

  it('throws for a non-object', () => {
    expect(() => assertAIActionResponse(null)).toThrow(GameLlmInvariantViolation)
    expect(() => assertAIActionResponse('kill')).toThrow(GameLlmInvariantViolation)
  })

  it('throws for an empty or non-string actionName', () => {
    expect(() => assertAIActionResponse({ actionName: '' })).toThrow(GameLlmInvariantViolation)
    expect(() => assertAIActionResponse({ actionName: 42 })).toThrow(GameLlmInvariantViolation)
    expect(() => assertAIActionResponse({})).toThrow(GameLlmInvariantViolation)
  })

  it('throws for a malformed targetSeat', () => {
    expect(() => assertAIActionResponse({ actionName: 'kill', targetSeat: 'x9' })).toThrow(
      GameLlmInvariantViolation,
    )
    expect(() => assertAIActionResponse({ actionName: 'kill', targetSeat: 3 })).toThrow(
      GameLlmInvariantViolation,
    )
  })

  it('round-types are assignable as AIActionResponse values', () => {
    const resp: AIActionResponse = assertAIActionResponse({ actionName: 'guard', targetSeat: 'P1' })
    expect(resp.actionName).toBe('guard')
  })
})