/**
 * @flowforge/plugin-codebase — Cypher parser (EP-CB3, T4.1b).
 *
 * Recursive-descent parser over the lexer output, producing a read-only AST
 * aligned with the C source project's cbm_query_t subset: MATCH patterns
 * (alternating node/rel), WHERE expression tree, RETURN items (alias/func/
 * distinct), ORDER BY, SKIP, LIMIT. Write clauses are already rejected by the
 * lexer; here we enforce structural validation (e.g. absent RETURN is rejected
 * as a usage error, ORDER BY key count cap for loud errors only — see T4.1b).
 *
 * @module @flowforge/plugin-codebase/cypher-parser
 */

import type { CypherToken, CypherTokenType } from './cypher-lexer.ts'
import { UsageError } from './query.ts'

/** Unbounded relationship hop is clamped to this ceiling (C parity). */
export const MAX_HOPS = 64
/** ORDER BY key count upper bound (C `CBM_CYPHER_ORDER_KEYS_MAX`). */
export const ORDER_KEYS_MAX = 8

export interface PropFilter {
  readonly key: string
  /** Raw literal text (unquoted for strings). */
  readonly value: string
  readonly kind: 'string' | 'number' | 'boolean'
}

export interface NodePattern {
  variable?: string
  label?: string
  props: PropFilter[]
}

export interface RelPattern {
  variable?: string
  types: string[]
  direction: 'outbound' | 'inbound' | 'any'
  minHops: number
  /** 0 = unbounded (clamped to MAX_HOPS at execution). */
  maxHops: number
}

/** A single pattern = alternating [node, rel, node, rel, ...]. */
export interface CypherPattern {
  readonly nodes: readonly NodePattern[]
  readonly rels: readonly RelPattern[]
  readonly optional: boolean
}

export interface Condition {
  readonly variable: string
  readonly property?: string
  readonly op: '=' | '<>' | '=~' | '>' | '<' | '>=' | '<=' | 'CONTAINS'
    | 'STARTS WITH' | 'ENDS WITH' | 'IN' | 'IS NULL' | 'IS NOT NULL'
  readonly value: string
  readonly inValues?: readonly string[]
}

export interface WhereExpr {
  readonly kind: 'and' | 'or' | 'xor' | 'not' | 'condition'
  readonly left?: WhereExpr
  readonly right?: WhereExpr
  readonly cond?: Condition
}

export interface ReturnItem {
  readonly variable: string
  readonly property?: string
  readonly alias?: string
  /** COUNT/SUM/AVG/MIN/MAX/COLLECT — undefined for a bare column. */
  readonly func?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COLLECT'
  readonly distinct: boolean
}

export interface OrderKey {
  readonly key: string
  readonly desc: boolean
}

export interface CypherQuery {
  readonly patterns: readonly CypherPattern[]
  readonly where: WhereExpr | undefined
  readonly returnItems: readonly ReturnItem[]
  readonly returnDistinct: boolean
  readonly orderBy: readonly OrderKey[]
  readonly skip: number
  readonly limit: number
}

class Parser {
  private readonly tokens: readonly CypherToken[]
  private ptr = 0

  constructor(tokens: readonly CypherToken[]) {
    this.tokens = tokens
  }

  private peek(): CypherToken {
    return this.tokens[this.ptr] as CypherToken
  }

  private next(): CypherToken {
    const token = this.tokens[this.ptr] as CypherToken
    if (token.type !== 'EOF') this.ptr += 1
    return token
  }

  private expect(type: CypherTokenType): CypherToken {
    const token = this.next()
    if (token.type !== type) {
      throw new UsageError(`Cypher 语法错误：期望 ${type}，收到 "${token.text || token.type}"（位置 ${token.pos}）`)
    }
    return token
  }

  private eat(type: CypherTokenType): boolean {
    if (this.peek().type === type) {
      this.next()
      return true
    }
    return false
  }

  private is(type: CypherTokenType): boolean {
    return this.peek().type === type
  }

