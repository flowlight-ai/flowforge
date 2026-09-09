/**
 * @flowforge/webhook-github 契约测试（A）— 纯函数：HMAC 签名、受限 body 摄入、
 * HTTP 助手、配置校验与 apply 装配。
 *
 * 全部断言对真实实现运行（签名/body/http 助手为无状态纯函数；apply 装配内存
 * webserver 端口），禁用对被测模块的 vi.mock。
 */

import { describe, expect, it } from 'vitest'
import { WebhookHttpError } from '../src/body.ts'
import { readBoundedUtf8Body } from '../src/body.ts'
import { computeHmacSha256Hex, verifySignature, HMAC_SIGNATURE_PREFIX } from '../src/pure/signature.ts'
import { isJsonContentType, requiredHeader, parsePayload } from '../src/pure/http.ts'
import { validateConfig, apply } from '../src/index.ts'
import { createGitHubFixture } from '../src/memory.ts'
import { fakeIncoming, computeHmacSha256Hex as hmac } from './support.ts'

describe('computeHmacSha256Hex', () => {
  it('对相同 secret+body 稳定产出 64 位十六进制摘要', () => {
    const a = computeHmacSha256Hex('secret', '{"n":1}')
    const b = computeHmacSha256Hex('secret', '{"n":1}')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/i)
  })

  it('不同 secret 或 body 产出不同摘要', () => {
    const base = hmac('s', 'body')
    expect(hmac('s', 'body2')).not.toBe(base)
    expect(hmac('s2', 'body')).not.toBe(base)
  })
})

describe('verifySignature', () => {
  const secret = 'whsec_test'
  const body = '{"action":"opened"}'

  it('合法 sha256 签名通过', () => {
    expect(verifySignature(secret, body, `sha256=${computeHmacSha256Hex(secret, body)}`)).toBe(true)
  })

  it('错误密钥下的合法格式签名被拒绝', () => {
    expect(verifySignature('wrong-secret', body, `sha256=${computeHmacSha256Hex(secret, body)}`)).toBe(false)
  })

  it('错误前缀（sha1 / 无前缀）被拒绝', () => {
    const hex = computeHmacSha256Hex(secret, body)
    expect(verifySignature(secret, body, `${hex}`)).toBe(false)
    expect(verifySignature(secret, body, `sha1=${hex}`)).toBe(false)
  })

  it('十六进制非法或长度不符被拒绝', () => {
    const hex = computeHmacSha256Hex(secret, body)
    expect(verifySignature(secret, body, `sha256=${hex.slice(0, 20)}`)).toBe(false)
    expect(verifySignature(secret, body, `sha256=zzzz${hex.slice(4)}`)).toBe(false)
  })

  it('HMAC_SIGNATURE_PREFIX 常量为标准前缀', () => {
    expect(HMAC_SIGNATURE_PREFIX).toBe('sha256=')
  })
})

describe('readBoundedUtf8Body', () => {
  it('读取合法 UTF-8 body 并精确解码', async () => {
    const req = fakeIncoming({ chunks: ['{', '"a"', ':', '1}'], complete: true })
    await expect(readBoundedUtf8Body(req, 64)).resolves.toBe('{"a":1}')
  })

  it('无 Content-Length 时按实际字节校验上限，超限抛 413', async () => {
    const req = fakeIncoming({ chunks: ['x'.repeat(100)], complete: true })
    await expect(readBoundedUtf8Body(req, 32)).rejects.toMatchObject({ status: 413 })
  })

  it('声明的 Content-Length 超过上限直接抛 413', async () => {
    const req = fakeIncoming({ headers: { 'content-length': '1000' }, chunks: ['x'], complete: true })
    await expect(readBoundedUtf8Body(req, 64)).rejects.toMatchObject({ status: 413 })
  })

  it('非法 Content-Length 抛 400', async () => {
    const req = fakeIncoming({ headers: { 'content-length': 'abc' }, chunks: [], complete: true })
    await expect(readBoundedUtf8Body(req, 64)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Content-Length/) })
  })

  it('声明上限内的 body 正常读取', async () => {
    const req = fakeIncoming({ headers: { 'content-length': '5' }, chunks: ['hello'], complete: true })
    await expect(readBoundedUtf8Body(req, 64)).resolves.toBe('hello')
  })

  it('非 UTF-8（畸形字节）抛 400', async () => {
    const req = fakeIncoming({ chunks: [Buffer.from([0xff, 0xfe, 0x00])], complete: true })
    await expect(readBoundedUtf8Body(req, 64)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/UTF-8/) })
  })

  it('未完成的流抛 400', async () => {
    const req = fakeIncoming({ chunks: ['aborted'], complete: false })
    await expect(readBoundedUtf8Body(req, 64)).rejects.toMatchObject({ status: 400 })
  })

  it('WebhookHttpError 携带响应状态码', () => {
    expect(new WebhookHttpError(401, 'invalid signature').status).toBe(401)
    expect(new WebhookHttpError(401, 'invalid signature').name).toBe('WebhookHttpError')
  })
})

