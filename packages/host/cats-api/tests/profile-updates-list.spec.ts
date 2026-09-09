/**
 * 档案提案列表端点集成测试（T8.3a-a1）：真实 Context + 真实 webServer 端口 +
 * 真实 fetch（T1/T2/T3——禁 mock）。
 *
 * 背景：根路径 `/api/profile-updates` 不在 `/:id` 正则覆盖内，此前直接落 404；
 * 本测试同时锁定 401（缺身份）、404（未知提案，回归保护）与 501（端口未实现
 * list）三类边界。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { WebServer } from '@flowforge/host-webserver'
import type { CatsRoutesDeps, ProfileUpdateListQuery } from '@flowforge/cats-routes'
import { mountCatsApi } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

const PROPOSALS = [
  { id: 'p1', status: 'pending', createdBy: 'u1' },
  { id: 'p2', status: 'approved', createdBy: 'u1' },
  { id: 'p3', status: 'pending', createdBy: 'u2' },
]

async function boot(deps: CatsRoutesDeps): Promise<string> {
  const root = new Context()
  await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  mountCatsApi(root, { routes: deps })
  ctx = root
  return `http://127.0.0.1:${root.webServer.port}`
}

function decisionPort(): Omit<NonNullable<CatsRoutesDeps['profileUpdates']>, 'list'> {
  return {
    get: async id => PROPOSALS.find(p => p.id === id) ?? null,
    claimForApproval: async () => ({}),
    finalizeApproval: async id => ({ id, status: 'approved' }),
    markRejected: async id => ({ id, status: 'rejected' }),
  }
}

function portWithList(): CatsRoutesDeps {
  return {
    profileUpdates: {
      ...decisionPort(),
      list: async (query: ProfileUpdateListQuery) => {
        const filtered = PROPOSALS.filter(p =>
          (query.status === undefined || p.status === query.status)
          && (query.createdBy === undefined || p.createdBy === query.createdBy))
        const start = query.cursor === undefined ? 0 : Number(query.cursor)
        const limit = query.limit ?? 50
        const page = filtered.slice(start, start + limit)
        const next = start + limit < filtered.length ? String(start + limit) : undefined
        return { items: page, ...(next === undefined ? {} : { nextCursor: next }) }
      },
    },
  }
}

describe('档案提案列表端点（真实 webServer）', () => {
  it('根路径返回 200 与全部提案（此前落 404）', async () => {
    const base = await boot(portWithList())
    const response = await fetch(`${base}/api/profile-updates`, { headers: { 'x-user-id': 'u1' } })
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string }> }
    expect(body.items.map(item => item.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('status 过滤与 limit 游标分页生效', async () => {
    const base = await boot(portWithList())
    const pending = await fetch(`${base}/api/profile-updates?status=pending`, { headers: { 'x-user-id': 'u1' } })
    const pendingBody = await pending.json() as { items: Array<{ id: string }> }
    expect(pendingBody.items.map(item => item.id)).toEqual(['p1', 'p3'])

    const firstPage = await fetch(`${base}/api/profile-updates?limit=2`, { headers: { 'x-user-id': 'u1' } })
    const firstBody = await firstPage.json() as { items: Array<{ id: string }>; nextCursor?: string }
    expect(firstBody.items).toHaveLength(2)
    expect(firstBody.nextCursor).toBe('2')
    const secondPage = await fetch(
      `${base}/api/profile-updates?limit=2&cursor=${firstBody.nextCursor ?? ''}`,
      { headers: { 'x-user-id': 'u1' } },
    )
    const secondBody = await secondPage.json() as { items: Array<{ id: string }> }
    expect(secondBody.items.map(item => item.id)).toEqual(['p3'])
  })

  it('缺身份头 → 401；/:id 未知提案仍 404（回归保护）', async () => {
    const base = await boot(portWithList())
    const denied = await fetch(`${base}/api/profile-updates`)
    expect(denied.status).toBe(401)
    const missing = await fetch(`${base}/api/profile-updates/nope`, { headers: { 'x-user-id': 'u1' } })
    expect(missing.status).toBe(404)
  })

  it('端口未实现 list → 501 且不掩盖既有决策链路', async () => {
    const base = await boot({ profileUpdates: decisionPort() })
    const unsupported = await fetch(`${base}/api/profile-updates`, { headers: { 'x-user-id': 'u1' } })
    expect(unsupported.status).toBe(501)
    const approved = await fetch(`${base}/api/profile-updates/p1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u1' },
      body: JSON.stringify({ decidedBy: 'u1' }),
    })
    expect(approved.status).toBe(200)
  })
})
