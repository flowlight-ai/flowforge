/**
 * @flowforge/webhook-github pure http — 无状态 HTTP 解析/响应助手。
 *
 * 移植来源：dsh `webhook-github` 的 `handler.ts` 中抽取的纯函数（requiredHeader、
 * isJsonContentType、respond、parsePayload）。无端口依赖，逐字/语义等价保留。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { snapshotJsonValue } from '@flowforge/webhook'
import { WebhookHttpError } from '../body.ts'
import type { GitHubJsonObject } from '../types.ts'

/** 要求一个无歧义的非空请求头。 */
export function requiredHeader(request: IncomingMessage, name: string): string {
  const values = request.headersDistinct[name]
  const value = values?.[0]
  if (values?.length !== 1 || value === undefined || value.trim() === '') {
    throw new WebhookHttpError(400, `missing ${name} header`)
  }
  return value
}

/** Content-Type 是否为最多一个 UTF-8 charset 参数的 JSON。 */
export function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  const parts = value.split(';').map(part => part.trim())
  const [mediaType, parameter, ...extra] = parts
  if (mediaType?.toLowerCase() !== 'application/json') return false
  if (parameter === undefined) return true
  return extra.length === 0 && /^charset=(?:utf-8|"utf-8")$/i.test(parameter)
}

/** 恰好发送一次空或纯文本响应。 */
export function respond(response: ServerResponse, status: number, message?: string): void {
  if (message === undefined) {
    response.writeHead(status)
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(message)
}

/** 把一个解析值转换为适配器的通用签名对象保证。 */
export function parsePayload(body: string): GitHubJsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // JSON.parse 是 try 内唯一语句；没有其它失败被归一化。
    throw new WebhookHttpError(400, 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WebhookHttpError(400, 'GitHub webhook payload must be a JSON object')
  }
  const snapshot = snapshotJsonValue(parsed)
  if (snapshot === undefined) throw new WebhookHttpError(400, 'GitHub webhook payload is not lossless JSON')
  return snapshot as GitHubJsonObject
}