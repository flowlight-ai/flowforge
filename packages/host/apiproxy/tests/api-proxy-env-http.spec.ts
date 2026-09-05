/**
 * env.summary over real HTTP: node:http server ← toFetchHandler(createApiProxy(
 * real cordis Context + EnvRegistryService)), client side real fetch →
 * AbstractApiClient subclass. The in-memory carrier specs cover envelope/framing
 * invariants with scripted impls; this spec covers the network leg end to end —
 * wire-level zod parse, byte-level secret non-leak, editable whitelist, and
 * absent-registry internal error.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as nodeHttp from 'node:http'
import { Context } from '@flowforge/cordis'
import EnvRegistryService from '@flowforge/harness-env-registry'
import UserQuestionService from '@flowforge/user-questions'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { AbstractApiClient } from '../src/fetch/client.ts'
import type { EnvVariableView } from '../src/api/env.ts'
import type { RequestPayload, ResponseValue } from '../src/api/rpc-map.ts'
import type { RpcResponse } from '../src/api/rpc.ts'

const SECRET = 'sk-e2e-leak-9f3a7c1b'

class HttpApiClient extends AbstractApiClient {
  constructor(private readonly origin: string) { super() }
  protected override doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return fetch(new URL(input.pathname + input.search, this.origin), init)
  }
}

let server: nodeHttp.Server | undefined
let url = ''
let bareServer: nodeHttp.Server | undefined
let bareUrl = ''

async function bootApi(withRegistry: boolean): Promise<{ server: nodeHttp.Server; url: string }> {
  const ctx = new Context()
  await ctx.plugin(UserQuestionService)
  if (withRegistry) await ctx.plugin(EnvRegistryService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  const handler = toFetchHandler(api)
  const srv = nodeHttp.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method ?? 'GET',
      headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
      ...(body.length > 0 ? { body } : {}),
    })
    const response = await handler.fetch(request)
    const bytes = Buffer.from(await response.arrayBuffer())
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(bytes)
  })
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
  const address = srv.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server: srv, url: `http://127.0.0.1:${address.port}` }
}

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = SECRET
  const withRegistry = await bootApi(true)
  server = withRegistry.server
  url = withRegistry.url
  const withoutRegistry = await bootApi(false)
  bareServer = withoutRegistry.server
  bareUrl = withoutRegistry.url
})

afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY
  server?.close()
  bareServer?.close()
})

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = SECRET
})

function assertOk(response: RpcResponse<ResponseValue<'env.summary'>>): { variables: readonly EnvVariableView[]; categories: Record<string, string> } {
  if (!response.result.ok) throw new Error(`env.summary failed: ${JSON.stringify(response.result)}`)
  return response.result.value
}

describe('env.summary over real HTTP', () => {
  it('returns zod-valid projection: variables + categories', async () => {
    const client = new HttpApiClient(url)
    const value = assertOk(await client.env.summary({} satisfies RequestPayload<'env.summary'>))
    expect(value.variables.length).toBeGreaterThan(0)
    expect(Object.keys(value.categories).length).toBeGreaterThan(0)
    for (const variable of value.variables) {
      expect(variable.name.length).toBeGreaterThan(0)
      expect(typeof variable.category).toBe('string')
      expect(variable.currentValue === null || typeof variable.currentValue === 'string').toBe(true)
    }
  })

  it('secret never appears in transport bytes (raw body inspection)', async () => {
    const response = await fetch(new URL('/api/env.summary', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-raw-1', method: 'env.summary', payload: {} }),
    })
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(raw.includes(SECRET)).toBe(false)
    const parsed = JSON.parse(raw) as { result: { ok: boolean; value?: { variables: readonly EnvVariableView[] } } }
    expect(parsed.result.ok).toBe(true)
    const keyEntry = parsed.result.value?.variables.find(variable => variable.name === 'ANTHROPIC_API_KEY')
    expect(keyEntry?.sensitive).toBe(true)
    expect(keyEntry?.masked).toBe(true)
    expect(keyEntry?.currentValue).toBe('***')
  })

  it('editable whitelist and allowedValues survive the wire', async () => {
    const client = new HttpApiClient(url)
    const { variables } = assertOk(await client.env.summary({}))
    const byName = new Map(variables.map(variable => [variable.name, variable]))
    expect(byName.get('ANTHROPIC_API_KEY')?.editable).toBe(true)
    expect(byName.get('FF_GLOBAL_CONFIG_ROOT')?.editable).toBe(false)
    expect(byName.get('CAT_CODEX_SANDBOX_MODE')?.allowedValues).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
  })

  it('composition without env-registry reports internal over the wire', async () => {
    const client = new HttpApiClient(bareUrl)
    const response = await client.env.summary({})
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error.code).toBe('internal')
      expect(response.result.error.message).toContain('env registry is absent')
    }
  })
})
