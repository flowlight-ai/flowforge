/**
 * Game LLM composition (S5-3).
 *
 * Injectable assembly helper that maps a concrete environment (or any env-like
 * record) to the {@link GameLlmRuntime} and produces the `aiPlayerFactory` seam
 * consumed by {@link GameAutoPlayer} (S5-2c) and the high-level {@code GameController}
 * (S5-3). Deliberately free of host-only concerns — env source stays a caller
 * decision, so the factory is unit-testable and gives the controller a concrete
 * default without leaking the config stack.
 * @module @flowforge/cats-games/llm/composition
 */

import { GameWerewolfAIPlayer } from './ai-player.ts'
import { GameLlmRuntime } from './llm-runtime.ts'
import { resolveLlmConfigFromEnv } from './llm-config.ts'

/** Options controlling the env-backed factory. */
export interface CreateGameAutoPlayerFactoryOptions {
  /** HTTP transport, forwarded to each provider (injectable for offline tests). */
  fetchImpl?: typeof fetch
}

/**
 * The `aiPlayerFactory` seam expected by {@code GameAutoPlayer} (S5-2c): returns a
 * player for a catId, or null when the cat has no configured/sane LLM endpoint.
 */
export type GameAutoPlayerFactory = (catId: string) => GameWerewolfAIPlayer | null

/**
 * Build an `aiPlayerFactory` seam from an env-like record via {@link GameLlmRuntime}.
 * Each cat's player is memoized by the runtime; a config failure for a cat yields
 * null (caller falls back to random), never an uncaught throw.
 */
export function createGameAutoPlayerFactory(
  env: Record<string, string | undefined>,
  opts?: CreateGameAutoPlayerFactoryOptions,
): GameAutoPlayerFactory {
  const runtime = new GameLlmRuntime({
    resolveConfig: () => resolveLlmConfigFromEnv(env),
    ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  })
  return (catId: string) => {
    try {
      return runtime.playerFor(catId)
    } catch {
      // Model not configured for this cat (missing env keys) — caller falls back.
      return null
    }
  }
}