/**
 * Cypher parser suite (EP-CB3, T4.1b) — recursive-descent AST construction.
 *
 * Pins pattern shapes, relationship direction/multi-type/hop bounds,
 * WHERE expression trees (op set + precedence), RETURN projections,
 * ORDER BY/LIMIT/SKIP, and structural validation errors.
 */

import { describe, expect, it } from 'vitest'
import { parseCypher, tokenizeCypher, UsageError } from '../src/index.ts'

function parse(query: string): ReturnType<typeof parseCypher> {
  return parseCypher(tokenizeCypher(query))
}

describe('patterns', () => {
  it('parses a single anonymous node and a labeled node', () => {
    const anonymous = parse('MATCH () RETURN x')
    expect(anonymous.patterns[0]?.nodes[0]?.variable).toBeUndefined()
    const labeled = parse('MATCH (n:Function) RETURN n')
    const node = labeled.patterns[0]?.nodes[0]
    expect(node?.variable).toBe('n')
    expect(node?.label).toBe('Function')
  })

  it('parses inline property filters', () => {
    const parsed = parse('MATCH (n:Function {name: "updateCloudClient", lines: 3}) RETURN n')
    const props = parsed.patterns[0]?.nodes[0]?.props ?? []
    expect(props).toEqual([
      { key: 'name', value: 'updateCloudClient', kind: 'string' },
      { key: 'lines', value: '3', kind: 'number' },
    ])
  })

  it('parses relationship direction outbound/inbound/any', () => {
    const outbound = parse('MATCH (a)-[:CALLS]->(b) RETURN b')
    expect(outbound.patterns[0]?.rels[0]?.direction).toBe('outbound')
    const inbound = parse('MATCH (a)<-[:CALLS]-(b) RETURN b')
    expect(inbound.patterns[0]?.rels[0]?.direction).toBe('inbound')
    const any = parse('MATCH (a)-[:CALLS]-(b) RETURN b')
    expect(any.patterns[0]?.rels[0]?.direction).toBe('any')
  })

  it('parses multi-type and hop-bounded relationships', () => {
    const multi = parse('MATCH (a)-[:CALLS|USAGE]->(b) RETURN b')
    expect(multi.patterns[0]?.rels[0]?.types).toEqual(['CALLS', 'USAGE'])
    const bounded = parse('MATCH (a)-[:CALLS*1..3]->(b) RETURN b')
    expect(bounded.patterns[0]?.rels[0]?.minHops).toBe(1)
    expect(bounded.patterns[0]?.rels[0]?.maxHops).toBe(3)
    const unbounded = parse('MATCH (a)-[:CALLS*]->(b) RETURN b')
    expect(unbounded.patterns[0]?.rels[0]?.maxHops).toBe(0)
  })

  it('parses double and triple node chains', () => {
    const two = parse('MATCH (a)-[:CALLS]->(b) RETURN b')
    expect(two.patterns[0]?.nodes).toHaveLength(2)
    const three = parse('MATCH (a)-[:CALLS]->(b)-[:CALLS]->(c) RETURN c')
    expect(three.patterns[0]?.nodes).toHaveLength(3)
    expect(three.patterns[0]?.rels).toHaveLength(2)
  })
})

describe('WHERE expression trees', () => {
  it('parses comparison operators', () => {
    for (const op of ['=', '<>', '=~', '>', '<', '>=', '<=']) {
      const cond = (parse(`MATCH (n) WHERE n.name ${op} 'x' RETURN n`).where?.cond)!
      expect(cond.op).toBe(op)
    }
  })

  it('parses CONTAINS / IN / IS NOT NULL', () => {
    expect(parse("MATCH (n) WHERE n.name CONTAINS 'cloud' RETURN n").where?.cond?.op).toBe('CONTAINS')
    expect(parse('MATCH (n) WHERE n.lines IN [1, 2] RETURN n').where?.cond?.op).toBe('IN')
    expect(parse('MATCH (n) WHERE n.name IS NOT NULL RETURN n').where?.cond?.op).toBe('IS NOT NULL')
  })

  it('parses AND/OR/NOT precedence into a tree', () => {
    const expr = (parse('MATCH (n) WHERE n.a = 1 OR n.b = 2 AND NOT n.c = 3 RETURN n').where)!
    expect(expr.kind).toBe('or')
    expect(expr.right?.kind).toBe('and')
    expect(expr.right?.right?.kind).toBe('not')
  })
})

describe('RETURN / ORDER BY / LIMIT', () => {
  it('maps bare columns, aliases, functions and distinct', () => {
    const parsed = parse('MATCH (n) RETURN DISTINCT n.name AS label, COUNT(n) AS total')
    expect(parsed.returnDistinct).toBe(true)
    expect(parsed.returnItems[0]).toMatchObject({ variable: 'n', property: 'name', alias: 'label' })
    expect(parsed.returnItems[1]).toMatchObject({ variable: 'n', func: 'COUNT', alias: 'total', distinct: false })
  })

  it('parses ORDER BY keys and direction', () => {
    const parsed = parse('MATCH (n) RETURN n.name ORDER BY n.name DESC, n.lines')
    expect(parsed.orderBy).toEqual([
      { key: 'n.name', desc: true },
      { key: 'n.lines', desc: false },
    ])
  })

  it('parses LIMIT and SKIP', () => {
    const parsed = parse('MATCH (n) RETURN n SKIP 5 LIMIT 10')
    expect(parsed.skip).toBe(5)
    expect(parsed.limit).toBe(10)
  })

  it('rejects ORDER BY with more than 8 keys', () => {
    const keys = Array.from({ length: 9 }, (_, index) => `n.c${index}`).join(', ')
    expect(() => parse(`MATCH (n) RETURN n ORDER BY ${keys}`)).toThrow(UsageError)
  })
})

describe('structural validation', () => {
  it('rejects a query without RETURN', () => {
    expect(() => parse('MATCH (n)')).toThrow(UsageError)
  })

  it('rejects malformed syntax with a positional usage error', () => {
    expect(() => parse('MATCH (n RETURN n')).toThrow(UsageError)
  })

  it('rejects unmatched pattern tails', () => {
    expect(() => parse('RETURN n WHERE n.a')).toThrow(UsageError)
  })
})