/**
 * Source admission primitives — contract tests (T-D1).
 */
import { describe, expect, it } from 'vitest'
import { isBoundedScalarString, unicodeScalarLength } from '../src/contract/source-admission.js'

describe('unicodeScalarLength', () => {
  it('counts BMP code points as one each', () => {
    expect(unicodeScalarLength('abc')).toBe(3)
    expect(unicodeScalarLength('')).toBe(0)
  })

  it('counts surrogate pairs (astral scalars) as one each', () => {
    // '😀' is U+1F600 → a surrogate pair in UTF-16.
    expect(unicodeScalarLength('😀')).toBe(1)
    expect(unicodeScalarLength('a😀b')).toBe(3)
  })

  it('returns null for lone surrogates (malformed UTF-16)', () => {
    expect(unicodeScalarLength('\ud800')).toBeNull()
    expect(unicodeScalarLength('\udc00')).toBeNull()
  })
})

describe('isBoundedScalarString', () => {
  it('rejects non-strings and empty strings', () => {
    expect(isBoundedScalarString(123, 10)).toBe(false)
    expect(isBoundedScalarString(null, 10)).toBe(false)
    expect(isBoundedScalarString('', 10)).toBe(false)
  })

  it('enforces the max bound by scalar count, not UTF-16 code units', () => {
    // '😀😀' = 2 scalars but 4 UTF-16 units.
    expect(isBoundedScalarString('😀😀', 3)).toBe(true)
    expect(isBoundedScalarString('😀😀', 1)).toBe(false)
  })

  it('rejects malformed surrogate sequences fail-closed', () => {
    expect(isBoundedScalarString('a\ud800b', 10)).toBe(false)
  })
})