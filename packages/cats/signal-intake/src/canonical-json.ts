/**
 * 信号准入域工具：规范化 JSON 序列化与 SHA-256 摘要。
 *
 * 忠实移植 clowder-ai `domains/signal-intake/canonical-json.ts`。
 * 供幂等结算键 / 来源身份键 / 路由键 / 规范摘要计算固定字节。
 *
 * @flowforge/cats-signal-intake
 */

import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function digestCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}