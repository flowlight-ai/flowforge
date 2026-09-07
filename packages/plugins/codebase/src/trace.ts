/**
 * @flowforge/plugin-codebase — call-path tracing (EP-CB2, T3.1a).
 *
 * Ported from codebase-memory-mcp's `trace_path` tool: BFS over the graph's
 * caller/callee edges in both directions, bounded by max_depth and de-duped by
 * a visited set against cycles. The edge set mirrors the C tool's "trace edges"
 * (CALLS/USAGE/INHERITS/IMPLEMENTS — the edges a developer traces across).
 *
 * Pure read-only consumer over the store; deterministic output (ascending
 * depth, then ascending qn) so callers can assert on it.
 *
 * @module @flowforge/plugin-codebase/trace
 */

import type { CodebaseStore } from './store.ts'
import { ProjectNotFoundError, UsageError } from './query.ts'
import { SYMBOL_LABELS } from './graph-model.ts'

export type TraceDirection = 'callers' | 'callees'

export interface TraceOptions {
  readonly project: string
  readonly qualifiedName: string
  readonly direction?: TraceDirection
  readonly maxDepth?: number
}

export interface TraceResult {
  readonly project: string
  readonly start: string
  readonly direction: TraceDirection
  readonly depth: number
  readonly path: readonly TraceRow[]
}

export interface TraceRow {
  readonly qn: string
  readonly label: string
  readonly depth: number
  readonly via: string
}

/** One directed hop carrying a QN plus the edge type that produced it. */
interface Hop { qn: string; via: string }

/** Edge types traversed by trace_path (C parity). */
const TRACE_EDGE_TYPES = new Set<string>(['CALLS', 'USAGE', 'INHERITS', 'IMPLEMENTS'])

/**
 * Build adjacency for a direction. Edge source/target are stored as node IDs;
 * this maps them onto qualified names (symbol-only) so traversal keys are the
 * same namespace `findNodeByQn` resolves. For `callees` an edge source→target
 * means source calls target (hop forwards); for `callers` it is reversed.
 */
function adjacency(
  edges: readonly { source: string; target: string; type: string }[],
  idToQn: ReadonlyMap<string, string>,
  direction: TraceDirection,
): Map<string, Hop[]> {
  const map = new Map<string, Hop[]>()
  const push = (from: string, qn: string, via: string): void => {
    const bucket = map.get(from)
    const hop: Hop = { qn, via }
    if (bucket === undefined) map.set(from, [hop])
    else bucket.push(hop)
  }
  for (const edge of edges) {
    if (!TRACE_EDGE_TYPES.has(edge.type)) continue
    const fromQn = idToQn.get(edge.source)
    const toQn = idToQn.get(edge.target)
    if (fromQn === undefined || toQn === undefined) continue
    if (direction === 'callees') push(fromQn, toQn, edge.type)
    else push(toQn, fromQn, edge.type)
  }
  return map
}

/** Map node id → qualified name for every symbol node (trace adjacency keys). */
function idToQnIndex(store: CodebaseStore, project: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const node of store.allNodes(project)) {
    if (!SYMBOL_LABELS.includes(node.label)) continue
    map.set(node.id, node.name)
  }
  return map
}

/**
 * Trace caller/callee paths. BFS over the trace-edge adjacency, bounded by
 * max_depth and de-duped by a visited set (cycle-safe). Within a depth, rows
 * are sorted by qn for deterministic output; `via` lists the edge types of the
 * hops reaching that node (sorted, deduped comma-joined).
 */
export function tracePath(store: CodebaseStore, options: TraceOptions): TraceResult {
  const project = options.project
  if (store.listProjects().find(info => info.name === project) === undefined) {
    throw new ProjectNotFoundError(project)
  }
  const start = store.findNodeByQn(project, options.qualifiedName)
  if (start === undefined) {
    throw new UsageError(`无法定位符号 "${options.qualifiedName}"（trace 起点需为已索引符号 QN）`)
  }
  const direction = options.direction ?? 'callers'
  const maxDepth = Math.max(0, options.maxDepth ?? 5)
  if (maxDepth === 0) {
    return { project, start: options.qualifiedName, direction, depth: 0, path: [] }
  }

  const edges = store.edgesOf(project)
  const next = adjacency(edges, idToQnIndex(store, project), direction)
  const path: TraceRow[] = []
  const seen = new Set<string>([start.name])

  interface FrontierItem { qn: string; depth: number; byVia: string[] }
  let frontier: FrontierItem[] = []
  const startHops = next.get(start.name) ?? []
  const viaForStart = new Map<string, string[]>()
  for (const hop of startHops) {
    const via = viaForStart.get(hop.qn)
    if (via === undefined) viaForStart.set(hop.qn, [hop.via])
    else if (!via.includes(hop.via)) via.push(hop.via)
  }
  for (const [qn, byVia] of viaForStart) {
    frontier.push({ qn, depth: 1, byVia })
  }

  while (frontier.length > 0) {
    const level = frontier[0]!.depth
    // Merge hops that reach the same qn at this level, sort deterministically.
    const merged = new Map<string, string[]>()
    for (const item of frontier) {
      const vias = merged.get(item.qn)
      if (vias === undefined) merged.set(item.qn, [...item.byVia])
      else for (const via of item.byVia) if (!vias.includes(via)) vias.push(via)
    }
    const ordered = Array.from(merged.keys()).sort()
    const nextFrontier: FrontierItem[] = []
    for (const qn of ordered) {
      if (seen.has(qn)) continue
      const byVia = (merged.get(qn) as string[]).sort()
      const node = store.findNodeByQn(project, qn)
      path.push({ qn, label: node?.label ?? '', depth: level, via: byVia.join(',') })
      seen.add(qn)
      for (const hop of next.get(qn) ?? []) {
        if (!seen.has(hop.qn)) nextFrontier.push({ qn: hop.qn, depth: level + 1, byVia: [hop.via] })
      }
    }
    if (level >= maxDepth) break
    frontier = nextFrontier
  }

  return { project, start: options.qualifiedName, direction, depth: maxPathDepth(path), path }
}

function maxPathDepth(path: readonly TraceRow[]): number {
  let max = 0
  for (const row of path) max = Math.max(max, row.depth)
  return max
}