  private identText(): string {
    const token = this.next()
    if (token.type !== 'IDENT') throw new UsageError(`Cypher 语法错误：期望标识符，收到 "${token.text || token.type}"`)
    return token.text
  }

  parse(): CypherQuery {
    // OPTIONAL? MATCH pattern [, pattern]*
    const patterns: CypherPattern[] = []
    let where: WhereExpr | undefined
    const returnItems: ReturnItem[] = []
    let returnDistinct = false
    let orderBy: OrderKey[] = []
    let skip = 0
    let limit = 0

    let optional = this.eat('OPTIONAL')
    this.expect('MATCH')
    patterns.push({ ...this.parsePattern(), optional })
    while (this.eat('COMMA')) {
      optional = this.eat('OPTIONAL')
      patterns.push({ ...this.parsePattern(), optional })
    }

    if (this.eat('WHERE')) {
      where = this.parseOr()
    }

    if (this.eat('RETURN')) {
      returnDistinct = this.eat('DISTINCT')
      returnItems.push(...this.parseReturnItems())
    } else {
      throw new UsageError('Cypher 查询缺少 RETURN 子句')
    }

    if (this.eat('ORDER') && this.expect('BY')) {
      orderBy = this.parseOrderBy()
    }
    if (this.eat('SKIP')) {
      skip = this.parseInt('SKIP')
    }
    if (this.eat('LIMIT')) {
      limit = this.parseInt('LIMIT')
    }

    if (!this.is('EOF')) {
      const tail = this.peek()
      throw new UsageError(`Cypher 语法错误：RETURN 后存在未消费的 token "${tail.text || tail.type}"（位置 ${tail.pos}）`)
    }

    return { patterns, where, returnItems, returnDistinct, orderBy, skip, limit }
  }

  private parseInt(kind: string): number {
    const token = this.next()
    if (token.type !== 'NUMBER') throw new UsageError(`Cypher 语法错误：${kind} 需要一个数字，收到 "${token.text || token.type}"`)
    const value = Number.parseInt(token.text, 10)
    if (!Number.isFinite(value) || value < 0) throw new UsageError(`Cypher 语法错误：${kind} 需要非负整数，收到 "${token.text}"`)
    return value
  }

  private parsePattern(): { nodes: readonly NodePattern[]; rels: readonly RelPattern[] } {
    const nodes: NodePattern[] = []
    const rels: RelPattern[] = []
    nodes.push(this.parseNode())
    while (this.isRelStart()) {
      rels.push(this.parseRel())
      nodes.push(this.parseNode())
    }
    return { nodes, rels }
  }

  private isRelStart(): boolean {
    const t = this.peek().type
    return t === 'DASH' || t === 'LT' || t === 'GT'
  }

  private parseNode(): NodePattern {
    this.expect('LPAREN')
    const node: NodePattern = { props: [] }
    if (this.is('IDENT')) {
      node.variable = this.identText()
    }
    if (this.eat('COLON')) {
      node.label = this.identText()
    }
    if (this.eat('LBRACE')) {
      while (!this.is('RBRACE')) {
        const key = this.identText()
        this.expect('COLON')
        const valueToken = this.next()
        let kind: PropFilter['kind']
        let value: string
        if (valueToken.type === 'STRING') {
          kind = 'string'
          value = this.unquote(valueToken.text)
        } else if (valueToken.type === 'NUMBER') {
          kind = 'number'
          value = valueToken.text
        } else if (valueToken.type === 'IDENT' && (valueToken.text === 'true' || valueToken.text === 'false')) {
          kind = 'boolean'
          value = valueToken.text
        } else {
          throw new UsageError(`Cypher 语法错误：{prop} 只接受字符串/数字/布尔字面量，收到 "${valueToken.text || valueToken.type}"`)
        }
        node.props.push({ key, value, kind })
        if (!this.eat('COMMA')) break
      }
      this.expect('RBRACE')
    }
    this.expect('RPAREN')
    return node
  }

