/**
 * @flowforge/webhook-github body — 受限原始 HTTP body 摄入（供签名校验）。
 *
 * 移植来源：dsh `webhook-github` 的 `body.ts`，逐字保留。无第三方依赖。
 * 用于在签名校验前精确、受限、UTF-8 严格解码请求体。
 */

import type { IncomingMessage } from 'node:http'

/** HTTP 拒绝，其消息安全（不携带请求数据）。 */
export class WebhookHttpError extends Error {
  override readonly name = 'WebhookHttpError'

  constructor(
    readonly status: 400 | 401 | 405 | 413 | 415 | 503,
    message: string,
  ) {
    super(message)
  }
}

/** 解析十进制 Content-Length 或拒绝歧义头部。 */
function contentLength(request: IncomingMessage): number | undefined {
  const value = request.headers['content-length']
  if (value === undefined) return undefined
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new WebhookHttpError(400, 'invalid Content-Length')
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new WebhookHttpError(413, 'request body is too large')
  return length
}

/**
 * 将一个请求体读取为精确、受限的 UTF-8 文本。
 * @param request - 任何解析器消费之前的入站请求。
 * @param maxBodyBytes - 正整数字节上限。
 * @returns EOF 之后的已解码 body。
 * @throws {WebhookHttpError} 长度非法、字节超限、UTF-8 非法或流中止。
 */
export async function readBoundedUtf8Body(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<string> {
  const declared = contentLength(request)
  if (declared !== undefined && declared > maxBodyBytes) {
    request.resume()
    throw new WebhookHttpError(413, 'request body is too large')
  }

  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new WebhookHttpError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof WebhookHttpError) throw error
    throw new WebhookHttpError(400, 'request body was aborted')
  }
  if (!request.complete) throw new WebhookHttpError(400, 'request body was aborted')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    // TextDecoder 是 try 内唯一语句；GitHub JSON 必须为合法 UTF-8。
    throw new WebhookHttpError(400, 'request body is not valid UTF-8')
  }
}