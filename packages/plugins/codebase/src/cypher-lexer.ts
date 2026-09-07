/**
 * @flowforge/plugin-codebase — Cypher lexer (EP-CB3, T4.1a).
 *
 * Ported from codebase-memory-mcp's src/cypher/cypher.h lexer subset (the
 * TOK_* enumeration). We keep the read-only query clause set and **reject**
 * write/admin keywords (CREATE/DELETE/SET/MERGE/... ) loudly as UsageErrors —
 * this engine is query-only, mirroring the C engine's "recognized-but-
 * unsupported" stance.
 *
 * @module @flowforge/plugin-codebase/cypher-lexer
 */

import { UsageError } from './query.ts'

export type CypherTokenType =
  // keywords (query subset)
  | 'MATCH' | 'OPTIONAL' | 'WHERE' | 'RETURN' | 'ORDER' | 'BY' | 'LIMIT' | 'SKIP'
  | 'AND' | 'OR' | 'XOR' | 'NOT' | 'AS' | 'ASC' | 'DESC' | 'DISTINCT'
  | 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COLLECT'
  | 'CONTAINS' | 'STARTS' | 'ENDS' | 'WITH' | 'IN' | 'IS' | 'NULL' | 'UNION' | 'UNWIND'
  // symbols
  | 'LPAREN' | 'RPAREN' | 'LBRACKET' | 'RBRACKET' | 'DASH' | 'GT' | 'LT'
  | 'COLON' | 'DOT' | 'LBRACE' | 'RBRACE' | 'STAR' | 'COMMA' | 'EQ' | 'EQTILDE'
  | 'GTE' | 'LTE' | 'NEQ' | 'PIPE' | 'DOTDOT'
  // literals
  | 'IDENT' | 'STRING' | 'NUMBER' | 'EOF'

export interface CypherToken {
  readonly type: CypherTokenType
  readonly text: string
  /** Byte offset in the source query. */
  readonly pos: number
}

const KEYWORDS: Readonly<Record<string, CypherTokenType>> = {
  MATCH: 'MATCH',
  OPTIONAL: 'OPTIONAL',
  WHERE: 'WHERE',
  RETURN: 'RETURN',
  ORDER: 'ORDER',
  BY: 'BY',
  LIMIT: 'LIMIT',
  SKIP: 'SKIP',
  AND: 'AND',
  OR: 'OR',
  XOR: 'XOR',
  NOT: 'NOT',
  AS: 'AS',
  ASC: 'ASC',
  DESC: 'DESC',
  DISTINCT: 'DISTINCT',
  COUNT: 'COUNT',
  SUM: 'SUM',
  AVG: 'AVG',
  MIN: 'MIN',
  MAX: 'MAX',
  COLLECT: 'COLLECT',
  CONTAINS: 'CONTAINS',
  STARTS: 'STARTS',
  ENDS: 'ENDS',
  WITH: 'WITH',
  IN: 'IN',
  IS: 'IS',
  NULL: 'NULL',
  UNION: 'UNION',
  UNWIND: 'UNWIND',
}

/** Write/admin keywords rejected at lex time (C parity for query-only engine). */
const WRITE_KEYWORDS: Readonly<Set<string>> = new Set([
  'CREATE', 'DELETE', 'DETACH', 'SET', 'REMOVE', 'MERGE', 'YIELD', 'CALL',
  'FOREACH', 'ON', 'ADD', 'CONSTRAINT', 'DO', 'DROP', 'FOR', 'FROM', 'GRAPH',
  'OF', 'REQUIRE', 'SCALAR', 'UNIQUE',
])

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch)
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

/**
 * Tokenize a Cypher query string. Throws UsageError on unsupported write
 * keywords, unterminated strings and unknown characters.
 */
export function tokenizeCypher(input: string): readonly CypherToken[] {
  const src = input.replace(/\r\n/g, '\n')
  const tokens: CypherToken[] = []
  let index = 0
  const n = src.length
  const push = (type: CypherTokenType, start: number): void => {
    tokens.push({ type, text: src.slice(start, index), pos: start })
  }

  while (index < n) {
    const ch = src[index] as string
    // whitespace
    if (/\s/.test(ch)) {
      index += 1
      continue
    }
    const start = index
    // identifiers / keywords
    if (isIdentStart(ch)) {
      index += 1
      while (index < n && isIdentChar(src[index] as string)) index += 1
      const word = src.slice(start, index)
      const upper = word.toUpperCase()
      if (WRITE_KEYWORDS.has(upper)) {
        throw new UsageError(`Cypher 写/管理子句不受支持（${word}）——本引擎只读查询`)
      }
      const keyword = KEYWORDS[upper]
      push(keyword ?? 'IDENT', start)
      continue
    }
    // numbers — consume digits, then at most one decimal `.x`; stop before `..`
    // so `1..3` tokenizes as NUMBER(1) DOTDOT NUMBER(3), not a single NUMBER.
    if (isDigit(ch) || (ch === '.' && isDigit(src[index + 1]))) {
      index += 1
      while (index < n && isDigit(src[index] as string)) index += 1
      if (src[index] === '.' && isDigit(src[index + 1] as string)) {
        index += 1
        while (index < n && isDigit(src[index] as string)) index += 1
      }
      push('NUMBER', start)
      continue
    }
    // strings (single or double quote)
    if (ch === "'" || ch === '"') {
      const quote = ch
      index += 1
      let closed = false
      while (index < n) {
        const current = src[index] as string
        if (current === '\\') {
          index += 2
          continue
        }
        if (current === quote) {
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) throw new UsageError(`Cypher 字符串未闭合：${src.slice(start, Math.min(start + 20, n))}`)
      push('STRING', start)
      continue
    }
    // two-char symbols
    const two = src.slice(index, index + 2)
    if (two === '=>') { throw new UsageError('Cypher ARROW (=>) 不受支持') }
    if (two === '=~') { index += 2; push('EQTILDE', start); continue }
    if (two === '>=') { index += 2; push('GTE', start); continue }
    if (two === '<=') { index += 2; push('LTE', start); continue }
    if (two === '<>') { index += 2; push('NEQ', start); continue }
    if (two === '..') { index += 2; push('DOTDOT', start); continue }
    // one-char symbols
    const single: Readonly<Record<string, CypherTokenType>> = {
      '(': 'LPAREN', ')': 'RPAREN', '[': 'LBRACKET', ']': 'RBRACKET',
      '-': 'DASH', '>': 'GT', '<': 'LT', ':': 'COLON', '.': 'DOT',
      '{': 'LBRACE', '}': 'RBRACE', '*': 'STAR', ',': 'COMMA', '=': 'EQ',
      '|': 'PIPE',
    }
    const mapped = single[ch] as CypherTokenType | undefined
    if (mapped !== undefined) {
      index += 1
      tokens.push({ type: mapped, text: src.slice(start, index), pos: start })
      continue
    }
    throw new UsageError(`Cypher 未知字符 "${ch}"（位置 ${start}）`)
  }

  tokens.push({ type: 'EOF', text: '', pos: n })
  return tokens
}