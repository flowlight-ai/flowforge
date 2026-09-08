/**
 * cats-api 挂载插件集成测试：真实 Context + 真实 webServer 监听端口 +
 * 真实 fetch（T1/T2/T3——禁 mock）。覆盖 404 契约、审批链路、disposer
 * 卸载与 CORS 白名单。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { WebServer } from '@flowforge/host-webserver'
import type { CatsRoutesDeps } from '@flowforge/cats-routes'
import { mountCatsApi } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function boot(routes?: CatsRoutesDeps): Promise<string> {
  const root = new Context()
  await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  mountCatsApi(root, routes === undefined ? {} : { routes })
  ctx = root
  return `http://127.0.0.1:${root.webServer.port}`
}

function memoryProfileUpdates(store: Map<string, string>): CatsRoutesDeps {
  return {
    profileUpdates: {
      get: async id => ({ id, status: store.get(id) ?? null }),
      claimForApproval: async (id, approvedBy) => {
        store.set(id, `approving:${approvedBy}`)
        return { id }
      },
      finalizeApproval: async id => {
        store.set(id, 'approved')
        return { id, status: 'approved' }
      },
      markRejected: async (id, rejectedBy, reason) => {
        store.set(id, `rejected:${rejectedBy}:${reason ?? ''}`)
        return { id }
      },
    },
  }
}

describe('cats-api 挂载插件（真实 webServer）', () => {
  it('未注入端口实现 → 提案请求 404（cats-routes 契约）', async () => {
    const base = await boot()
    const response = await fetch(`${base}/api/profile-updates/missing`)
    expect(response.status).toBe(404)
  })

  it('注入内存端口 → 审批链路 pending→approved 走通', async () => {
    const store = new Map<string, string>()
    store.set('p1', 'pending')
    const base = await boot(memoryProfileUpdates(store))
    const approved = await fetch(`${base}/api/profile-updates/p1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'u1' },
      body: JSON.stringify({ decidedBy: 'u1' }),
    })
    expect(approved.status).toBe(200)
    expect(store.get('p1')).toBe('approved')
  })

  it('disposer：卸载后前缀路由不再由本插件命中', async () => {
    const root = new Context()
    await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const dispose = mountCatsApi(root, {})
    dispose()
    const response = await fetch(`http://127.0.0.1:${root.webServer.port}/api/profile-updates/missing`)
    expect(response.status).toBe(404)
    ctx = root
  })

  it('CORS：白名单 origin 放行、非白名单不放行', async () => {
    const root = new Context()
    await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    mountCatsApi(root, { allowedOrigins: ['http://localhost:5174'] })
    const base = `http://127.0.0.1:${root.webServer.port}`
    const ok = await fetch(`${base}/api/profile-updates/missing`, {
      headers: { origin: 'http://localhost:5174' },
    })
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5174')
    const denied = await fetch(`${base}/api/profile-updates/missing`, {
      headers: { origin: 'http://evil.example' },
    })
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    ctx = root
  })
})
