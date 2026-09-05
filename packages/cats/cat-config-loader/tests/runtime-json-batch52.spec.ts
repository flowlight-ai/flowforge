/**
 * 批次52：runtime-json 新增 proxy-upstreams / provider-profiles 两 kind。
 */

import { describe, expect, it } from 'vitest'
import {
  RuntimeJsonStore,
  runtimeProxyUpstreamsSchema,
  runtimeProviderProfileSchema,
} from '../src/runtime-json.ts'

function storeWith(content: string | null): RuntimeJsonStore {
  return new RuntimeJsonStore('/data/cat-cafe', {
    readFile: (filePath) => (filePath.endsWith('.json') ? content : null),
    writeFile: () => {},
  })
}

describe('runtime-json 批次52 两文档', () => {
  it('proxy-upstreams：slug→条目映射，非法 slug/密钥形态拒绝', () => {
    const parsed = runtimeProxyUpstreamsSchema.parse({
      'relay-a': { baseUrl: 'https://gw.example.com', credentialRef: 'cred-1' },
    })
    expect(parsed['relay-a']?.baseUrl).toBe('https://gw.example.com')
    expect(() =>
      runtimeProxyUpstreamsSchema.parse({
        Bad_Slug: { baseUrl: 'https://gw.example.com' },
      }),
    ).toThrow()
    expect(() =>
      runtimeProxyUpstreamsSchema.parse({
        'relay-b': { baseUrl: 'https://gw.example.com', apiKey: 'sk-plain' },
      }),
    ).toThrow() // strict：apiKey 未声明（凭据走 credentialRef，红线 11）
  })

  it('provider-profiles：oauth/api_key 契约 + strict 拒绝未知键', () => {
    const parsed = runtimeProviderProfileSchema.parse({
      id: 'p1',
      authType: 'api_key',
      baseUrl: 'https://api.example.com',
      models: ['m1'],
      modelAliases: { fast: 'm1' },
      envVars: { FOO: 'bar' },
      credentialRef: 'cred-2',
    })
    expect(parsed.authType).toBe('api_key')
    expect(() => runtimeProviderProfileSchema.parse({ id: 'p2', authType: 'basic' })).toThrow()
    expect(() => runtimeProviderProfileSchema.parse({ id: 'p3', authType: 'oauth', apiKey: 'sk' })).toThrow()
  })

  it('RuntimeJsonStore 读校验两 kind：缺失 null、非法拒绝、写入走注入 fs', async () => {
    const ok = storeWith(JSON.stringify({
      'relay-a': { baseUrl: 'https://gw.example.com' },
    }))
    const upstreams = ok.readTyped('proxy-upstreams') as Record<string, { baseUrl: string }>
    expect(upstreams['relay-a']?.baseUrl).toBe('https://gw.example.com')

    const missing = storeWith(null)
    expect(missing.readTyped('proxy-upstreams')).toBeNull()

    const bad = storeWith('{ "Bad!": { "baseUrl": "x" } }')
    expect(() => bad.readTyped('proxy-upstreams')).toThrow()

    const profiles = storeWith(JSON.stringify([
      { id: 'p1', authType: 'oauth' },
    ]))
    expect(profiles.readTyped('provider-profiles')).toHaveLength(1)

    let written: string | undefined
    const writer = new RuntimeJsonStore('/data/cat-cafe', {
      writeFile: (_path, content) => {
        written = content
      },
    })
    await writer.write('provider-profiles', [{ id: 'p1', authType: 'oauth' }])
    expect(written).toContain('oauth')
  })
})
