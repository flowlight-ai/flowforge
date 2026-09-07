/**
 * @flowforge/plugin-codebase — Cypher query entry point (EP-CB3, T4.1d).
 *
 * Orchestrates the lexer → parser → executor pipeline and classifies errors
 * against the ff_codebase exit-code contract: UsageError (syntax/unsupported)
 * → 2, unknown project → 1 (ProjectNotFoundError), success → 0.
 *
 * @module @flowforge/plugin-codebase/cypher
 */

import type { CodebaseStore } from './store.ts'
import { tokenizeCypher } from './cypher-lexer.ts'
import { parseCypher } from './cypher-parser.ts'
import { executeCypher } from './cypher-executor.ts'
import type { CypherResult } from './cypher-executor.ts'
import { requireProject } from './query.ts'

export interface CypherQueryOptions {
  readonly project: string
  readonly query: string
  readonly maxRows?: number
  readonly budget?: number
}

/** Parse + execute a Cypher query end-to-end on one project. */
export function queryCypher(store: CodebaseStore, options: CypherQueryOptions): CypherResult {
  requireProject(store, options.project)
  const tokens = tokenizeCypher(options.query)
  const parsed = parseCypher(tokens)
  return executeCypher(store, {
    project: options.project,
    query: parsed,
    ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  })
}

export { tokenizeCypher } from './cypher-lexer.ts'
export type { CypherToken, CypherTokenType } from './cypher-lexer.ts'
export { parseCypher, MAX_HOPS, ORDER_KEYS_MAX } from './cypher-parser.ts'
export type {
  CypherQuery, CypherPattern, NodePattern, RelPattern, Condition, WhereExpr,
  ReturnItem, OrderKey, PropFilter,
} from './cypher-parser.ts'
export { executeCypher, buildAdjacency, MAX_RESULT_ROWS, DEFAULT_EXEC_BUDGET } from './cypher-executor.ts'
export type { CypherResult, ExecOptions } from './cypher-executor.ts'