describe('HTTP 助手纯函数', () => {
  it('isJsonContentType 接受 application/json 并容忍 utf-8 charset', () => {
    expect(isJsonContentType(undefined)).toBe(false)
    expect(isJsonContentType('text/plain')).toBe(false)
    expect(isJsonContentType('application/json')).toBe(true)
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('application/json; charset="utf-8"')).toBe(true)
    expect(isJsonContentType('application/json; charset=utf-8; extra=1')).toBe(false)
    expect(isJsonContentType('application/json; charset=latin1')).toBe(false)
  })

  it('requiredHeader 要求无歧义非空请求头', () => {
    expect(requiredHeader(fakeIncoming({ headers: { 'x-event': 'push' } }), 'x-event')).toBe('push')
    expect(() => requiredHeader(fakeIncoming({ headers: {} }), 'x-event')).toThrow(WebhookHttpError)
    expect(() => requiredHeader(fakeIncoming({ headers: { 'x-event': '  ' } }), 'x-event')).toThrow(WebhookHttpError)
    expect(() => requiredHeader(fakeIncoming({ headers: { 'x-event': 'a', 'x-event2': 'b' } }), 'x-event2')).not.toThrow()
  })

  it('requiredHeader 对多值头抛 400', () => {
    const req = fakeIncoming({ headers: { 'x-event': 'a' } }) as unknown as {
      headersDistinct: Record<string, string[] | undefined>
    }
    req.headersDistinct['x-event'] = ['a', 'b']
    expect(() => requiredHeader(req as never, 'x-event')).toThrow(WebhookHttpError)
  })

  it('parsePayload 解析签名 JSON 对象为通用对象', () => {
    const parsed = parsePayload('{"action":"opened","number":1}')
    expect(parsed).toMatchObject({ action: 'opened', number: 1 })
  })

  it('parsePayload 对非 JSON、数组、标量抛 400', () => {
    expect(() => parsePayload('oops')).toThrow(WebhookHttpError)
    expect(() => parsePayload('[1,2]')).toThrow(WebhookHttpError)
    expect(() => parsePayload('42')).toThrow(WebhookHttpError)
  })
})

describe('validateConfig 与 apply 装配', () => {
  const valid = { source: 'github-main', path: '/hooks/github', secretEnv: 'GITHUB_SECRET', maxBodyBytes: 1024 }

  it('合法配置不抛错', () => {
    expect(() => validateConfig(valid)).not.toThrow()
  })

  it('source 为空/含空白/非 trim 拒绝', () => {
    expect(() => validateConfig({ ...valid, source: '' })).toThrow(/source/)
    expect(() => validateConfig({ ...valid, source: ' a ' })).toThrow(/source/)
  })

  it('path 必须为绝对非根路径且无尾斜杠/查询/片段', () => {
    expect(() => validateConfig({ ...valid, path: 'hooks' })).toThrow(/path/)
    expect(() => validateConfig({ ...valid, path: '/' })).toThrow(/path/)
    expect(() => validateConfig({ ...valid, path: '/a/' })).toThrow(/path/)
    expect(() => validateConfig({ ...valid, path: '/a?x=1' })).toThrow(/path/)
  })

  it('maxBodyBytes 必须为正安全整数', () => {
    expect(() => validateConfig({ ...valid, maxBodyBytes: 0 })).toThrow(/maxBodyBytes/)
    expect(() => validateConfig({ ...valid, maxBodyBytes: 1.5 })).toThrow(/maxBodyBytes/)
  })

  it('apply 在 webserver 端口注册精确路由并返回清理器', () => {
    const fixture = createGitHubFixture()
    const release = apply(fixture.ports, valid)
    expect(fixture.webServer.routes).toHaveLength(1)
    expect(fixture.webServer.routes[0]!.kind).toBe('exact')
    expect(fixture.webServer.routes[0]!.path).toBe('/hooks/github')
    expect(typeof release).toBe('function')
    release!()
    expect(fixture.webServer.releasedRoutes).toContain('/hooks/github')
    expect(fixture.webServer.routes).toHaveLength(0)
  })
})