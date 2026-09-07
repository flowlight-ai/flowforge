/**
 * 批次55 cats routes 挂载层测试：真实 HTTP（node:http + fetch）贯穿四组路由，
 * 端口接入真实 Memory 后端（backlog / profile-update）与结构化桩（packs / memory-publish）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as nodeHttp from 'node:http'
import type { AddressInfo } from 'node:net'
import { MemoryBacklogStore, MemoryProfileUpdateProposalStore } from '@flowforge/cats-stores/memory'
import { createCatsRoutesRouter, type CatsRoutesDeps } from '../src/router.ts'

let root: string
const createdItems = new Map<string, Record<string, unknown>>()
const cleanup: Array<() => void> = []

async function mount(deps: CatsRoutesDeps): Promise<string> {
  const srv = nodeHttp.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method ?? 'GET',
      headers: {
        'content-type': req.headers['content-type'] ?? 'application/json',
        // 透传调用方的身份头；未提供时缺省 user-1
        ...(req.headers['x-user-id'] !== undefined
          ? { 'x-user-id': String(req.headers['x-user-id']) }
          : { 'x-user-id': 'user-1' }),
      },
      ...(body.length > 0 ? { body } : {}),
    })
    const response = await createCatsRoutesRouter(deps)(request)
    const bytes = Buffer.from(await response.arrayBuffer())
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(bytes)
  })
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => srv.close())
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
}

beforeAll(async () => {
  const backlogStore = new MemoryBacklogStore()
  const profileStore = new MemoryProfileUpdateProposalStore()
  root = await mount({
    packs: {
      add: async (source) => ({ name: `pack-${source}`, version: '1.0.0' }),
      list: async () => [{ name: 'pack-src', version: '1.0.0' }],
      remove: async (name) => name === 'pack-src',
    },
    packExporter: {
      exportMasks: (catConfig) => catConfig.breeds
        .filter((breed) => catConfig.roster[breed.catId]?.available === true)
        .map((breed) => ({ catId: breed.catId })),
    },
    backlog: {
      create: (input) => {
        const item = backlogStore.create(input)
        createdItems.set(item.id, item as unknown as Record<string, unknown>)
        return item
      },
      getById: (id) => backlogStore.getById(id),
      listForThread: (threadId, options) => backlogStore.listForThread(threadId, options),
      listByUser: async (userId) =>
        [...createdItems.values()].filter((item) => item['userId'] === userId),
    },
    selfClaimPolicy: { policy: async () => ({ enabled: true, maxPerCat: 3 }) },
    profileUpdates: profileStore,
    memoryPublish: {
      publish: async (input) => ({ ok: true, memoryId: `mem-${String(input['title'])}` }),
    },
  })
})

afterAll(() => {
  for (const fn of cleanup) fn()
})

describe('packs 路由（对齐 routes/packs.ts）', () => {
  it('POST /api/packs/add 201；载荷非法 400', async () => {
    const ok = await fetch(new URL('/api/packs/add', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'src' }),
    })
    expect(ok.status).toBe(201)
    expect(((await ok.json()) as Record<string, unknown>)['ok']).toBe(true)

    const bad = await fetch(new URL('/api/packs/add', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(bad.status).toBe(400)
  })

  it('安全错误 403 语义（error 含 security 关键字）', async () => {
    const guardRoot = await mount({
      packs: {
        add: async () => {
          throw new Error('security violation: path escape')
        },
        list: async () => [],
        remove: async () => false,
      },
    })
    const response = await fetch(new URL('/api/packs/add', guardRoot), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: '../escape' }),
    })
    expect(response.status).toBe(403)
  })

  it('GET /api/packs + DELETE /api/packs/:name', async () => {
    const list = await (await fetch(new URL('/api/packs', root))).json() as { packs: unknown[] }
    expect(list.packs).toHaveLength(1)
    const removed = await (await fetch(new URL('/api/packs/pack-src', root), { method: 'DELETE' })).json() as { removed: boolean }
    expect(removed.removed).toBe(true)
  })

  it('POST /api/packs/export：masks 按 roster.available 过滤；缺 catConfig 400', async () => {
    const response = await fetch(new URL('/api/packs/export', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'exported',
        catConfig: {
          breeds: [{ catId: 'a' }, { catId: 'b' }],
          roster: { a: { available: true }, b: { available: false } },
        },
      }),
    })
    const body = await response.json() as { ok: boolean; pack: { masks: Array<{ catId: string }> } }
    expect(body.ok).toBe(true)
    expect(body.pack.masks).toEqual([{ catId: 'a' }])

    const missing = await fetch(new URL('/api/packs/export', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(missing.status).toBe(400)
  })
})

describe('backlog 路由（对齐 routes/backlog.ts）', () => {
  it('POST /api/backlog/items 201 创建 + 无身份 401 + 非法 400', async () => {
    const created = await fetch(new URL('/api/backlog/items', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '集成积压项', summary: '批次55 挂载验收', priority: 'high', tags: ['e2e'], createdBy: 'cat-1' }),
    })
    expect(created.status).toBe(201)
    const item = await created.json() as Record<string, unknown>
    expect(item['title']).toBe('集成积压项')

    const noIdentity = await fetch(new URL('/api/backlog/items', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': '' },
      body: JSON.stringify({ title: 'x', summary: 'x', createdBy: 'c' }),
    })
    expect(noIdentity.status).toBe(401)

    const invalid = await fetch(new URL('/api/backlog/items', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    expect(invalid.status).toBe(400)
  })

  it('GET /api/backlog/items + self-claim-policy', async () => {
    const list = await (await fetch(new URL('/api/backlog/items', root))).json() as { items: unknown[] }
    expect(list.items.length).toBeGreaterThanOrEqual(1)
    const policy = await (await fetch(new URL('/api/backlog/self-claim-policy', root))).json() as Record<string, unknown>
    expect(policy['enabled']).toBe(true)
  })
})

describe('profile-updates 路由（对齐 routes/profile-update-decision-routes.ts）', () => {
  it('GET :id 404 / 创建→approve 全链 / reject 语义', async () => {
    const missing = await fetch(new URL('/api/profile-updates/nope', root))
    expect(missing.status).toBe(404)

    // 经真实 Memory store 创建提案（批次52 交付的端口形状）
    const { MemoryProfileUpdateProposalStore: Store } = await import('@flowforge/cats-stores/memory')
    const store = new Store()
    const proposal = store.create({
      sourceThreadId: 'st', sourceInvocationId: 'si', sourceCatId: 'cat-1' as never,
      targetLayer: 'persona-primer' as never, targetPath: 'a.md',
      beforeContent: 'b', baseContentHash: 'h', afterContent: 'a',
      rationale: 'r', signalProvenance: {} as never, createdBy: 'user-1',
    })
    const profileRoot = await mount({ profileUpdates: store })

    const got = await (await fetch(new URL(`/api/profile-updates/${proposal.proposalId}`, profileRoot))).json() as Record<string, unknown>
    expect(got['proposalId']).toBe(proposal.proposalId)

    const approve = await fetch(new URL(`/api/profile-updates/${proposal.proposalId}/approve`, profileRoot), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decidedBy: 'operator' }),
    })
    expect(approve.status).toBe(200)
    const body = await approve.json() as { ok: boolean; proposal: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.proposal['status']).toBe('approved')

    // 再 approve：status drifted → 404
    const again = await fetch(new URL(`/api/profile-updates/${proposal.proposalId}/approve`, profileRoot), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decidedBy: 'operator' }),
    })
    expect(again.status).toBe(404)

    // reject 新提案
    const p2 = store.create({
      sourceThreadId: 'st', sourceInvocationId: 'si', sourceCatId: 'cat-1' as never,
      targetLayer: 'persona-primer' as never, targetPath: 'b.md',
      beforeContent: 'b', baseContentHash: 'h', afterContent: 'a',
      rationale: 'r', signalProvenance: {} as never, createdBy: 'user-1',
    })
    void Store
    const reject = await fetch(new URL(`/api/profile-updates/${p2.proposalId}/reject`, profileRoot), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decidedBy: 'operator', rejectionReason: 'not now' }),
    })
    expect(reject.status).toBe(200)
  })
})

describe('memory-publish 路由（对齐 routes/memory-publish.ts）', () => {
  it('POST /api/memory/publish 200 + 非法 400 + 未知路径 404', async () => {
    const ok = await fetch(new URL('/api/memory/publish', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId: 'th-1', title: '发布', content: '内容', createdBy: 'cat-1' }),
    })
    expect(ok.status).toBe(200)
    const body = await ok.json() as Record<string, unknown>
    expect(body['ok']).toBe(true)

    const bad = await fetch(new URL('/api/memory/publish', root), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId: '' }),
    })
    expect(bad.status).toBe(400)

    const missing = await fetch(new URL('/api/nope', root))
    expect(missing.status).toBe(404)
  })
})
