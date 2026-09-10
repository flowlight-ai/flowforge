import { describe, it, expect } from 'vitest'
import { buildCommandLine, quoteArg } from '../src/quote.ts'

/** Unit tests for the CommandLineToArgvW-compatible quoting helpers. */
describe('quoteArg', () => {
  it('keeps a bare argument untouched', () => {
    expect(quoteArg('plain')).toBe('plain')
    expect(quoteArg('c:\\tools\\node.exe')).toBe('c:\\tools\\node.exe')
  })

  it('quotes an empty argument as an empty quoted string', () => {
    expect(quoteArg('')).toBe('""')
  })

  it('quotes arguments containing whitespace', () => {
    expect(quoteArg('a b')).toBe('"a b"')
    expect(quoteArg('  leading-space')).toBe('"  leading-space"')
  })

  it('escapes embedded double quotes with backslashes', () => {
    expect(quoteArg('say "hi"')).toBe('"say \\"hi\\""')
  })

  it('doubles a trailing run of backslashes before the closing quote', () => {
    // A trailing "\" (behind whitespace that forces quoting) must be doubled
    // so the closing quote is not escaped.
    expect(quoteArg('trail \\')).toBe('"trail \\\\"')
  })

  it('escapes backslashes preceding a quote', () => {
    expect(quoteArg('a\\"b')).toBe('"a\\\\\\"b"')
  })
})

/** Unit tests for building a full Win32 command line. */
describe('buildCommandLine', () => {
  it('joins program and args with single spaces', () => {
    expect(buildCommandLine('node', ['-e', '1', 'two words']))
      .toBe('node -e 1 "two words"')
  })

  it('round-trips: no args produces the bare program', () => {
    expect(buildCommandLine('node', [])).toBe('node')
  })
})