  private parseRel(): RelPattern {
    const rel: RelPattern = { types: [], direction: 'outbound', minHops: 1, maxHops: 1 }
    // left connector: `<-` (inbound) or `-`
    const first = this.peek().type
    let seesLeftArrow = false
    if (first === 'LT') {
      seesLeftArrow = true
      this.next() // <
      this.expect('DASH') // -
    } else {
      this.expect('DASH') // -
    }
    if (this.is('LBRACKET')) this.parseRelBody(rel)
    // trailing connector: always a DASH shaft, with optional `>` arrowhead:
    //   `-` → any, `<-...-` → inbound, `->` → outbound, `<-...->` → any
    this.expect('DASH')
    if (this.eat('GT')) rel.direction = seesLeftArrow ? 'any' : 'outbound'
    else rel.direction = seesLeftArrow ? 'inbound' : 'any'
    return rel
  }

  private parseRelBody(rel: RelPattern): void {
    this.expect('LBRACKET')
    if (this.is('IDENT')) {
      rel.variable = this.identText()
    }
    if (this.eat('COLON')) {
      rel.types = [this.identText()]
      while (this.eat('PIPE')) rel.types.push(this.identText())
    }
    if (this.eat('STAR')) {
      // * / *1 / *1..3 / *..3  — bare `*` means unbounded (maxHops 0)
      let min: number | undefined
      let max: number | undefined
      if (this.is('NUMBER')) {
        min = this.parseInt('hops')
        max = min
      }
      if (this.eat('DOTDOT')) {
        if (this.is('NUMBER')) max = this.parseInt('hops')
        else max = 0
      } else if (min === undefined && max === undefined) {
        max = 0 // bare `*` → unbounded
      }
      rel.minHops = Math.min(min ?? 1, MAX_HOPS)
      rel.maxHops = max === 0 ? 0 : Math.min(max ?? rel.minHops, MAX_HOPS)
    }
    this.expect('RBRACKET')
  }

  private parseOr(): WhereExpr {
    let left = this.parseAnd()
    while (this.is('OR')) {
      this.next()
      const right = this.parseAnd()
      left = { kind: 'or', left, right }
    }
    return left
  }

  private parseAnd(): WhereExpr {
    let left = this.parseNot()
    while (this.is('AND')) {
      this.next()
      const right = this.parseNot()
      left = { kind: 'and', left, right }
    }
    return left
  }

  private parseNot(): WhereExpr {
    if (this.is('NOT')) {
      this.next()
      return { kind: 'not', left: this.parseNot() }
    }
    return this.parseCondition()
  }

  private parseCondition(): WhereExpr {
    // Bail out on clause boundaries that never begin a condition.
    const t = this.peek().type
    if (t === 'RETURN' || t === 'EOF' || t === 'AND' || t === 'OR' || t === 'XOR' || t === 'RPAREN') {
      throw new UsageError('Cypher 语法错误：WHERE 中需要条件表达式')
    }
    const variable = this.identText()
    // variable.property path
    let property: string | undefined
    if (this.eat('DOT')) property = this.identText()
    // `variable[.property] IN [list]`
    if (this.is('IN')) {
      this.next()
      this.expect('LBRACKET')
      const items: string[] = []
      while (!this.is('RBRACKET')) {
        items.push(this.parseValueToken())
        if (!this.eat('COMMA')) break
      }
      this.expect('RBRACKET')
      return { kind: 'condition', cond: { variable, ...(property === undefined ? {} : { property }), op: 'IN', value: '', inValues: items } }
    }
    // operator
    const opToken = this.next()
    let op: Condition['op']
    let value = ''
    let inValues: readonly string[] | undefined
    switch (opToken.type) {
      case 'EQ': op = '='; break
      case 'NEQ': op = '<>'; break
      case 'EQTILDE': op = '=~'; break
      case 'GT': op = '>'; break
      case 'LT': op = '<'; break
      case 'GTE': op = '>='; break
      case 'LTE': op = '<='; break
      case 'CONTAINS': op = 'CONTAINS'; break
      case 'IS': {
        if (this.eat('NOT')) {
          this.expect('NULL')
          op = 'IS NOT NULL'
        } else {
          this.expect('NULL')
          op = 'IS NULL'
        }
        return { kind: 'condition', cond: { variable, ...(property === undefined ? {} : { property }), op, value } }
      }
      default:
        throw new UsageError(`Cypher 语法错误：WHERE 中未知操作符 "${opToken.text || opToken.type}"`)
    }
    // CONTAINS / STARTS WITH / ENDS WITH need follow-up keyword
    if (op === 'CONTAINS') {
      // value comes next (STRING/IDENT/NUMBER)
      value = this.parseValueToken()
    } else {
      value = this.parseValueToken()
    }
    return { kind: 'condition', cond: { variable, ...(property === undefined ? {} : { property }), op, value, ...(inValues === undefined ? {} : { inValues }) } }
  }

