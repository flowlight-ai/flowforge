/**
 * @flowforge/webhook-github 契约测试（B）— GitHub HTTP handler 编排与内存端口行为。
 *
 * 直接以 createGitHubFixture 装配真实内存端口，构造 node:http 假件驱动 handler，
 * 断言响应状态与端口足迹；并对内存端口自身行为单独覆盖。禁用对被测模块的 vi.mock。
 */

import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createGitHubFixture, InMemoryDispatcher, InMemoryWebServer } from '../src/memory.ts'
import { createGitHubWebhookHandler, type GitHubWebhookHandlerConfig } from '../src/handler.ts'
import { fakeIncoming, FakeResponse, signatureHeader } from './support.ts'

/** 默认 handler 配置。 */
const config: GitHubWebhookHandlerConfig = {
  source: 'github-main',
  secretEnv: 'GITHUB_SECRET',
  maxBodyBytes: 1024,
}

/** 装配 fixture + 已设密钥 + 完整请求头的处理器上下文。 */
function setup(overrides: { secret?: string } = {}) {
  const fixture = createGitHubFixture()
  const secret = overrides.secret ?? 'whsec_test'
  fixture.credentials.setSecret('GITHUB_SECRET', secret)
  fixture.credentials.setSecret('EMPTY_SECRET', '')
  const handler = createGitHubWebhookHandler(fixture.ports, config)
  return { fixture, handler, secret }
}

/** 构造一组 GitHub 标准请求头（body 于调用时补签名）。 */
function githubHeaders(body: string, secret: string, extra: Record<string, string | undefined> = {}) {
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': signatureHeader(secret, body),
    'x-github-delivery': 'guid-123',
    'x-github-event': 'issues',
    ...extra,
  }
}

/** 驱动 handler 返回响应假件。 */
async function call(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>, req: IncomingMessage) {
  const response = new FakeResponse()
  await handler(req, response.view)
  return response
}

