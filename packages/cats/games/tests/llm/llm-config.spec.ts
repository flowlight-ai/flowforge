import { describe, it, expect } from 'vitest'
import { GameLlmConfigError, resolveLlmConfigFromEnv, assertLlmProviderKind } from '../../src/llm/llm-config.ts'

/** Unit tests for env-driven LLM config resolution. */
describe('resolveLlmConfigFromEnv', () => {
  const base = {
    GAME_LLM_PROVIDER: 'anthropic',
    GAME_LLM_MODEL: 'claude-3-5-sonnet',
    GAME_LLM_BASE_URL: 'https://api.anthropic.com/v1/messages',
  }

  it('resolves a full config from env', () => {
    expect(resolveLlmConfigFromEnv({ ...base, GAME_LLM_API_KEY: 'sk-x' })).toEqual({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      baseUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-x',
    })
  })

  it('resolves without an apiKey', () => {
    const cfg = resolveLlmConfigFromEnv(base)
    expect(cfg.apiKey).toBeUndefined()
  })

  it('throws a descriptive error when provider is missing', () => {
    const { GAME_LLM_PROVIDER: _omit, ...rest } = base
    expect(() => resolveLlmConfigFromEnv(rest)).toThrow(GameLlmConfigError)
  })

  it('throws a descriptive error when model is missing', () => {
    const { GAME_LLM_MODEL: _omit, ...rest } = base
    expect(() => resolveLlmConfigFromEnv(rest)).toThrow(GameLlmConfigError)
  })

  it('throws a descriptive error when baseUrl is missing', () => {
    const { GAME_LLM_BASE_URL: _omit, ...rest } = base
    expect(() => resolveLlmConfigFromEnv(rest)).toThrow(GameLlmConfigError)
  })

  it('throws on an unsupported provider kind', () => {
    expect(() => resolveLlmConfigFromEnv({ ...base, GAME_LLM_PROVIDER: 'deepseek' })).toThrow(GameLlmConfigError)
  })
})

/** Unit tests for provider-kind validation. */
describe('assertLlmProviderKind', () => {
  it('accepts every supported kind', () => {
    for (const kind of ['anthropic', 'openai', 'google', 'kimi']) {
      expect(assertLlmProviderKind(kind)).toBe(kind)
    }
  })

  it('rejects an unknown kind', () => {
    expect(() => assertLlmProviderKind('mistral')).toThrow(GameLlmConfigError)
  })
})