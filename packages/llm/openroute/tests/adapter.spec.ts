/**
 * adapter：OpenRouteLlmClient 的 env 解析、缺省参数、错误契约（不抛出）。
 * （移植基线：forgemind/openroute_adapter.py）
 */

import { describe, expect, it } from 'vitest'
import { OpenRouteLlmClient, type OpenrouteChatResult } from '../src/adapter.ts'
import type { OpenrouteFetchFn, OpenrouteFetchResponse } from '../src/gateway.ts'

function jsonResponse(status: number, body: unknown, text = ''): OpenrouteFetchResponse {
  return {
    ok: status === 200,
    status,
    statusText: 'test',
    text: async () => (text !== '' ? text : JSON.stringify(body)),
    json: async () => body,
  }
}

function errorResultOf(result: OpenrouteChatResult): { content: string; error: string } {
  return { content: result.content, error: result.error ?? '' }
}

describe('OpenRouteLlmClient 配置', () => {
  it('env 优先级：FLOWFORGE_* > OPENROUTE_* > 默认', () => {
    const top = new OpenRouteLlmClient({
      env: { FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL: 'http://a:1/v1', OPENROUTE_BASE_URL: 'http://b:2' },
    })
    expect(top.baseUrl).toBe('http://a:1')
    const second = new OpenRouteLlmClient({ env: { OPENROUTE_BASE_URL: 'http://b:2' } })
    expect(second.baseUrl).toBe('http://b:2')
    const fallback = new OpenRouteLlmClient({ env: {} })
    expect(fallback.baseUrl).toBe('http://localhost:13001')
    expect(fallback.defaultModel).toBe('openai/gpt-4o-mini')
  })

  it('模型 env：FLOWFORGE_FORGEMIND_OPENROUTE_MODEL', () => {
    const client = new OpenRouteLlmClient({ env: { FLOWFORGE_FORGEMIND_OPENROUTE_MODEL: 'custom/model-x' } })
    expect(client.defaultModel).toBe('custom/model-x')
  })
})

describe('OpenRouteLlmClient.chat', () => {
  it('成功契约：content/model/provider/usage/session_id/forgekin_id', async () => {
    const bodies: string[] = []
    const fetchFn: OpenrouteFetchFn = async (_url, init) => {
      bodies.push(init.body)
      return jsonResponse(200, {
        model: 'upstream-model',
        choices: [{ message: { content: '你好，世界' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      })
    }
    const client = new OpenRouteLlmClient({ env: {}, fetchFn })
    const result = await client.chat({
      messages: [{ role: 'user', content: 'ping' }],
      sessionId: 'sess-1',
    })
    expect(result.content).toBe('你好，世界')
    expect(result.model).toBe('upstream-model')
    expect(result.provider).toBe('openroute')
    expect(result.usage.input_tokens).toBe(11)
    expect(result.usage.output_tokens).toBe(7)
    expect(result.usage.error).toBeUndefined()
    expect(result.session_id).toBe('sess-1')
    expect(result.forgekin_id).toBe('')
    const payload = JSON.parse(bodies[0] ?? '{}')
    expect(payload).toMatchObject({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      temperature: 0.7,
      max_tokens: 2000,
    })
  })

  it('kwargs 透传：model/temperature/maxTokens', async () => {
    const bodies: string[] = []
    const fetchFn: OpenrouteFetchFn = async (_url, init) => {
      bodies.push(init.body)
      return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] })
    }
    const client = new OpenRouteLlmClient({ env: {}, fetchFn })
    await client.chat({ messages: [], model: 'm2', temperature: 0.2, maxTokens: 99 })
    const payload = JSON.parse(bodies[0] ?? '{}')
    expect(payload.model).toBe('m2')
    expect(payload.temperature).toBe(0.2)
    expect(payload.max_tokens).toBe(99)
  })

  it('HTTP 非 200：错误以结果返回，content 带前缀，截断 300 字符', async () => {
    const fetchFn: OpenrouteFetchFn = async () => jsonResponse(502, {}, 'x'.repeat(400))
    const client = new OpenRouteLlmClient({ env: {}, fetchFn })
    const result = await client.chat({ messages: [] })
    const { content, error } = errorResultOf(result)
    expect(content).toContain('[OpenRoute HTTP 502]')
    expect(content.length).toBeLessThanOrEqual('[OpenRoute HTTP 502] '.length + 300)
    expect(error).toContain('HTTP 502')
    expect(result.usage.error).toBe(true)
  })

  it('超时与异常：错误以结果返回且不抛出', async () => {
    const timeoutFetch: OpenrouteFetchFn = async () => {
      const err = new Error('The operation was aborted')
      err.name = 'TimeoutError'
      throw err
    }
    const client = new OpenRouteLlmClient({ env: {}, fetchFn: timeoutFetch })
    const timeoutResult = await client.chat({ messages: [] })
    expect(timeoutResult.content).toContain('[OpenRoute 超时]')
    expect(timeoutResult.usage.error).toBe(true)

    const crashFetch: OpenrouteFetchFn = async () => {
      throw new TypeError('boom')
    }
    const client2 = new OpenRouteLlmClient({ env: {}, fetchFn: crashFetch })
    const crashResult = await client2.chat({ messages: [] })
    expect(crashResult.content).toBe('[OpenRoute 异常] TypeError: TypeError: boom')
  })

  it('API key 非空时携带 Authorization', async () => {
    const seen: Array<Record<string, string>> = []
    const fetchFn: OpenrouteFetchFn = async (_url, init) => {
      seen.push(init.headers)
      return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] })
    }
    const client = new OpenRouteLlmClient({ env: { OPENROUTE_API_KEY: 'k-123' }, fetchFn })
    await client.chat({ messages: [] })
    expect(seen[0]?.['Authorization']).toBe('Bearer k-123')
  })
})
