/**
 * 本地 token 估算契约：单调性与边界回归。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../src/extract/token-estimate.ts'

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('is monotone non-decreasing with content length', () => {
    let previous = 0
    for (let length = 1; length <= 50; length += 1) {
      const value = estimateTokens('a'.repeat(length))
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('counts non-ASCII characters heuristically heavier than ASCII', () => {
    expect(estimateTokens('中文')).toBeGreaterThan(estimateTokens('ab'))
  })
})