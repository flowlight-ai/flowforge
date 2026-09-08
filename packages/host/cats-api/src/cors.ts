/**
 * CORS 白名单助手（@flowforge/host-cats-api）。
 *
 * 只放行本地 dev origin，禁止通配 `*`——dev 前端跑在 5174，网关与前端
 * 同机同环，跨域面不需要放大。
 *
 * @module @flowforge/host-cats-api/cors
 */

export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5174', 'http://127.0.0.1:5174'] as const

/** 为白名单内的 origin 追加 CORS 头；不在白名单则原样返回。 */
export function applyCors(
  response: Response,
  origin: string | null,
  allowed: readonly string[],
): Response {
  if (origin === null || !allowed.includes(origin)) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}
