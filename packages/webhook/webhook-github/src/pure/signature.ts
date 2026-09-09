/**
 * @flowforge/webhook-github signature — GitHub HMAC-SHA256 签名验证（包内自实现）。
 *
 * 移植来源：dsh `webhook-github` 使用 `@octokit/webhooks` 的
 * `new Webhooks({ secret }).verify(body, signature)`。取舍说明：本环境无
 * `@octokit/webhooks`（缺外部依赖），按任务约定在包内以纯函数自实现相同的 GitHub
 * webhook 签名协议——以 `x-hub-signature-256` 头（形如 `sha256=<hex>`）与对
 * request body 的 `sha256` HMAC 比较，恒定时间比对。协议与 octokit 一致，因此
 * 与 GitHub 官方发件人互操作。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** `x-hub-signature-256` 的标准前缀。 */
export const HMAC_SIGNATURE_PREFIX = 'sha256='

/** 计算 body 的 `sha256` HMAC 十六进制摘要。 */
export function computeHmacSha256Hex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

/** 长度常量：sha256 十六进制摘要为 64 字符。 */
const SHA256_HEX_LENGTH = 64

/**
 * 恒定时间校验一个 GitHub webhook 签名头。
 * @param secret - 共享 webhook 密钥（凭据解析结果）。
 * @param body - 原始请求体文本（签名于其上计算）。
 * @param signatureHeader - `x-hub-signature-256` 请求头原文。
 * @returns 签名合法时为 `true`。
 */
export function verifySignature(secret: string, body: string, signatureHeader: string): boolean {
  const received = signatureHeader.trim()
  if (!received.startsWith(HMAC_SIGNATURE_PREFIX)) return false
  const receivedHex = received.slice(HMAC_SIGNATURE_PREFIX.length)
  if (receivedHex.length !== SHA256_HEX_LENGTH || !/^[0-9a-f]+$/i.test(receivedHex)) return false
  const accepted = Buffer.from(receivedHex, 'hex')
  const expected = Buffer.from(computeHmacSha256Hex(secret, body), 'hex')
  return accepted.length === expected.length && timingSafeEqual(accepted, expected)
}