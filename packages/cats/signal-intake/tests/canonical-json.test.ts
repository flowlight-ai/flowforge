/**
 * 规范化 JSON 与 SHA-256 摘要契约：确定性、键排序、嵌套规范化。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { canonicalJson, digestCanonical } from '../src/canonical-json.ts'

describe('canonicalJson', () => {
  it('sort object keys lexicographically for stable bytes', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(JSON.parse(canonicalJson({ b: 1, a: 2 }))).toEqual({ a: 2, b: 1 })
  })

  it('normalizes nested objects and arrays recursively', () => {
    const left = { nested: { z: [1, 2], y: { b: 1, a: 2 } } }
    const right = { nested: { y: { a: 2, b: 1 }, z: [1, 2] } }
    expect(canonicalJson(left)).toBe(canonicalJson(right))
  })

  it('preserves scalar and null values', () => {
    expect(canonicalJson('x')).toBe(JSON.stringify('x'))
    expect(canonicalJson(42)).toBe('42')
    expect(canonicalJson(null)).toBe('null')
  })
})

describe('digestCanonical', () => {
  it('is deterministic for the same logical object', () => {
    const a = digestCanonical({ pluginId: 'p', signalType: 's' })
    const b = digestCanonical({ signalType: 's', pluginId: 'p' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different content', () => {
    expect(digestCanonical({ payload: 'x' })).not.toBe(digestCanonical({ payload: 'y' }))
  })
})