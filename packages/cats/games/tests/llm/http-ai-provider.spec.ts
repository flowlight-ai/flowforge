import { describe, it, expect, vi } from 'vitest'
import { HttpGameAIProvider, parseActionResponse } from '../../src/llm/http-ai-provider.ts'
import { GameLlmInvariantViolation } from '../../src/llm/ai-provider.ts'
import { GameLlmConfigError, type LlmProviderConfig } from '../../src/llm/llm-config.ts'

/** A minimal fetch response stub used to drive the injected transport. */
function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

interface CapturedRequest {
  url: string
  init?: RequestInit
}

/** A configurable fake fetch that records calls and returns a queued response. */
function makeFakeFetch(onCall?: (url: string, init?: RequestInit) => void) {
  const calls: CapturedRequest[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input)
    const entry: CapturedRequest = { url }
    if (init !== undefined) entry.init = init
    calls.push(entry)
    onCall?.(url, init)
    // empty per-protocol arrays — safe for providers that read index [0].
    return jsonResponse({ content: [], choices: [], candidates: [] })
  }
  return { fetchImpl, calls }
}

const resolver = {
  anthropic: {
    provider: 'anthropic',
    model: 'claude-x',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: 'sk-ant',
  },
} as const

/** Unit tests for the concrete HTTP game AI provider. */
describe('HttpGameAIProvider', () => {
  it('sends an Anthropic request with the correct wire format', async () => {
    const { fetchImpl, calls } = makeFakeFetch()
    const provider = new HttpGameAIProvider({ resolveConfig: () => ({ ...resolver.anthropic }), catId: 'cat1', fetchImpl })
    await provider.generateSpeech('prompt')
    expect(calls).toHaveLength(1)
    const init = calls[0]!.init!
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'claude-x',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'prompt' }],
    })
    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })

  it('parses anthropic action content into a validated action', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ content: [{ text: '{"actionName":"kill","targetSeat":"P2"}' }] })) as typeof fetch
    const provider = new HttpGameAIProvider({
      resolveConfig: () => ({ ...resolver.anthropic }),
      catId: 'cat1',
      fetchImpl,
    })
    const action = await provider.generateAction('p', {})
    expect(action.actionName).toBe('kill')
    expect(action.targetSeat).toBe('P2')
  })

  it('routes to the OpenAI wire format', async () => {
    const { fetchImpl, calls } = makeFakeFetch()
    const provider = new HttpGameAIProvider({
      resolveConfig: () => ({ provider: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1/chat/completions', apiKey: 'sk-oai' }),
      catId: 'cat1',
      fetchImpl,
    })
    const text = await provider.generateSpeech('hi')
    expect(text).toBe('')
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-oai')
  })

  it('faces the resolved response text through generateSpeech', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ choices: [{ message: { content: 'Hi P3.' } }] })) as typeof fetch
    const provider = new HttpGameAIProvider({
      resolveConfig: () => ({ provider: 'openai', model: 'gpt-4o', baseUrl: 'u', apiKey: 'k' }),
      catId: 'cat1',
      fetchImpl,
    })
    expect(await provider.generateSpeech('p')).toBe('Hi P3.')
  })

  it('returns an invalid action (empty actionName) when fetch returns empty content', async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{ message: { content: '{}' } }] })) as typeof fetch
    const provider = new HttpGameAIProvider({
      resolveConfig: () => ({ provider: 'openai', model: 'gpt-4o', baseUrl: 'u', apiKey: 'k' }),
      catId: 'cat1',
      fetchImpl,
    })
    await expect(provider.generateAction('p', {})).rejects.toThrow(GameLlmInvariantViolation)
  })

  it('throws GameLlmConfigError for an unknown provider kind', async () => {
    const provider = new HttpGameAIProvider({
      resolveConfig: () => ({ provider: 'mystery', model: 'm', baseUrl: 'u', apiKey: 'k' }) as unknown as LlmProviderConfig,
      catId: 'cat1',
      fetchImpl: makeFakeFetch().fetchImpl,
    })
    await expect(provider.generateSpeech('p')).rejects.toThrow(GameLlmConfigError)
  })

  it('passes an AbortSignal into the transport and times out', async () => {
    let signalSeen: AbortSignal | undefined
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signalSeen = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')))
      })
    }) as unknown as typeof fetch
    const provider = new HttpGameAIProvider({
      resolveConfig: () => ({ ...resolver.anthropic }),
      catId: 'cat1',
      fetchImpl,
      timeoutMs: 5,
    })
    await expect(provider.generateSpeech('p')).rejects.toThrow('Aborted')
    expect(signalSeen?.aborted).toBe(true)
  })
})

/** Unit tests for markdown-fence-tolerant action parsing. */
describe('parseActionResponse', () => {
  it('parses a clean JSON action', () => {
    expect(parseActionResponse('{"actionName":"kill","targetSeat":"P2"}')).toEqual({
      actionName: 'kill',
      targetSeat: 'P2',
    })
  })

  it('strips markdown code fences', () => {
    expect(parseActionResponse('```json\n{"actionName":"vote","targetSeat":"P4"}\n```')).toEqual({
      actionName: 'vote',
      targetSeat: 'P4',
    })
  })

  it('falls back to P<number> extraction on malformed JSON', () => {
    const result = parseActionResponse('I will target P5 tonight.')
    expect(result.actionName).toBe('')
    expect(result.targetSeat).toBe('P5')
  })

  it('leaves actionName empty and targetSeat unset on fully unparseable text', () => {
    const result = parseActionResponse('no decision')
    expect(result.actionName).toBe('')
    expect(result.targetSeat).toBeUndefined()
  })
})