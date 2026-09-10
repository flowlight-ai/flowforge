import { describe, expect, it } from 'vitest'
import { bytesToBase64, randomUUID, type Uuid } from '../src/index.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('bytesToBase64', () => {
  it('encodes the empty byte array', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
  })

  it('encodes a known canonical base64 string', () => {
    expect(bytesToBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('3q2+7w==')
  })

  it('encodes a byte run longer than the 0x8000 argument-limit chunk', () => {
    const data = new Uint8Array(0x10000)
    for (let index = 0; index < data.length; index++) data[index] = index % 256
    // Round-trips through the browser-safe decoder: the chunked loop must not
    // overflow a fromCharCode argument list.
    const restored = new Uint8Array(Buffer.from(bytesToBase64(data), 'base64'))
    expect(restored).toEqual(data)
  })

  it('round-trips arbitrary bytes through the standard decoder', () => {
    const data = new Uint8Array(257)
    for (let index = 0; index < data.length; index++) data[index] = (index * 7 + 3) % 256
    const restored = new Uint8Array(Buffer.from(bytesToBase64(data), 'base64'))
    expect(restored).toEqual(data)
  })
})

describe('randomUUID', () => {
  it('returns a string matching the RFC 9562 textual shape', () => {
    const uuid: Uuid = randomUUID()
    expect(UUID_RE.test(uuid)).toBe(true)
  })

  it('sets version 4 in the timestamp nibble and the RFC 4122 variant', () => {
    const uuid = randomUUID()
    expect(uuid[14]).toBe('4')
    const variantNibble = uuid[19]
    expect(variantNibble).toMatch(/^[89ab]$/)
  })

  it('mints distinct ids across calls', () => {
    const a = randomUUID()
    const b = randomUUID()
    const c = randomUUID()
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('is a valid lowercase RFC 9562 v4 UUID in full', () => {
    // Version 4 nibble + RFC 4122 variant, all lowercase hex.
    expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})