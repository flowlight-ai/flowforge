/**
 * node:http ↔ Fetch 适配层（@flowforge/host-cats-api）。
 *
 * `@flowforge/cats-routes` 是 Web Fetch 契约（`Request` → `Response`），而
 * `@flowforge/host-webserver` 交到路由手上的是原生 `IncomingMessage` /
 * `ServerResponse`。本模块补齐两种形态的往返转换——首版支持文本与 JSON
 * body（二进制/流式场景后续按需立项）。
 *
 * @module @flowforge/host-cats-api/adapter
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise<Buffer | undefined>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk as Buffer)))
    req.on('end', () => resolve(chunks.length === 0 ? undefined : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 把 node:http 入站消息转换为 Fetch Request（首版支持文本与 JSON body）。 */
export async function toRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const body = await readBody(req)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const method = req.method ?? 'GET'
  const init: RequestInit = { method, headers }
  // 复制为 Uint8Array<ArrayBuffer>：Buffer 的 ArrayBufferLike 不满足 BodyInit
  if (method !== 'GET' && method !== 'HEAD' && body !== undefined) init.body = new Uint8Array(body)
  return new Request(new URL(req.url ?? '/', baseUrl), init)
}

/** 把 Fetch Response 写回 node:http 出站响应。 */
export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}
