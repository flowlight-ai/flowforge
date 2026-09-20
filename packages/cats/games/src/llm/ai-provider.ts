/**
 * Game LLM injection seam (S5-2a).
 *
 * Faithful port of clowder-ai `WerewolfAIPlayer.ts` `AIProvider` port + response
 * shape. The Werewolf engine (S5-2b) depends only on this injected interface,
 * never on a concrete HTTP LLM client, so the action/speech decision surfaces
 * are unit-testable with a fake provider (see `ai-provider-fakes.ts`).
 *
 * invariant guards run at the seam boundary — the engine treats an LLM response
 * as untrusted input, so a malformed `AIActionResponse` aborts before it can
 * corrupt game state.
 * @module @flowforge/cats-games/llm/ai-provider
 */

import { isSeatId } from '@flowforge/cats-shared'

/** A structured action an AI player chooses (name + optional target seat). */
export interface AIActionResponse {
  actionName: string
  targetSeat?: string
}

/** Injected LLM client port the Werewolf engine uses to drive AI players. */
export interface GameAIProvider {
  /** Ask the LLM to choose a structured action from a prompt + a JSON-schema hint. */
  generateAction(prompt: string, schema: Record<string, unknown>): Promise<AIActionResponse>
  /** Ask the LLM to produce a free-form speech line for a seated player. */
  generateSpeech(prompt: string): Promise<string>
}

/** Invariant violation thrown when an LLM response is structurally invalid. */
export class GameLlmInvariantViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameLlmInvariantViolation'
  }
}

/**
 * Validate + normalize an untrusted `AIActionResponse`. Throws
 * {@link GameLlmInvariantViolation} when the action name is empty or the target
 * seat (if present) is not a well-formed `P<number>` seat id. Returns a clean
 * copy so the engine never reads mutated upstream state.
 */
export function assertAIActionResponse(value: unknown): AIActionResponse {
  if (!value || typeof value !== 'object') {
    throw new GameLlmInvariantViolation('AIActionResponse must be an object')
  }
  const v = value as Record<string, unknown>
  if (typeof v.actionName !== 'string' || v.actionName.trim() === '') {
    throw new GameLlmInvariantViolation('AIActionResponse.actionName must be a non-empty string')
  }
  if (v.targetSeat !== undefined && v.targetSeat !== null) {
    if (typeof v.targetSeat !== 'string' || !isSeatId(v.targetSeat)) {
      throw new GameLlmInvariantViolation(`AIActionResponse.targetSeat must be a valid seat id, got ${JSON.stringify(v.targetSeat)}`)
    }
  }
  const response: AIActionResponse = { actionName: v.actionName }
  if (typeof v.targetSeat === 'string') response.targetSeat = v.targetSeat
  return response
}