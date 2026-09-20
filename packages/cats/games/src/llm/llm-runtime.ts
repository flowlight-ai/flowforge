/**
 * Game LLM runtime (S5-2b).
 *
 * Assembles the concrete LLM injection seam for a werewolf game session: a
 * {@link GameAIProvider} (HTTP-backed by default) plus a {@link GameWerewolfAIPlayer}
 * per categorized AI cat. The engine (S5-2c) consumes this runtime as its only
 * LLM dependency, so decision surfaces stay engine-tested and offline-fakeable.
 *
 * Providers and players are memoized per `catId` so one cat reuses the same
 * configured client and player across a session, and configuration resolution is
 * deferred to first use (lazy), allowing the resolver to be env-backed.
 * @module @flowforge/cats-games/llm/llm-runtime
 */

import { GameWerewolfAIPlayer } from './ai-player.ts'
import type { GameAIProvider } from './ai-provider.ts'
import { HttpGameAIProvider } from './http-ai-provider.ts'
import type { LlmConfigResolver } from './llm-config.ts'

/** Options to construct a {@link GameLlmRuntime}. */
export interface GameLlmRuntimeOptions {
  /** Resolve per-cat LLM configuration (provider kind / model / base URL / key). */
  resolveConfig: LlmConfigResolver
  /** HTTP transport, injectable for offline unit tests. */
  fetchImpl?: typeof fetch
  /** Per-call timeout in ms, forwarded to each HTTP provider. */
  timeoutMs?: number
}

/** Session-scoped LLM runtime exposing per-cat providers and AI players. */
export class GameLlmRuntime {
  private readonly resolveConfig: LlmConfigResolver
  private readonly fetchImpl: (typeof fetch) | undefined
  private readonly timeoutMs: number | undefined
  private readonly providers = new Map<string, GameAIProvider>()
  private readonly players = new Map<string, GameWerewolfAIPlayer>()

  constructor(options: GameLlmRuntimeOptions) {
    this.resolveConfig = options.resolveConfig
    this.fetchImpl = options.fetchImpl
    this.timeoutMs = options.timeoutMs
  }

  /** Get (and memoize) the HTTP-backed {@link GameAIProvider} for a cat. */
  providerFor(catId: string): GameAIProvider {
    let provider = this.providers.get(catId)
    if (!provider) {
      const opts: { resolveConfig: LlmConfigResolver; catId: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {
        resolveConfig: this.resolveConfig,
        catId,
      }
      if (this.fetchImpl) opts.fetchImpl = this.fetchImpl
      if (this.timeoutMs !== undefined) opts.timeoutMs = this.timeoutMs
      provider = new HttpGameAIProvider(opts)
      this.providers.set(catId, provider)
    }
    return provider
  }

  /** Get (and memoize) a {@link GameWerewolfAIPlayer} bound to a cat's provider. */
  playerFor(catId: string): GameWerewolfAIPlayer {
    let player = this.players.get(catId)
    if (!player) {
      player = new GameWerewolfAIPlayer(this.providerFor(catId))
      this.players.set(catId, player)
    }
    return player
  }
}