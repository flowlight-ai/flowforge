import { describe, expect, it } from 'vitest'
import {
  assertNever,
  deepEqualJson,
  deepFreeze,
  isJsonValue,
  snapshotJsonValue,
  type JsonValue,
} from '../src/index.ts'

describe('assertNever', () => {
  it('throws with the rendered value and optional context', () => {
    expect(() => assertNever('LEAKED' as never)).toThrow(/unreachable variant: "LEAKED"/)
    expect(() => assertNever(42 as never, 'switchSite')).toThrow(/in switchSite/)
  })

  it('renders symbol-like or unstringifiable values without throwing on coercion', () => {
    expect(() => assertNever(Symbol('x') as never)).toThrow()
  })
})

describe('isJsonValue / snapshotJsonValue', () => {
  it('accepts primitives and nested JSON', () => {
    const value = { a: 1, b: [true, 'x', null], c: { d: 2.5 } }
    expect(isJsonValue(value)).toBe(true)
    expect(snapshotJsonValue(value)).toEqual(value)
  })

  it('detaches a mutated-immune snapshot rather than aliasing the input', () => {
    const value: { list: Array<{ n: number }> } = { list: [{ n: 1 }] }
    const snapshot = snapshotJsonValue(value)!
    value.list.push({ n: 9 })
    expect(snapshot).toEqual({ list: [{ n: 1 }] })
  })

  it('rejects non-finite and negative-zero numbers i.e. lossy JSON', () => {
    expect(isJsonValue(NaN)).toBe(false)
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isJsonValue(-0)).toBe(false)
    expect(isJsonValue({ x: NaN })).toBe(false)
  })

  it('rejects non-JSON leaves: undefined, bigint, function, symbol', () => {
    expect(isJsonValue(undefined)).toBe(false)
    expect(isJsonValue(10n)).toBe(false)
    expect(isJsonValue(() => {})).toBe(false)
    expect(isJsonValue(Symbol('s'))).toBe(false)
    expect(isJsonValue({ a: undefined })).toBe(false)
  })

  it('rejects cyclic references', () => {
    const node: Record<string, unknown> = {}
    node.self = node
    expect(isJsonValue(node)).toBe(false)
    expect(snapshotJsonValue(node)).toBeUndefined()
    const arr: unknown[] = []
    arr.push(arr)
    expect(isJsonValue(arr)).toBe(false)
  })

  it('rejects non-plain prototypes and non-enumerable / symbol keys JSON would discard', () => {
    // A class instance is not a plain record.
    expect(isJsonValue(new Date())).toBe(false)
    // A symbol key must not silently round-trip to nothing.
    const symbolKeyed: Record<PropertyKey, unknown> = {}
    symbolKeyed[Symbol('hidden')] = 1
    expect(isJsonValue(symbolKeyed)).toBe(false)
    // Sparse arrays and subclassed arrays are not lossless JSON.
    const sparse: JsonValue[] = []
    sparse[2] = 'x' as never
    expect(isJsonValue(sparse)).toBe(false)
  })
})

describe('deepEqualJson', () => {
  it('compares primitives and object-identity shortcuts', () => {
    expect(deepEqualJson(1, 1)).toBe(true)
    expect(deepEqualJson('a', 'a')).toBe(true)
    expect(deepEqualJson(null, null)).toBe(true)
    expect(deepEqualJson(1, 2)).toBe(false)
    expect(deepEqualJson('a', 'b')).toBe(false)
  })

  it('compares nested arrays and objects structurally', () => {
    expect(deepEqualJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqualJson({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
    expect(deepEqualJson([1, 2], [1, 2])).toBe(true)
    expect(deepEqualJson([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqualJson([1, 2], { 0: 1, 1: 2 })).toBe(false)
  })

  it('distinguishes object key-set differences regardless of order', () => {
    expect(deepEqualJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqualJson({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(deepEqualJson({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })
})

describe('deepFreeze', () => {
  it('deep-freezes nested objects and arrays and returns the same value', () => {
    const value = { a: [1, { b: 2 }], c: 'x' }
    const frozen = deepFreeze(value)
    expect(frozen).toBe(value)
    expect(Object.isFrozen(value.a)).toBe(true)
    expect(Object.isFrozen((value.a[1] as { b: number }))).toBe(true)
    expect(() => { (frozen as { a: unknown[] }).a.push(3) }).toThrow()
  })

  it('leaves live AbortSignal objects mutable', () => {
    const controller = new AbortController()
    const signal = controller.signal
    deepFreeze({ signal })
    expect(Object.isFrozen(signal)).toBe(false)
    controller.abort('cancel')
    expect(signal.aborted).toBe(true)
  })

  it('handles shared and cyclic references without infinite recursion', () => {
    const shared = { x: 1 }
    const node: Record<string, unknown> = { a: shared, b: shared }
    node.self = node
    expect(() => deepFreeze(node)).not.toThrow()
    expect(Object.isFrozen(shared)).toBe(true)
    expect(Object.isFrozen(node)).toBe(true)
  })

  it('leaves primitives and null untouched', () => {
    expect(deepFreeze(3)).toBe(3)
    expect(deepFreeze('s')).toBe('s')
    expect(deepFreeze(null)).toBe(null)
    expect(deepFreeze(undefined)).toBeUndefined()
  })
})