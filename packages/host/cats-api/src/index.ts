/**
 * @flowforge/host-cats-api — cats HTTP 挂载插件（T8.3a 前置）。
 *
 * 把 `@flowforge/cats-routes`（Web Fetch 契约）挂到既有宿主
 * `@flowforge/host-webserver` 的 `ctx.webServer` 前缀路由上：handler 内先做
 * `node:http` ↔ Fetch 适配，再委托 `createCatsRoutesRouter`，最后按白名单
 * 加 CORS 头写回。不新建 server、不引入 Web 框架、不内联业务规则——业务
 * 语义全在 cats 域既有 service/store。
 *
 * 注册（cordis.patch.yml）：
 * ```yaml
 * - name: '@flowforge/host-webserver'
 * - name: '@flowforge/host-cats-api'
 * ```
 *
 * @module @flowforge/host-cats-api
 */

import type { Context } from '@flowforge/cordis'
// 载入 ctx.webServer 的模块增强（声明合并在宿主包内，必须显式引用）。
import type {} from '@flowforge/host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createCatsRoutesRouter, type CatsRoutesDeps } from '@flowforge/cats-routes'
import { toRequest, writeResponse } from './adapter.ts'
import { DEFAULT_ALLOWED_ORIGINS, applyCors } from './cors.ts'

/** 挂载前缀：与 cats-routes 的 profile 路由组对齐。 */
export const CATS_API_PREFIX = '/api/profile-updates'

export interface CatsApiOptions {
  /** 端口实现注入（缺省空依赖：未注入的域返回 404）。 */
  readonly routes?: CatsRoutesDeps | undefined
  readonly allowedOrigins?: readonly string[] | undefined
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * 把 cats-routes 挂载到 ctx.webServer 的 /api/profile-updates 前缀。
 * @returns 卸载路由的 disposer。
 */
export function mountCatsApi(ctx: Context, options: CatsApiOptions = {}): () => void {
  const allowed = options.allowedOrigins ?? [...DEFAULT_ALLOWED_ORIGINS]
  const route = createCatsRoutesRouter(options.routes ?? {})
  return ctx.webServer.register({
    kind: 'prefix',
    path: CATS_API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const base = `http://${ctx.webServer.host}:${ctx.webServer.port}`
        const request = await toRequest(req, base)
        const response = await route(request)
        await writeResponse(res, applyCors(response, request.headers.get('origin'), allowed))
      } catch {
        await writeResponse(res, json(500, { ok: false, error: 'internal error' }))
      }
    },
  })
}

export default function plugin(ctx: Context, options?: CatsApiOptions): void {
  ctx.effect(() => mountCatsApi(ctx, options ?? {}), 'host-cats-api: mount')
}
