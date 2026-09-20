/**
 * HTTP-backed Game AI provider (S5-2b).
 *
 * Concrete {@link GameAIProvider} that routes LLM calls over HTTP to the provider
 * kind resolved for a cat (Anthropic / OpenAI / Google / Kimi). This is a faithful,
 * dependency-free port of the clowder-ai `LlmAIProvider.ts` transport logic — the
 * clowder internal config stack (account-resolver / cat-models / provider-endpoint)
 * is replaced by the injected {@link LlmConfigResolver} + {@link resolveConfig}
 * seam, and the HTTP transport / timeout are injectable so the provider is
 * unit-testable with a fake `fetch` and never reaches the network in tests.
 *
 * LLM output is treated as untrusted input: {@link assertAIActionResponse} runs at
 * this provider boundary before a structured action is returned, and
 * {@link assertLlmProviderKind} rejects unsupported provider kinds early.
 * @module @flowforge/cats-games/llm/http-ai-provider
 */

import type { AIActionResponse, GameAIProvider } from './ai-provider.ts'
import { assertAIActionResponse } from './ai-provider.ts'
import {
  GAME_LLM_TIMEOUT_MS,
  assertLlmProviderKind,
  type LlmConfigResolver,
  type LlmProviderConfig,
} from './llm-config.ts'

/** Minimal HTTP result captured from the concrete provider transport. */
interface LlmCallResult {
  text: string
}

/** Options to construct an {@link HttpGameAIProvider}. */
export interface HttpGameAIProviderOptions {
  /** Resolve per-cat LLM configuration (provider kind / model / base URL / key). */
  resolveConfig: LlmConfigResolver
  catId: string
  /** HTTP transport, injectable for offline unit tests (defaults to global fetch). */
  fetchImpl?: typeof fetch
  /** Per-call timeout in ms (defaults to the 10s game budget). */
  timeoutMs?: number
}

/** Concrete HTTP {@link GameAIProvider} for one cat. */
export class HttpGameAIProvider implements GameAIProvider {
  private readonly resolveConfig: LlmConfigResolver
  private readonly catId: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: HttpGameAIProviderOptions) {
    this.resolveConfig = options.resolveConfig
    this.catId = options.catId
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? GAME_LLM_TIMEOUT_MS
  }

  /** Ask the LLM to choose a structured action; validates the response shape. */
  async generateAction(prompt: string, _schema: Record<string, unknown>): Promise<AIActionResponse> {
    const config = this.resolveConfig(this.catId)
    const result = await this.callLlm(config, prompt)
    const parsed = parseActionResponse(result.text)
    return assertAIActionResponse(parsed)
  }

  /** Ask the LLM to produce a free-form speech line. */
  async generateSpeech(prompt: string): Promise<string> {
    const config = this.resolveConfig(this.catId)
    const result = await this.callLlm(config, prompt)
    return result.text.trim()
  }

  private async callLlm(config: LlmProviderConfig, prompt: string): Promise<LlmCallResult> {
    const provider = assertLlmProviderKind(config.provider)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      switch (provider) {
        case 'anthropic':
          return await this.callAnthropic(config, prompt, controller.signal)
        case 'openai':
          return await this.callOpenAI(config, prompt, controller.signal)
        case 'google':
          return await this.callGoogle(config, prompt, controller.signal)
        case 'kimi':
          return await this.callKimi(config, prompt, controller.signal)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private requireApiKey(config: LlmProviderConfig, label: string): string {
    if (!config.apiKey) {
      throw new Error(`Missing ${label} API key for cat ${this.catId}`)
    }
    return config.apiKey
  }

  private async callAnthropic(config: LlmProviderConfig, prompt: string, signal: AbortSignal): Promise<LlmCallResult> {
    const apiKey = this.requireApiKey(config, 'Anthropic')
    const resp = await this.fetchImpl(config.baseUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    })
    const data = (await resp.json()) as { content: Array<{ text: string }> }
    return { text: data.content[0]?.text ?? '' }
  }

  private async callOpenAI(config: LlmProviderConfig, prompt: string, signal: AbortSignal): Promise<LlmCallResult> {
    const apiKey = this.requireApiKey(config, 'OpenAI')
    const resp = await this.fetchImpl(config.baseUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    })
    const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> }
    return { text: data.choices[0]?.message.content ?? '' }
  }

  private async callKimi(config: LlmProviderConfig, prompt: string, signal: AbortSignal): Promise<LlmCallResult> {
    const apiKey = this.requireApiKey(config, 'Kimi')
    const resp = await this.fetchImpl(config.baseUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    })
    const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> }
    return { text: data.choices[0]?.message.content ?? '' }
  }

  private async callGoogle(config: LlmProviderConfig, prompt: string, signal: AbortSignal): Promise<LlmCallResult> {
    const apiKey = this.requireApiKey(config, 'Google')
    const url = config.baseUrl
    const resp = await this.fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 256 },
      }),
      signal,
    })
    const data = (await resp.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    return { text: data.candidates[0]?.content.parts[0]?.text ?? '' }
  }
}

/**
 * Parse an LLM text response into a structured action. Tolerates markdown code
 * fences and falls back to a `P<number>` extraction on malformed JSON, matching
 * the clowder-ai behavior. The result is later validated by
 * {@link assertAIActionResponse}.
 */
export function parseActionResponse(text: string): AIActionResponse {
  const cleaned = text.replace(/```(?:json)?\n?/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const response: AIActionResponse = { actionName: String(parsed.actionName ?? '') }
    if (parsed.targetSeat) response.targetSeat = String(parsed.targetSeat)
    return response
  } catch {
    const match = cleaned.match(/P\d+/)
    const response: AIActionResponse = { actionName: '' }
    if (match) response.targetSeat = match[0]
    return response
  }
}