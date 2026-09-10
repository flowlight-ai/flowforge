import { describe, expect, it } from 'vitest'
import { canonicalClientTimeZone } from '../src/index.ts'

describe('canonicalClientTimeZone', () => {
  it('accepts UTC verbatim', () => {
    expect(canonicalClientTimeZone('UTC')).toBe('UTC')
  })

  it('accepts a canonical IANA Area/Location zone', () => {
    expect(canonicalClientTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(canonicalClientTimeZone('America/New_York')).toBe('America/New_York')
  })

  it('resolves an alias to the canonical zone name', () => {
    const canonical = canonicalClientTimeZone('US/Eastern')
    // Intl's resolvedOptions().timeZone is the canonical name (commonly
    // America/New_York); an alias must never leak through.
    expect(canonical).toBe('America/New_York')
  })

  it('handles a numeric-offset-looking zone when the runtime can resolve it', () => {
    // Reject outright: no Area/Location slash for the offset spelling.
    expect(canonicalClientTimeZone('GMT+8')).toBeUndefined()
  })

  it('rejects empty and whitespace-padded names', () => {
    expect(canonicalClientTimeZone('')).toBeUndefined()
    expect(canonicalClientTimeZone('   ')).toBeUndefined()
    expect(canonicalClientTimeZone(' Asia/Shanghai')).toBeUndefined()
    expect(canonicalClientTimeZone('Asia/Shanghai ')).toBeUndefined()
  })

  it('rejects a name with no Area/Location slash', () => {
    expect(canonicalClientTimeZone('Europe')).toBeUndefined()
    expect(canonicalClientTimeZone('foo')).toBeUndefined()
    expect(canonicalClientTimeZone('NotAZone')).toBeUndefined()
  })

  it('rejects an unknown IANA zone rather than throwing', () => {
    expect(canonicalClientTimeZone('Mars/OlympusMons')).toBeUndefined()
    expect(canonicalClientTimeZone('America/does-not-exist')).toBeUndefined()
  })
})