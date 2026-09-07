/**
 * @flowforge/plugin-codebase — knowledge-graph domain model (EP-CB0, T1.2).
 *
 * Ported verbatim (semantics and naming) from codebase-memory-mcp's graph
 * model: node labels, edge types and the complexity property family. The
 * seven-phase symbol extraction (EP-CB1) extends this surface; EP-CB0 only
 * populates the structural labels (Project/Folder/File/Module) but the model
 * is complete so later batches do not break the contract.
 *
 * @module @flowforge/plugin-codebase/graph-model
 */

/** Node labels carried over from the C knowledge graph. */
export const NODE_LABELS = [
  'Project',
  'Folder',
  'File',
  'Module',
  'Function',
  'Method',
  'Class',
  'Interface',
  'Route',
  'Variable',
  'Resource',
  'Channel',
] as const

export type NodeLabel = (typeof NODE_LABELS)[number]

/** Edge types carried over from the C knowledge graph. */
export const EDGE_TYPES = [
  'CALLS',
  'USAGE',
  'CALL_REFERENCE',
  'INHERITS',
  'IMPLEMENTS',
  'CONTAINS_FOLDER',
  'CONTAINS_FILE',
  'IMPORTS',
  'CROSS_HTTP_CALLS',
  'CROSS_ASYNC_CALLS',
  'CROSS_CHANNEL',
] as const

export type EdgeType = (typeof EDGE_TYPES)[number]

/**
 * Structural labels are populated by EP-CB0's structure indexer; the rest
 * (symbols) arrive with the tree-sitter pipeline in EP-CB1.
 */
export const STRUCTURAL_LABELS: readonly NodeLabel[] = ['Project', 'Folder', 'File', 'Module']

/** Labels that carry the complexity property family (EP-CB1 populates them). */
export const COMPLEXITY_LABELS: readonly NodeLabel[] = ['Function', 'Method']

/**
 * Complexity/hot-path property family, carried over from the C project's
 * Function/Method nodes. All values optional at the model level; the query
 * layer treats missing values as unknown, not zero.
 */
export interface ComplexityProps {
  /** Cyclomatic complexity. */
  readonly complexity?: number
  /** Cognitive complexity. */
  readonly cognitive?: number
  readonly loopCount?: number
  /** Maximum nested-loop depth (polynomial-degree proxy). */
  readonly loopDepth?: number
  /** Worst-case nested-loop degree propagated along CALLS edges. */
  readonly transitiveLoopDepth?: number
  readonly recursive?: boolean
  /** find/contains/indexOf-style scans inside a loop (hidden O(n^2)). */
  readonly linearScanInLoop?: number
  readonly allocInLoop?: number
  readonly recursionInLoop?: boolean
  /** Recursion with no conditionally-guarded base case. */
  readonly unguardedRecursion?: boolean
  readonly paramCount?: number
  readonly maxAccessDepth?: number
}

/** Code-level properties shared by symbol nodes. */
export interface CodeProps {
  readonly signature?: string
  readonly docstring?: string
  readonly returnType?: string
  readonly isTest?: boolean
  /** Line span of the construct (end - start + 1). */
  readonly lines?: number
}

/** A knowledge-graph node (structural or symbolic). */
export interface GraphNode {
  readonly id: string
  readonly project: string
  readonly label: NodeLabel
  /** Qualified name, e.g. `packages/plugins/codebase` (Folder) or `ff_codebase` (File). */
  readonly name: string
  /** Absolute-or-repo-relative file path when the node is file-backed. */
  readonly filePath?: string
  readonly language?: string
  readonly lines?: number
  readonly sizeBytes?: number
  readonly props?: Readonly<Record<string, string | number | boolean>>
}

/** A knowledge-graph edge. */
export interface GraphEdge {
  readonly project: string
  readonly source: string
  readonly target: string
  readonly type: EdgeType
}

/** BM25 structural ranking weights, carried over from the C search_graph tool. */
export const BM25_LABEL_BOOST: Readonly<Record<string, number>> = {
  Function: 10,
  Method: 10,
  Route: 8,
  Class: 5,
  Interface: 5,
}

/**
 * Labels filtered out of BM25 full-text results as noise (C parity):
 * File/Folder/Variable/Project are indexed but excluded from ranked queries.
 * Module is deliberately NOT excluded (C #518/#519): it is one of the labels
 * that carry prose (Markdown section bodies, config descriptions), so
 * excluding it makes the body column unreachable.
 */
export const BM25_NOISE_LABELS: readonly NodeLabel[] = ['File', 'Folder', 'Variable', 'Project']

/** Pagination contract carried over from search_graph (total/has_more/offset/limit). */
export interface Pagination<T> {
  readonly rows: readonly T[]
  /** Full match count before limit/offset. */
  readonly total: number
  readonly hasMore: boolean
  readonly offset: number
  readonly limit: number
}

export function isNodeLabel(value: string): value is NodeLabel {
  return (NODE_LABELS as readonly string[]).includes(value)
}

export function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value)
}
