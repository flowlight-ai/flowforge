/**
 * Complexity calculator suite (EP-CB1, T2.2a) — real web-tree-sitter ASTs,
 * zero mocks (test ironclad rule T1–T9).
 *
 * Pins the C semantics (helpers.c L699-769): straight-line zero, branch
 * counting, Campbell cognitive nesting penalty, loop depth, chained access
 * depth and named-parameter counting.
 */

import { describe, expect, it } from 'vitest'
import type { Node } from 'web-tree-sitter'
import { computeComplexity, countParams } from '../src/index.ts'
import { createCodebaseParser } from '../src/parser.ts'

/** Find the first node of the given type under `node` (pre-order). */
function firstOfType(node: Node, type: string): Node | undefined {
  if (node.type === type) return node
  for (const child of node.children) {
    const hit = firstOfType(child, type)
    if (hit !== undefined) return hit
  }
  return undefined
}

async function functionNodeOf(source: string): Promise<Node> {
  const parser = await createCodebaseParser()
  const tree = parser.parseFile(source, 'ts')
  const fn = tree === undefined ? undefined : firstOfType(tree.rootNode, 'function_declaration')
  if (fn === undefined) throw new Error(`未在源码中找到 function_declaration：${source}`)
  return fn
}

describe('computeComplexity（C helpers.c L699-769 移植）', () => {
  it('returns zeros for straight-line code', async () => {
    const fn = await functionNodeOf('function f(a: number) { return a + 1 }')
    expect(computeComplexity(fn)).toEqual({ complexity: 0, cognitive: 0, loopCount: 0, loopDepth: 0, maxAccessDepth: 0 })
  })

  it('counts a single if as cyclomatic=1 cognitive=1', async () => {
    const fn = await functionNodeOf('function f(a: number) { if (a > 0) { return 1 } return 0 }')
    expect(computeComplexity(fn)).toEqual({ complexity: 1, cognitive: 1, loopCount: 0, loopDepth: 0, maxAccessDepth: 0 })
  })

  it('weights nested ifs with the Campbell penalty (cognitive = 1 + 2)', async () => {
    const fn = await functionNodeOf('function f(a: number) { if (a > 0) { if (a > 1) { return 2 } } return 0 }')
    const metrics = computeComplexity(fn)
    expect(metrics.complexity).toBe(2)
    expect(metrics.cognitive).toBe(3)
  })

  it('tracks two nested loops as loopCount=2 loopDepth=2', async () => {
    const fn = await functionNodeOf('function f(a: number) { for (let i = 0; i < a; i++) { for (let j = 0; j < i; j++) { a += 1 } } }')
    const metrics = computeComplexity(fn)
    expect(metrics.loopCount).toBe(2)
    expect(metrics.loopDepth).toBe(2)
  })

  it('measures chained member access depth as the count of member nodes', async () => {
    // C semantics (test_extraction.c): x.alpha.beta.gamma.delta asserts depth > 2.
    // Each member_expression node in the chain contributes one level, so
    // o.a.b.c → 3 and o.a.b.c.d → 4 (the plan draft's "=3" was a dot-count
    // misread, corrected against the C source).
    const three = await functionNodeOf('function f(o: any) { return o.a.b.c }')
    expect(computeComplexity(three).maxAccessDepth).toBe(3)
    const four = await functionNodeOf('function f(o: any) { return o.a.b.c.d }')
    expect(computeComplexity(four).maxAccessDepth).toBe(4)
  })

  it('counts named parameters (paramCount=2) and handles empty lists', async () => {
    const fn = await functionNodeOf('function f(a: number, b = 2) { return a + b }')
    const params = fn.childForFieldName('parameters')
    expect(params).toBeDefined()
    expect(countParams(params)).toBe(2)
    expect(countParams(undefined)).toBe(0)
  })
})
