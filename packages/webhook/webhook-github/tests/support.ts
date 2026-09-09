/**
 * @flowforge/webhook-github 测试辅助 — node:http 假件 + 签名工具。
 *
 * 仅伪造 Node 内建 http.IncomingMessage / ServerResponse（非被测模块），供契约测试
 * 驱动 readBoundedUtf8Body 与 GitHub handler。T9 禁止的是 mock 被测模块，这里不涉及。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { computeHmacSha256Hex } from '../src/pure/signature.ts'

/** 内存 IncomingMessage 假件。 */
export interface FakeIncomingInput {
  readonly method?: string
  readonly headers?: Record<string, string | undefined>
  readonly chunks?: readonly (Buffer | string)[]
  readonly complete?: boolean
}

/** 构造一个可异步迭代的 IncomingMessage 假件。 */
export function fakeIncoming(input: FakeIncomingInput): IncomingMessage {
  const chunks = input.chunks ?? []
  const headers: Record<string, string | undefined> = {}
  const headersDistinct: Record<string, string[] | undefined> = {}
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    headers[key] = value
    headersDistinct[key] = value === undefined ? undefined : [value]
  }
  const request = {
    method: input.method ?? 'POST',
    headers,
    headersDistinct,
    complete: input.complete ?? true,
    resume() { /* noop */ },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  return request as unknown as IncomingMessage
}

/** 捕获响应的内存 ServerResponse 假件。 */
export class FakeResponse {
  status: number = 0
  body = ''
  headers: Record<string, string> = {}
  ended = false

  /** 返回供 handler 使用的 ServerResponse 视图。 */
  get view(): ServerResponse {
    const self = this
    const response: ServerResponse = {
      writeHead(status: number) {
        self.status = status
        return response
      },
      setHeader(name: string, value: string) {
        self.headers[name] = value
      },
      end(message?: unknown) {
        self.ended = true
        if (message !== undefined) self.body = String(message)
        return self as never
      },
    } as unknown as ServerResponse
    return response
  }
}

/** 用共享密钥为 body 制作 `x-hub-signature-256` 头值。 */
export function signatureHeader(secret: string, body: string): string {
  return `sha256=${computeHmacSha256Hex(secret, body)}`
}

export { computeHmacSha256Hex }