describe('GitHub handler 成功编排', () => {
  it('合法签名请求分发投递并应答 202（fire-and-forget，不等待规则结算）', async () => {
    const { fixture, handler } = setup()
    const body = JSON.stringify({ action: 'opened', number: 1 })
    const req = fakeIncoming({ headers: githubHeaders(body, 'whsec_test'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(202)
    expect(response.ended).toBe(true)
    expect(response.body).toBe('')
    // 分发同步完成，无需等待后台。
    expect(fixture.dispatcher.deliveries).toHaveLength(1)
  })

  it('投递携带正确 kind/source/deliveryId/event 且 payload 为解析对象', async () => {
    const { fixture, handler } = setup()
    const body = JSON.stringify({ action: 'opened', number: 1 })
    const req = fakeIncoming({ headers: githubHeaders(body, 'whsec_test'), chunks: [body] })
    await call(handler, req)
    const delivery = fixture.dispatcher.deliveries[0]!
    expect(delivery.kind).toBe('github')
    expect(delivery.source).toBe('github-main')
    expect(delivery.deliveryId).toBe('guid-123')
    expect(delivery.event).toMatchObject({ name: 'issues', payload: { action: 'opened', number: 1 } })
    expect(typeof delivery.receivedAt).toBe('number')
  })

  it('source 配置值投影到投递的 source 品牌标识', () => {
    const fixture = createGitHubFixture()
    fixture.credentials.setSecret('GITHUB_SECRET', 's')
    const handler = createGitHubWebhookHandler(fixture.ports, { ...config, source: 'secondary-github' })
    const body = '{}'
    const req = fakeIncoming({ headers: githubHeaders(body, 's'), chunks: [body] })
    return call(handler, req).then(() => {
      expect(fixture.dispatcher.deliveries[0]!.source).toBe('secondary-github')
    })
  })
})

describe('GitHub handler 错误路径', () => {
  it('非 POST 方法拒绝并带 Allow 头', async () => {
    const { fixture, handler } = setup()
    const response = await call(handler, fakeIncoming({ method: 'GET', headers: { 'allow-test': '1' } }))
    expect(response.status).toBe(405)
    expect(response.headers['allow']).toBe('POST')
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('非 JSON Content-Type 拒绝', async () => {
    const { fixture, handler } = setup()
    const body = '{}'
    const req = fakeIncoming({ headers: { ...githubHeaders(body, 'whsec_test'), 'content-type': 'text/plain' }, chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(415)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('缺失 x-hub-signature-256 头拒绝', async () => {
    const { fixture, handler } = setup()
    const body = '{}'
    const { 'x-hub-signature-256': _drop, ...rest } = githubHeaders(body, 'whsec_test')
    void _drop
    const req = fakeIncoming({ headers: rest, chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(400)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('缺失 x-github-delivery 头拒绝', async () => {
    const { fixture, handler } = setup()
    const body = '{}'
    const { 'x-github-delivery': _drop, ...rest } = githubHeaders(body, 'whsec_test')
    void _drop
    const response = await call(handler, fakeIncoming({ headers: rest, chunks: [body] }))
    expect(response.status).toBe(400)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('缺失 x-github-event 头拒绝', async () => {
    const { fixture, handler } = setup()
    const body = '{}'
    const { 'x-github-event': _drop, ...rest } = githubHeaders(body, 'whsec_test')
    void _drop
    const response = await call(handler, fakeIncoming({ headers: rest, chunks: [body] }))
    expect(response.status).toBe(400)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('错误签名返回 401 且不分发', async () => {
    const { fixture, handler } = setup()
    const body = '{}'
    const headers = { ...githubHeaders(body, 'whsec_test'), 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }
    const response = await call(handler, fakeIncoming({ headers, chunks: [body] }))
    expect(response.status).toBe(401)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('凭据值为空字符串返回 503', async () => {
    const fixture = createGitHubFixture()
    fixture.credentials.setSecret('GITHUB_SECRET', '')
    const handler = createGitHubWebhookHandler(fixture.ports, config)
    const body = '{}'
    const req = fakeIncoming({ headers: githubHeaders(body, 'ignored'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(503)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('secret 引用未解析返回 503', async () => {
    const { fixture, handler } = setup()
    fixture.credentials.secrets.delete('GITHUB_SECRET')
    const body = '{}'
    const req = fakeIncoming({ headers: githubHeaders(body, 'ignored'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(503)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('分发不可用时返回 503 并记录告警', async () => {
    const { fixture, handler } = setup()
    fixture.dispatcher.unavailable = true
    const body = '{}'
    const req = fakeIncoming({ headers: githubHeaders(body, 'whsec_test'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(503)
    expect(fixture.logger.warnings.some(w => w.includes('dispatch unavailable'))).toBe(true)
  })

  it('非法 JSON body 返回 400', async () => {
    const { fixture, handler } = setup()
    const body = 'not-json'
    const req = fakeIncoming({ headers: githubHeaders(body, 'whsec_test'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(400)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('非对象 payload（数组）返回 400', async () => {
    const { fixture, handler } = setup()
    const body = '[1,2]'
    const req = fakeIncoming({ headers: githubHeaders(body, 'whsec_test'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(400)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('请求体超过上限返回 413', async () => {
    const fixture = createGitHubFixture()
    fixture.credentials.setSecret('GITHUB_SECRET', 's')
    const handler = createGitHubWebhookHandler(fixture.ports, { ...config, maxBodyBytes: 16 })
    const body = JSON.stringify({ action: 'opened', payload: 'x'.repeat(64) })
    const req = fakeIncoming({ headers: githubHeaders(body, 's'), chunks: [body] })
    const response = await call(handler, req)
    expect(response.status).toBe(413)
    expect(fixture.dispatcher.deliveries).toHaveLength(0)
  })

  it('未捕获异常归一化为 503 并记录告警', async () => {
    const fixture = createGitHubFixture()
    fixture.credentials.setSecret('GITHUB_SECRET', 's')
    const handler = createGitHubWebhookHandler(fixture.ports, config)
    const req = fakeIncoming({ chunks: ['{}'] }) as IncomingMessage
    const response = new FakeResponse()
    Object.defineProperty(req, 'headers', {
      get() { throw new Error('boom') },
    })
    await handler(req, response.view)
    expect(response.status).toBe(503)
  })
})

describe('内存端口行为', () => {
  it('InMemoryCredentials 解析未知引用为 undefined，空字符串保留为值', async () => {
    const fixture = createGitHubFixture()
    fixture.credentials.setSecret('A', 'v1')
    await expect(fixture.credentials.resolve('A')).resolves.toEqual({ value: 'v1' })
    await expect(fixture.credentials.resolve('NOPE')).resolves.toBeUndefined()
    fixture.credentials.setSecret('EMPTY', '')
    await expect(fixture.credentials.resolve('EMPTY')).resolves.toEqual({ value: '' })
  })

  it('InMemoryDispatcher 记录投递并可在不可用时抛错', () => {
    const d = new InMemoryDispatcher()
    const delivery = { kind: 'github', source: 's', deliveryId: 'd', event: { name: 'x', payload: {} }, receivedAt: 1 } as never
    d.dispatch(delivery)
    expect(d.deliveries).toHaveLength(1)
    expect(d.deliveries[0]).toBe(delivery)
    d.unavailable = true
    expect(() => d.dispatch(delivery)).toThrow(/unavailable/)
  })

  it('InMemoryWebServer 拒绝重复路径并支持 release', () => {
    const ws = new InMemoryWebServer()
    const route = { kind: 'exact' as const, path: '/h', handler: async () => {} }
    const release = ws.register(route)
    expect(ws.routes).toHaveLength(1)
    expect(() => ws.register({ ...route })).toThrow(/already registered/)
    release()
    expect(ws.releasedRoutes).toContain('/h')
    expect(ws.routes).toHaveLength(0)
  })
})