/**
 * Game LLM runtime config (S5-2b).
 *
 * Concrete LLM runtime config resolution: provider kind, model, base URL and API
 * key for one game AI player. The engine (S5-2c) depends only on the injected
 * {@link LlmConfigResolver} port, so concrete provider configuration can be wired
 * up at the composition root (env-based by default) without coupling the pure
 * game package to a particular credentials store.
 *
 * Config is treated as untrusted-like input only at the resolver boundary — a
 * malformed provider kind is rejected here rather than surfacing deep in an HTTP
 * client.
 * @module @flowforge/cats-games/llm/llm-config
 */

/** Protocol of the concrete LLM HTTP endpoint a game AI player uses. */
export type LlmProviderKind = 'anthropic' | 'openai' | 'google' | 'kimi'

/** Supported provider kinds, used to validate env-driven resolution. */
export const LLM_PROVIDER_KINDS: readonly LlmProviderKind[] = [
  'anthropic',
  'openai',
  'google',
  'kimi',
] as const

/** Resolved configuration for one game AI player's LLM endpoint. */
export interface LlmProviderConfig {
  provider: LlmProviderKind
  model: string
  baseUrl: string
  /** API key. Optional at the type level so key-free keys can be diagnosed. */
  apiKey?: string
}

/**
 * Injection point for per-cat LLM configuration. The engine calls
 * `resolveConfig(catId)` once per AI player to obtain endpoint details.
 */
export type LlmConfigResolver = (catId: string) => LlmProviderConfig

/** Default LLM call timeout, matching the clowder-ai 10s budget. */
export const GAME_LLM_TIMEOUT_MS = 10_000

/** Thrown when LLM configuration is missing or invalid at the resolver boundary. */
export class GameLlmConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameLlmConfigError'
  }
}

/** Env key names used by the default env-backed resolver. */
export interface GameLlmEnvKeys {
  provider: string
  model: string
  baseUrl: string
  apiKey: string
}

/** Default env key names — free of the clowder internal config stack. */
export const GAME_LLM_ENV_KEYS: GameLlmEnvKeys = {
  provider: 'GAME_LLM_PROVIDER',
  model: 'GAME_LLM_MODEL',
  baseUrl: 'GAME_LLM_BASE_URL',
  apiKey: 'GAME_LLM_API_KEY',
}

/** Validate + normalize a provider kind string; throws {@link GameLlmConfigError}. */
export function assertLlmProviderKind(value: string): LlmProviderKind {
  if (!(LLM_PROVIDER_KINDS as readonly string[]).includes(value)) {
    throw new GameLlmConfigError(`Unsupported LLM provider kind: ${value}`)
  }
  return value as LlmProviderKind
}

/**
 * Resolve a {@link LlmProviderConfig} from an env-like record using the default
 * key names. Missing required keys (provider/model/baseUrl) raise a descriptive
 * {@link GameLlmConfigError}; apiKey is optional and only required by callers that
 * actually issue a request.
 */
export function resolveLlmConfigFromEnv(env: Record<string, string | undefined>): LlmProviderConfig {
  const provider = env[GAME_LLM_ENV_KEYS.provider]
  if (!provider) {
    throw new GameLlmConfigError(`Missing ${GAME_LLM_ENV_KEYS.provider}`)
  }
  const model = env[GAME_LLM_ENV_KEYS.model]
  if (!model) {
    throw new GameLlmConfigError(`Missing ${GAME_LLM_ENV_KEYS.model}`)
  }
  const baseUrl = env[GAME_LLM_ENV_KEYS.baseUrl]
  if (!baseUrl) {
    throw new GameLlmConfigError(`Missing ${GAME_LLM_ENV_KEYS.baseUrl}`)
  }

  const config: LlmProviderConfig = {
    provider: assertLlmProviderKind(provider),
    model,
    baseUrl,
  }
  const apiKey = env[GAME_LLM_ENV_KEYS.apiKey]
  if (apiKey) config.apiKey = apiKey
  return config
}