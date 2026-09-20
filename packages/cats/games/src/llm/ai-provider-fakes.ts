/**
 * Injectable test-double LLM providers (S5-2a).
 *
 * Deterministic, in-process `GameAIProvider` implementations so the engine's
 * decision surfaces are unit-testable without any HTTP LLM client. `Noop` throws
 * on any call (surfaces accidental LLM use in pure tests); `Scripted` yields a
 * queued response and records every call for assertions, then behaves like noop
 * when exhausted. Mirrors the injectable-seam discipline used across the
 * restructure (e.g. `@flowforge/desktop` BackendSpawner/ReadinessProbe fakes).
 * @module @flowforge/cats-games/llm/ai-provider-fakes
 */

import {
  assertAIActionResponse,
  GameLlmInvariantViolation,
  type AIActionResponse,
  type GameAIProvider,
} from './ai-provider.ts'

/** A `GameAIProvider` that throws on every call — for pure/deterministic tests. */
export class NoopGameAIProvider implements GameAIProvider {
  async generateAction(): Promise<AIActionResponse> {
    throw new GameLlmInvariantViolation('NoopGameAIProvider.generateAction called unexpectedly')
  }

  async generateSpeech(): Promise<string> {
    throw new GameLlmInvariantViolation('NoopGameAIProvider.generateSpeech called unexpectedly')
  }
}

export interface ScriptedGameAIProviderOptions {
  /** Queue of structured action responses (FIFO). */
  actions?: readonly AIActionResponse[]
  /** Queue of speech lines (FIFO). */
  speeches?: readonly string[]
}

/**
 * A scripted `GameAIProvider` that serves queued responses in order and records
 * every call. Throws like {@link NoopGameAIProvider} once its queues are empty,
 * so a test that under-scripts surfaces the gap loudly.
 */
export class ScriptedGameAIProvider implements GameAIProvider {
  readonly actionCalls: Array<{ prompt: string; schema: Record<string, unknown> }> = []
  readonly speechCalls: Array<{ prompt: string }> = []
  private readonly actions: AIActionResponse[]
  private readonly speeches: string[]

  constructor(options: ScriptedGameAIProviderOptions = {}) {
    this.actions = [...(options.actions ?? [])]
    this.speeches = [...(options.speeches ?? [])]
  }

  async generateAction(prompt: string, schema: Record<string, unknown>): Promise<AIActionResponse> {
    this.actionCalls.push({ prompt, schema })
    const next = this.actions.shift()
    if (!next) {
      throw new GameLlmInvariantViolation('ScriptedGameAIProvider exhausted its action queue')
    }
    return assertAIActionResponse(next)
  }

  async generateSpeech(prompt: string): Promise<string> {
    this.speechCalls.push({ prompt })
    const next = this.speeches.shift()
    if (next === undefined) {
      throw new GameLlmInvariantViolation('ScriptedGameAIProvider exhausted its speech queue')
    }
    return next
  }
}