/**
 * gateway 共享层：配置解析优先级、URL 规范化、沉默失败检测、重试与 fallback 模型。
 * （移植基线：openroute_adapter.py env 优先级 + 三个 proxy 的 call_openroute 重试段）
 */

import { describe, expect, it } from 'vitest'
import {
  callOpenrouteChat,
  extractFirstChoiceContent,
  isInvalidOpenrouteResponse,
  normalizeOpenrouteBaseUrl,
  openrouteChatEndpoint,
  resolveOpenrouteGatewayConfig,
  type OpenrouteFetchFn,
  type OpenrouteFetchResponse,
} from '../src/gateway.ts'

function jsonResponse(status: number, body: unknown): OpenrouteFetchResponse {
  return {
    ok: status === 200,
    status,
    statusText: 'test',
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

describe('resolveOpenrouteGatewayConfig', () => {
  it('env 优先级：FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL 最高', () => {
    const config = resolveOpenrouteGatewayConfig(
      { FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL: 'http://a:1/v1/', OPENROUTE_BASE_URL: 'http://b:2/v1' },
      { defaultModel: 'm' },
    )
    expect(config.baseUrl).toBe('http://a:1')
  })

  it('env 回落：OPENROUTE_BASE_URL 次之，再回落默认 13001/v1', () => {
    const withFallback = resolveOpenrouteGatewayConfig({}, { defaultModel: 'm' })
    expect(withFallback.baseUrl).toBe('http://localhost:13001')
    const second = resolveOpenrouteGatewayConfig({ OPENROUTE_BASE_URL: 'http://b:2' }, { defaultModel: 'm' })
    expect(second.baseUrl).toBe('http://b:2')
  })

  it('显式覆盖最高（等价 CLI --openroute-base）', () => {
    const config = resolveOpenrouteGatewayConfig(
      { FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL: 'http://a:1' },
      { defaultModel: 'm', baseUrlOverride: 'http://override:9/v1/' },
    )
    expect(config.baseUrl).toBe('http://override:9')
  })

  it('API key 优先级与缺省空串', () => {
    const keyed = resolveOpenrouteGatewayConfig(
      { FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY: 'k1', OPENROUTE_API_KEY: 'k2' },
      { defaultModel: 'm' },
    )
    expect(keyed.apiKey).toBe('k1')
    const fallback = resolveOpenrouteGatewayConfig({ OPENROUTE_API_KEY: 'k2' }, { defaultModel: 'm' })
    expect(fallback.apiKey).toBe('k2')
    const empty = resolveOpenrouteGatewayConfig({}, { defaultModel: 'm' })
    expect(empty.apiKey).toBe('')
  })
})

describe('normalizeOpenrouteBaseUrl / endpoint', () => {
  it('剥离尾部 / 与 /v1，端点拼接 /v1/chat/completions', () => {
    expect(normalizeOpenrouteBaseUrl('http://h:1/v1/')).toBe('http://h:1')
    expect(normalizeOpenrouteBaseUrl('http://h:1')).toBe('http://h:1')
    expect(openrouteChatEndpoint('http://h:1')).toBe('http://h:1/v1/chat/completions')
  })
})

describe('isInvalidOpenrouteResponse / extractFirstChoiceContent', () => {
  it('空与过短内容无效（<2 字符）', () => {
    expect(isInvalidOpenrouteResponse('')).toBe(true)
    expect(isInvalidOpenrouteResponse('  ')).toBe(true)
    expect(isInvalidOpenrouteResponse('好')).toBe(true)
  })

  it('命中沉默失败模式无效，正常内容有效', () => {
    expect(isInvalidOpenrouteResponse('无法回答这个问题')).toBe(true)
    expect(isInvalidOpenrouteResponse('模型当前不可用，请稍后重试。')).toBe(true)
    expect(isInvalidOpenrouteResponse('PONG — 一切正常')).toBe(false)
  })

  it('提取首个 choice 的 message.content，缺结构返回空串', () => {
    expect(extractFirstChoiceContent({ choices: [{ message: { content: 'hi' } }] })).toBe('hi')
    expect(extractFirstChoiceContent({ choices: [] })).toBe('')
    expect(extractFirstChoiceContent({})).toBe('')
  })
})

describe('callOpenrouteChat', () => {
  const gateway = resolveOpenrouteGatewayConfig({ OPENROUTE_BASE_URL: 'http://gw:1/v1' }, { defaultModel: 'main-model' })

  function scriptedFetch(responses: OpenrouteFetchResponse[], bodies: string[] = []): OpenrouteFetchFn {
    let call = 0
    return async (_url, init) => {
      bodies.push(init.body)
      const idx = Math.min(call, responses.length - 1)
      const resp = responses[idx]
      if (resp === undefined) throw new Error('scripted response missing')
      call += 1
      return resp
    }
  }

  it('首次成功：用原模型且强制 stream=false', async () => {
    const bodies: string[] = []
    const result = await callOpenrouteChat(
      gateway,
      { model: 'main-model', messages: [] },
      { fetchFn: scriptedFetch([jsonResponse(200, { choices: [{ message: { content: 'PONG ok' } }] })], bodies) },
    )
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.attempts).toBe(1)
    expect(result.model).toBe('main-model')
    expect(JSON.parse(bodies[0] ?? '{}').stream).toBe(false)
  })

  it('非 200 重试：attempt2/3 切换 fallback 模型，最终返回最后响应', async () => {
    const bodies: string[] = []
    const result = await callOpenrouteChat(
      gateway,
      { model: 'main-model', messages: [] },
      { fetchFn: scriptedFetch([jsonResponse(500, { error: 'x' })], bodies) },
    )
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(3)
    expect(result.model).toBe('Kimi-K2.6') // FALLBACK_MODELS[min(3-2, 3)] = index1
    const models = bodies.map((b) => JSON.parse(b ?? '{}').model)
    expect(models).toEqual(['main-model', 'Doubao-Seed2.0', 'Kimi-K2.6'])
  })

  it('沉默失败重试：无效内容触发 fallback，第三次有效内容返回', async () => {
    const bodies: string[] = []
    const responses: OpenrouteFetchResponse[] = [
      jsonResponse(200, { choices: [{ message: { content: '无法回答' } }] }),
      jsonResponse(200, { choices: [{ message: { content: '我不能回答' } }] }),
      jsonResponse(200, { choices: [{ message: { content: '真实回答内容，足够长' } }] }),
    ]
    const result = await callOpenrouteChat(gateway, { model: 'main-model' }, { fetchFn: scriptedFetch(responses, bodies) })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(3)
    expect(extractFirstChoiceContent(result.data ?? {})).toBe('真实回答内容，足够长')
    const models = bodies.map((b) => JSON.parse(b ?? '{}').model)
    expect(models).toEqual(['main-model', 'Doubao-Seed2.0', 'Kimi-K2.6'])
  })

  it('网络异常重试耗尽后抛出', async () => {
    const failing: OpenrouteFetchFn = async () => {
      throw new Error('connection refused')
    }
    await expect(callOpenrouteChat(gateway, { model: 'm' }, { fetchFn: failing })).rejects.toThrow('connection refused')
  })

  it('携带 Authorization Bearer 头（key 非空时）', async () => {
    const seen: Array<Record<string, string>> = []
    const fetchFn: OpenrouteFetchFn = async (_url, init) => {
      seen.push(init.headers)
      return jsonResponse(200, { choices: [{ message: { content: 'ok content' } }] })
    }
    await callOpenrouteChat(gateway, { model: 'm' }, { fetchFn })
    expect(seen[0]?.['Authorization']).toBe('Bearer ')
    const keyedGateway = resolveOpenrouteGatewayConfig(
      { OPENROUTE_BASE_URL: 'http://gw:1' },
      { defaultModel: 'm', apiKeyOverride: 'secret-key' },
    )
    await callOpenrouteChat(keyedGateway, { model: 'm' }, { fetchFn })
    expect(seen[1]?.['Authorization']).toBe('Bearer secret-key')
  })
})