  private parseValueToken(): string {
    const token = this.next()
    if (token.type === 'STRING') return this.unquote(token.text)
    if (token.type === 'NUMBER') return token.text
    throw new UsageError(`Cypher 语法错误：WHERE 值需要字符串或数字，收到 "${token.text || token.type}"`)
  }

  private parseReturnItems(): ReturnItem[] {
    // RETURN * is not supported by this subset.
    const items: ReturnItem[] = []
    for (;;) {
      items.push(this.parseReturnItem())
      if (!this.eat('COMMA')) break
    }
    return items
  }

  private parseReturnItem(): ReturnItem {
    // func(variable[.property]) or variable[.property] [AS alias]
    let func: ReturnItem['func'] | undefined
    let distinct = false
    if (this.is('COUNT') || this.is('SUM') || this.is('AVG') || this.is('MIN') || this.is('MAX') || this.is('COLLECT')) {
      const token = this.next()
      func = token.type as ReturnItem['func']
      if (this.eat('DISTINCT')) distinct = true
      this.expect('LPAREN')
      const variable = this.identText()
      let property: string | undefined
      if (this.eat('DOT')) property = this.identText()
      this.expect('RPAREN')
      const item: ReturnItem = { variable, ...(property === undefined ? {} : { property }), ...(func === undefined ? {} : { func }), distinct }
      return this.maybeAlias(item)
    }
    const variable = this.identText()
    let property: string | undefined
    if (this.eat('DOT')) property = this.identText()
    const item: ReturnItem = { variable, ...(property === undefined ? {} : { property }), distinct }
    return this.maybeAlias(item)
  }

  private maybeAlias(item: ReturnItem): ReturnItem {
    if (this.eat('AS')) {
      const alias = this.identText()
      return { ...item, alias }
    }
    return item
  }

  private parseOrderBy(): OrderKey[] {
    const keys: OrderKey[] = []
    for (;;) {
      const token = this.next()
      if (token.type !== 'IDENT') throw new UsageError(`Cypher 语法错误：ORDER BY 需要列名，收到 "${token.text || token.type}"`)
      let key = token.text
      if (this.eat('DOT')) {
        key = `${key}.${this.identText()}`
      }
      let desc = false
      if (this.is('DESC') || this.is('ASC')) {
        const dir = this.next().type
        desc = dir === 'DESC'
      }
      keys.push({ key, desc })
      if (!this.eat('COMMA')) break
    }
    if (keys.length > ORDER_KEYS_MAX) {
      throw new UsageError(`Cypher ORDER BY 排序键超过上限 ${ORDER_KEYS_MAX} 个（对齐 C #1334：超限必须响亮报错而非静默丢弃）`)
    }
    return keys
  }

  private unquote(text: string): string {
    if (text.length < 2) return ''
    const inner = text.slice(1, -1)
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
  }
}

/** Parse a token stream into a CypherQuery AST. */
export function parseCypher(tokens: readonly CypherToken[]): CypherQuery {
  return new Parser(tokens).parse()
}