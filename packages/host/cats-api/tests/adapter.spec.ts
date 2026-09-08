/**
 * Fetch 适配层测试（@flowforge/host-cats-api）：真实构造 node:http 形态的
 * 入站/出站对象，验证方法、路径、查询串、头与 JSON body 的往返一致性。
 */

import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { toRequest, writeResponse } from '../src/adapter.ts'

function fakeReq(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage
  Object.assign(req, { method, url, headers })
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function fakeRes(): {
  res: ServerResponse
  status: () => number
  headers: () => Record<string, string>
  body: () => string
} {
  const state: { status: number; headers: Record<string, string>; body: string } = {
    status: 0,
    headers: {},
    body: '',
  }
  const res = {
    set statusCode(value: number) {
      state.status = value
    },
    get statusCode(): number {
      return state.status
    },
    setHeader(key: string, value: string) {
      state.headers[key] = value
    },
    end(chunk?: Buffer) {
      state.body = chunk?.toString('utf8') ?? ''
    },
  } as unknown as ServerResponse
  return { res, status: () => state.status, headers: () => state.headers, body: () => state.body }
}

describe('Fetch 适配层', () => {
  it('POST：方法/路径/头/JSON body 往返一致', async () => {
    const req = fakeReq(
      'POST',
      '/api/profile-updates/p1/approve',
      { 'content-type': 'application/json', 'x-user-id': 'u1' },
      '{"decidedBy":"u1"}',
    )
    const request = await toRequest(req, 'http://127.0.0.1:8787')
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/profile-updates/p1/approve')
    expect(request.headers.get('x-user-id')).toBe('u1')
    expect(await request.json()).toEqual({ decidedBy: 'u1' })
  })

  it('GET：不带 body 且查询串保留', async () => {
    const req = fakeReq('GET', '/api/packs?limit=2', {})
    const request = await toRequest(req, 'http://127.0.0.1:8787')
    expect(request.method).toBe('GET')
    expect(new URL(request.url).search).toBe('?limit=2')
  })

  it('writeResponse：状态码/头/body 完整写回', async () => {
    const { res, status, headers, body } = fakeRes()
    await writeResponse(
      res,
      new Response(JSON.stringify({ ok: false, error: 'nope' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(status()).toBe(404)
    expect(headers()['content-type']).toBe('application/json')
    expect(JSON.parse(body())).toEqual({ ok: false, error: 'nope' })
  })
})
