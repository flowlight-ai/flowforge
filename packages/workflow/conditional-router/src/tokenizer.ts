/**
 * Tokenizer for the condition language.
 *
 * The legacy implementation leaned on Python's `ast` module; TypeScript has no
 * equivalent, so this module (plus `parser.ts`) reproduces the restricted
 * grammar by hand. Keeping the grammar intentionally small is what makes
 * evaluation safe — anything the parser cannot represent is rejected before a
 * single value is touched.
 *
 * Lexical elements (mirrors the surface documented in `conditional_router.py`):
 *   - numbers          `0`, `0.8`, `10`
 *   - strings          `'high'`, `"high"` with backslash escapes
 *   - identifiers      `state`, `audit_result`, `topic_list`
 *   - comparison ops   `==` `!=` `<` `<=` `>` `>=`
 *   - punctuation      `(` `)` `[` `]` `.` `,` `-`
 *   - keywords         `and` `or` `not` `is` `in` `exists` `not_empty`
 *                      `contains` `true` `false` `none`
 */

import { ExpressionError } from './errors.js';

export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'keyword'
  | 'operator'
  | 'punctuation'
  | 'eof';

export interface Token {
  readonly type: TokenType;
  /** Normalised text: keywords lowercased, strings already unescaped. */
  readonly value: string;
  /** Numeric payload for `number` tokens. */
  readonly numeric?: number;
  readonly position: number;
}

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'is',
  'in',
  'exists',
  'not_empty',
  'contains',
  'true',
  'false',
  'none',
]);

const TWO_CHAR_OPERATORS = new Set(['==', '!=', '<=', '>=']);
const ONE_CHAR_OPERATORS = new Set(['<', '>', '-']);
const PUNCTUATION = new Set(['(', ')', '[', ']', '.', ',']);

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function unescape(raw: string, quote: string, position: number): string {
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = raw[index + 1];
    index += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case '\\':
        out += '\\';
        break;
      case quote:
        out += quote;
        break;
      case undefined:
        throw new ExpressionError(`Unterminated escape sequence at position ${position}`);
      default:
        out += next;
    }
  }
  return out;
}

/** Convert `expression` into tokens, ending with an `eof` sentinel. */
export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index] as string;

    // Whitespace is not significant.
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // Numbers (integers and decimals).
    if (isDigit(char)) {
      const start = index;
      while (index < expression.length && isDigit(expression[index] as string)) index += 1;
      if (expression[index] === '.') {
        index += 1;
        while (index < expression.length && isDigit(expression[index] as string)) index += 1;
      }
      const raw = expression.slice(start, index);
      tokens.push({ type: 'number', value: raw, numeric: Number(raw), position: start });
      continue;
    }

    // Strings.
    if (char === '"' || char === "'") {
      const start = index;
      const quote = char;
      index += 1;
      let raw = '';
      let closed = false;
      while (index < expression.length) {
        const current = expression[index] as string;
        if (current === '\\') {
          raw += current + (expression[index + 1] ?? '');
          index += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        raw += current;
        index += 1;
      }
      if (!closed) {
        throw new ExpressionError(`Unterminated string literal at position ${start}`);
      }
      tokens.push({ type: 'string', value: unescape(raw, quote, start), position: start });
      continue;
    }

    // Identifiers and keywords.
    if (isIdentifierStart(char)) {
      const start = index;
      while (index < expression.length && isIdentifierPart(expression[index] as string)) index += 1;
      const raw = expression.slice(start, index);
      if (KEYWORDS.has(raw)) {
        tokens.push({ type: 'keyword', value: raw, position: start });
      } else {
        tokens.push({ type: 'identifier', value: raw, position: start });
      }
      continue;
    }

    // Two-character operators before single-character ones.
    const pair = expression.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.has(pair)) {
      tokens.push({ type: 'operator', value: pair, position: index });
      index += 2;
      continue;
    }

    // A lone `=` or `!` is a common authoring mistake — report it precisely.
    if (char === '=' || char === '!') {
      throw new ExpressionError(
        `Unexpected character '${char}' at position ${index} (did you mean '${char}='?)`,
      );
    }

    if (ONE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: 'operator', value: char, position: index });
      index += 1;
      continue;
    }

    if (PUNCTUATION.has(char)) {
      tokens.push({ type: 'punctuation', value: char, position: index });
      index += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character '${char}' at position ${index}`);
  }

  tokens.push({ type: 'eof', value: '', position: index });
  return tokens;
}
