/**
 * @flowforge/plugin-codebase — complexity calculator (EP-CB1, T2.2a).
 *
 * Single-walk port of cbm_compute_complexity (codebase-memory-mcp helpers.c
 * L699-769): an explicit stack (no recursion) whose frames carry the branch-,
 * loop- and access-nesting depth, producing every metric in one traversal:
 *
 * - cyclomatic: count of branching nodes (js_branch_types, shared by TS/JS)
 * - cognitive: Campbell weighting — each branch contributes 1 + its own
 *   branch-nesting depth
 * - loopCount / loopDepth: named loop-node count / maximum nesting depth
 * - maxAccessDepth: chained member/subscript access depth (a.b.c.d → 3)
 *
 * @module @flowforge/plugin-codebase/complexity
 */

import type { Node } from 'web-tree-sitter'

/** Branching node types for TS/JS (lang_specs.c js_branch_types, verbatim). */
export const BRANCHING_NODE_TYPES: readonly string[] = [
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'switch_statement',
  'switch_case',
  'switch_default',
  'try_statement',
  'catch_clause',
  'do_statement',
]

/** Loop node types relevant to the TS/JS grammars (helpers.c loop list). */
const LOOP_NODE_TYPES: ReadonlySet<string> = new Set([
  'for_statement',
  'while_statement',
  'do_statement',
  'for_in_statement',
  'for_of_statement',
])

/** Chained member/subscript access nodes (helpers.c is_member_access_node). */
const MEMBER_ACCESS_TYPES: ReadonlySet<string> = new Set([
  'member_expression',
  'field_expression',
  'selector_expression',
  'field_access',
  'member_access_expression',
  'navigation_expression',
  'attribute',
  'subscript_expression',
  'subscript',
  'index_expression',
  'element_access_expression',
  'scoped_identifier',
])

export interface ComplexityMetrics {
  /** Cyclomatic complexity (branching-node count). */
  readonly complexity: number
  /** Cognitive complexity (Campbell: 1 + nesting penalty per branch). */
  readonly cognitive: number
  readonly loopCount: number
  readonly loopDepth: number
  readonly maxAccessDepth: number
}

interface CxFrame {
  readonly node: Node
  readonly bdepth: number
  readonly ldepth: number
  readonly adepth: number
}

/** Compute the complexity metrics of a function-shaped subtree in one walk. */
export function computeComplexity(node: Node): ComplexityMetrics {
  let complexity = 0
  let cognitive = 0
  let loopCount = 0
  let loopDepth = 0
  let maxAccessDepth = 0

  const stack: CxFrame[] = [{ node, bdepth: 0, ldepth: 0, adepth: 0 }]
  while (stack.length > 0) {
    const frame = stack.pop() as CxFrame
    const kind = frame.node.type
    const isBranch = BRANCHING_NODE_TYPES.includes(kind)

    let childB = frame.bdepth
    let childL = frame.ldepth
    // Chained member/subscript access nests as access(access(access(a))):
    // each consecutive access node deepens the chain; non-access nodes reset.
    let childA = 0
    if (frame.node.isNamed && MEMBER_ACCESS_TYPES.has(kind)) {
      childA = frame.adepth + 1
      if (childA > maxAccessDepth) maxAccessDepth = childA
    }
    if (isBranch) {
      complexity += 1
      cognitive += 1 + frame.bdepth
      childB = frame.bdepth + 1
    }
    // Only named nodes count as loops: the loop's `for`/`while` keyword is an
    // anonymous child token whose type equals the loop name — without the
    // named guard each loop counts twice and the nesting depth inflates.
    if (frame.node.isNamed && LOOP_NODE_TYPES.has(kind)) {
      loopCount += 1
      const depth = frame.ldepth + 1
      if (depth > loopDepth) loopDepth = depth
      childL = depth
    }
    const children = frame.node.children
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child != null) stack.push({ node: child, bdepth: childB, ldepth: childL, adepth: childA })
    }
  }
  return { complexity, cognitive, loopCount, loopDepth, maxAccessDepth }
}

/** Count the named parameter nodes of a formal-parameters node. */
export function countParams(paramsNode: Node | undefined): number {
  if (paramsNode === undefined) return 0
  return paramsNode.namedChildCount
}
