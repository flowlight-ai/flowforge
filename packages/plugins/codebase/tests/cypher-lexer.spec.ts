/**
 * Cypher lexer suite (EP-CB3, T4.1a) — read-only query subset tokenization.
 *
 * Pins keyword recognition, IDENT/STRING/NUMBER literals, symbol classes,
 * compound operators (=~, >=, ..), and the loud rejection of write/admin
 * keywords and unknown characters (UsageError).
 */

import { describe, expect, it } from 'vitest'
import { tokenizeCypher, UsageError } from '../src/index.ts'

function types(query: string): string[] {
  return tokenizeCypher(query).map(token => token.type)
}

describe('tokenizeCypher keywords', () => {
  it('recognizes query subset keywords case-insensitively', () => {
    const tokens = tokenizeCypher('MATCH (n) RETURN n ORDER BY n.name DESC')
    const typesList = tokens.map(token => token.type)
    expect(typesList).toContain('MATCH')
    expect(typesList).toContain('RETURN')
    expect(typesList).toContain('ORDER')
    expect(typesList).toContain('BY')
    expect(typesList).toContain('DESC')
    expect(tokens[0]?.text).toBe('MATCH')
  })

  it('recognizes boolean/logical and function keywords', () => {
    expect(types('RETURN COUNT(x)')).toContain('COUNT')
    expect(types('WHERE a AND b OR NOT c')).toEqual(expect.arrayContaining(['WHERE', 'AND', 'OR', 'NOT']))
    expect(types('RETURN DISTINCT a.name')).toContain('DISTINCT')
    expect(types('RETURN n LIMIT 5')).toContain('LIMIT')
    expect(types('RETURN n SKIP 2')).toContain('SKIP')
  })

  it('rejects write/admin keywords as UsageError at lex time', () => {
    for (const bad of ['CREATE', 'delete', 'MERGE node', 'SET x = 1', 'DETACH DELETE x', 'CALL fn()']) {
      expect(() => tokenizeCypher(bad)).toThrow(UsageError)
    }
  })
})

describe('tokenizeCypher literals', () => {
  it('parses IDENT and NUMBER tokens', () => {
    const tokens = tokenizeCypher('MATCH (n) RETURN n.limit WHERE n.count > 3')
    const seen = new Set(tokens.map(token => token.type))
    expect(seen.has('IDENT')).toBe(true)
    expect(seen.has('NUMBER')).toBe(true)
  })

  it('parses single-quoted strings', () => {
    const tokens = tokenizeCypher("MATCH (n) WHERE n.name = 'cloud' RETURN n")
    const stringToken = tokens.find(token => token.type === 'STRING')
    expect(stringToken?.text).toBe("'cloud'")
  })

  it('parses double-quoted strings with escape sequences', () => {
    const tokens = tokenizeCypher('RETURN n WHERE n.name = "a\\"b"')
    const stringToken = tokens.find(token => token.type === 'STRING')
    expect(stringToken?.text).toBe('"a\\"b"')
  })

  it('throws UsageError on unterminated strings', () => {
    expect(() => tokenizeCypher('RETURN n WHERE n.name = "unterminated')).toThrow(UsageError)
  })
})

describe('tokenizeCypher symbols', () => {
  it('emits single-character symbol tokens', () => {
    expect(types('MATCH (n)-[:REL*1..3]->(m)')).toEqual(
      expect.arrayContaining(['LPAREN', 'IDENT', 'RPAREN', 'DASH', 'LBRACKET', 'RBRACKET', 'STAR', 'COLON']),
    )
  })

  it('emits compound operators =~, >=, <=, <> and ..', () => {
    expect(types('WHERE n.name =~ "x"')).toContain('EQTILDE')
    expect(types('WHERE n.lines >= 3')).toContain('GTE')
    expect(types('WHERE n.lines <= 3')).toContain('LTE')
    expect(types('WHERE n.lines <> 3')).toContain('NEQ')
    const hop = tokenizeCypher('MATCH (a)-[:CALLS*1..3]->(b) RETURN b')
    expect(hop.some(token => token.type === 'DOTDOT')).toBe(true)
  })

  it('rejects the length-arrow arrow operator =>', () => {
    expect(() => tokenizeCypher('MATCH (a)=> (b) RETURN b')).toThrow(UsageError)
  })

  it('throws UsageError on unknown characters', () => {
    expect(() => tokenizeCypher('MATCH (n) RETURN n @')).toThrow(UsageError)
    expect(() => tokenizeCypher('RETURN n $')).toThrow(UsageError)
  })
})

describe('tokenizeCypher terminals', () => {
  it('always terminates with EOF and records byte positions', () => {
    const tokens = tokenizeCypher('MATCH (n) RETURN n')
    const eof = tokens[tokens.length - 1]
    expect(eof?.type).toBe('EOF')
    expect(eof?.pos).toBe('MATCH (n) RETURN n'.length)
    for (const token of tokens.slice(0, -1)) {
      expect(typeof token.pos).toBe('number')
    }
  })

  it('normalizes CRLF line endings', () => {
    const tokens = tokenizeCypher('MATCH (n)\r\nRETURN n')
    expect(tokens.some(token => token.type === 'RETURN')).toBe(true)
  })
})