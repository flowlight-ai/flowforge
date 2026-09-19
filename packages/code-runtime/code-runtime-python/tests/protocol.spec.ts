import { describe, expect, it } from 'vitest'
import {
  encodeJsonPlain,
  hasNonLosslessNumber,
  hasUnsafeIntegerToken,
  validateChildFrame,
} from '../src/protocol.ts'

describe('hasNonLosslessNumber', () => {
  it('flags non-finite and negative-zero numbers anywhere in the value', () => {
    expect(hasNonLosslessNumber(Infinity)).toBe(true)
    expect(hasNonLosslessNumber(-Infinity)).toBe(true)
    expect(hasNonLosslessNumber(NaN)).toBe(true)
    expect(hasNonLosslessNumber(-0)).toBe(true)
    expect(hasNonLosslessNumber([1, [2, { a: { b: NaN } }]])).toBe(true)
    expect(hasNonLosslessNumber({ x: -0 })).toBe(true)
  })

  it('accepts every lossless scalar and container', () => {
    expect(hasNonLosslessNumber(null)).toBe(false)
    expect(hasNonLosslessNumber(false)).toBe(false)
    expect(hasNonLosslessNumber('text')).toBe(false)
    expect(hasNonLosslessNumber(0)).toBe(false)
    expect(hasNonLosslessNumber(-1)).toBe(false)
    expect(hasNonLosslessNumber(1.5)).toBe(false)
    expect(hasNonLosslessNumber([1, 'x', null, true, { a: [2, 3] }])).toBe(false)
  })
})

describe('hasUnsafeIntegerToken', () => {
  it('flags an integer token beyond the safe range that loses precision on parse', () => {
    expect(hasUnsafeIntegerToken('{"value":9007199254740993}')).toBe(true)
    expect(hasUnsafeIntegerToken('[9007199254740993, 1]')).toBe(true)
  })

  it('accepts a tree-parseable magnitude even beyond the safe range when it round-trips exactly', () => {
    // 2**53 parses to a double that round-trips verbatim, so it is lossless.
    expect(hasUnsafeIntegerToken('{"value":9007199254740992}')).toBe(false)
    expect(hasUnsafeIntegerToken('17')).toBe(false)
    expect(hasUnsafeIntegerToken('-5')).toBe(false)
    expect(hasUnsafeIntegerToken('1.5')).toBe(false)
    expect(hasUnsafeIntegerToken('"9007199254740993"')).toBe(false)
    expect(hasUnsafeIntegerToken('"note 2026"')).toBe(false)
  })
})

describe('encodeJsonPlain', () => {
  it('matches compact JSON.stringify byte for byte on lossless values', () => {
    const value = { a: 1, b: [null, 'x', { c: -1.5 }], d: true }
    expect(encodeJsonPlain(value)).toBe(JSON.stringify(value))
    expect(encodeJsonPlain('hi')).toBe('"hi"')
    expect(encodeJsonPlain(null)).toBe('null')
    expect(encodeJsonPlain([1, 2, 3])).toBe(JSON.stringify([1, 2, 3]))
    expect(encodeJsonPlain({})).toBe('{}')
    expect(encodeJsonPlain([])).toBe('[]')
  })

  it('emits an exactly-representable beyond-safe-range integral double in full integer digits', () => {
    // 2**53 is representable exactly yet outside the safe-integer bucket; the
    // iterative encoder keeps its full decimal via BigInt instead of rounding.
    const value = 2 ** 53
    expect(Number.isSafeInteger(value)).toBe(false)
    expect(encodeJsonPlain(value)).toBe(BigInt(value).toString())
    expect(encodeJsonPlain({ n: value })).toBe('{"n":9007199254740992}')
  })

  it('handles deep nesting without recursion', () => {
    let value: unknown = 'leaf'
    for (let depth = 0; depth < 30_000; depth++) value = [value]
    const text = encodeJsonPlain(value)
    expect(text.length).toBeGreaterThan(10_000)
    expect(text.endsWith('"leaf"]'.repeat(1).slice(6))).toBe(true)
  })
})

describe('validateChildFrame', () => {
  it('accepts well-formed boot-ack, log, call, and done frames', () => {
    expect(validateChildFrame({ type: 'boot-ack' })).toEqual({ type: 'boot-ack' })
    expect(validateChildFrame({ type: 'log', text: 'hello' })).toEqual({ type: 'log', text: 'hello' })
    expect(validateChildFrame({ type: 'call', id: 1, global: 'tools', name: 'echo', args: {} }))
      .toEqual({ type: 'call', id: 1, global: 'tools', name: 'echo', args: {} })
    expect(validateChildFrame({ type: 'done' })).toEqual({ type: 'done' })
    expect(validateChildFrame({ type: 'done', value: [1, null] })).toEqual({ type: 'done', value: [1, null] })
    expect(validateChildFrame({ type: 'done', error: { kind: 'exception', message: 'boom' } }))
      .toEqual({ type: 'done', error: { kind: 'exception', message: 'boom' } })
  })

  it('rebuilds frames and drops junk instead of leaking raw fields', () => {
    expect(validateChildFrame(null)).toBeUndefined()
    expect(validateChildFrame(42)).toBeUndefined()
    expect(validateChildFrame('junk')).toBeUndefined()
    expect(validateChildFrame([])).toBeUndefined()
    expect(validateChildFrame({ type: 'nope' })).toBeUndefined()
    expect(validateChildFrame({ type: 'log', text: null })).toBeUndefined()
    expect(validateChildFrame({ type: 'call', forged: true })).toBeUndefined()
    expect(validateChildFrame({ type: 'call', id: 'x', global: 'tools', name: 'echo', args: {} })).toBeUndefined()
    expect(validateChildFrame({ type: 'call', id: 1, global: 'tools', name: 'echo' })).toBeUndefined()
    expect(validateChildFrame({ type: 'call', id: 1, global: 'tools', name: 'echo', args: NaN })).toBeUndefined()
    // A lossy done value is intentionally left for the host's onDone gate to
    // reject as invalid-output, so validateChildFrame admits it.
    expect(validateChildFrame({ type: 'done', value: -0 })).toEqual({ type: 'done', value: -0 })
    expect(validateChildFrame({ type: 'done', error: 5 })).toBeUndefined()
    expect(validateChildFrame({ type: 'done', error: { kind: 'invented', message: 'x' } })).toBeUndefined()
  })
})