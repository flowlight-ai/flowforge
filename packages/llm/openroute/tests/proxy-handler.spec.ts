/**
 * 三个协议代理处理器经真实 HTTP 链路验证：node:http server ← 处理器，客户端真 fetch。
 * 上游 OpenRoute 用本地 node:http 桩（被测系统外部的网关桩，T4 边界外依赖）。
 * 覆盖：路由分发、流式/非流式、错误透传、模型列表端点。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as nodeHttp from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createAnthropicProxyHandler,
  createGeminiProxyHandler,
  createResponsesProxyHandler,
} from '../src/proxy-handler.ts'
import { resolveOpenrouteGatewayConfig } from '../src/gateway.ts'

const OPENROUTE_OK = {
  id: 'oa-1',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { content: 'PONG — 网关真实响应' },
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  model: 'Doubao-Seed2.0',
}

let upstream: nodeHttp.Server
let upstreamUrl = ''
const servers: nodeHttp.Server[] = []
const roots: Array<{ anthropic: string; gemini: string; responses: string }> = []

async function mount(handler: (request: Request) => Promise<Response>): Promise<string> {
  const srv = nodeHttp.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method ?? 'GET',
      headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
      ...(body.length > 0 ? { body } : {}),
    })
    const response = await handler(request)
    const bytes = Buffer.from(await response.arrayBuffer())
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(bytes)
  })
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
  servers.push(srv)
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
}

beforeAll(async () => {
  // 上游 OpenRoute 桩：/v1/chat/completions 回 OPENROUTE_OK
  upstream = nodeHttp.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(OPENROUTE_OK))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const liveGateway = resolveOpenrouteGatewayConfig(
    { OPENROUTE_BASE_URL: upstreamUrl },
    { defaultModel: 'Doubao-Seed2.0' },
  )
  roots.push({
    anthropic: await mount(createAnthropicProxyHandler(liveGateway)),
    gemini: await mount(createGeminiProxyHandler(liveGateway)),
    responses: await mount(createResponsesProxyHandler(liveGateway)),
  })
})

afterAll(() => {
  for (const srv of servers) srv.close()
  upstream.close()
})

describe('anthropic proxy over real HTTP', () => {
  it('POST /v1/messages 非流式：回 Anthropic 响应', async () => {
    const response = await fetch(new URL('/v1/messages', roots[0]?.anthropic), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4', max_tokens: 32, messages: [{ role: 'user', content: 'ping' }] }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.type).toBe('message')
    expect(body.stop_reason).toBe('end_turn')
    expect(body.usage).toEqual({ input_tokens: 3, output_tokens: 5 })
  })

  it('POST /v1/messages 流式：SSE 事件流完整闭合', async () => {
    const response = await fetch(new URL('/v1/messages', roots[0]?.anthropic), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4', stream: true, messages: [{ role: 'user', content: 'ping' }] }),
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const raw = await response.text()
    expect(raw).toContain('event: message_start')
    expect(raw).toContain('event: content_block_delta')
    expect(raw).toContain('PONG — 网关真实响应')
    expect(raw.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(true)
  })

  it('GET /v1/models 与未知路径 404', async () => {
    const models = await (await fetch(new URL('/v1/models', roots[0]?.anthropic))).json() as { data: Array<{ id: string }> }
    expect(models.data.some(m => m.id === 'claude-sonnet-4')).toBe(true)
    const missing = await fetch(new URL('/nope', roots[0]?.anthropic))
    expect(missing.status).toBe(404)
  })
})

describe('gemini proxy over real HTTP', () => {
  it('POST :generateContent 非流式：回 Gemini 响应', async () => {
    const response = await fetch(new URL('/v1beta/models/gemini-2.5-pro:generateContent', roots[0]?.gemini), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.modelVersion).toBe('Doubao-Seed2.0')
    const candidate = (body.candidates as Array<Record<string, unknown>>)[0] ?? {}
    expect(candidate.finishReason).toBe('STOP')
  })

  it('POST :streamGenerateContent：SSE data 行且无 [DONE]', async () => {
    const response = await fetch(new URL('/v1beta/models/gemini-2.5-pro:streamGenerateContent', roots[0]?.gemini), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const raw = await response.text()
    expect(raw.startsWith('data: ')).toBe(true)
    expect(raw).toContain('PONG — 网关真实响应')
    expect(raw.includes('[DONE]')).toBe(false)
  })
})

describe('responses proxy over real HTTP', () => {
  it('POST /v1/responses 非流式：回 Responses 对象', async () => {
    const response = await fetch(new URL('/v1/responses', roots[0]?.responses), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5', input: 'What is 2+2?' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body.object).toBe('response')
    expect(body.status).toBe('completed')
    expect(body.model).toBe('GPT-5.5')
  })

  it('POST /v1/responses 流式：七段事件闭合于 response.completed', async () => {
    const response = await fetch(new URL('/v1/responses', roots[0]?.responses), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5', input: 'hi', stream: true }),
    })
    const raw = await response.text()
    expect(raw).toContain('event: response.created')
    expect(raw).toContain('event: response.output_text.delta')
    expect(raw).toContain('event: response.completed')
  })
})

describe('上游失败透传', () => {
  it('上游非 200：错误状态码与消息透传给客户端', async () => {
    const failing = nodeHttp.createServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'All retry attempts failed' } }))
    })
    await new Promise<void>(resolve => failing.listen(0, '127.0.0.1', resolve))
    const failingUrl = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`
    const badGateway = resolveOpenrouteGatewayConfig({ OPENROUTE_BASE_URL: failingUrl }, { defaultModel: 'Doubao-Seed2.0' })
    const root = await mount(createAnthropicProxyHandler(badGateway))
    try {
      const response = await fetch(new URL('/v1/messages', root), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'ping' }] }),
      })
      // 重试 3 次后仍非 200 → 透传上游状态
      expect(response.status).toBe(503)
      const body = await response.json() as Record<string, unknown>
      expect((body.error as Record<string, unknown>).type).toBe('api_error')
    } finally {
      failing.close()
    }
  })
})
