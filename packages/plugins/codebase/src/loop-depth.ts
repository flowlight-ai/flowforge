/**
 * EP-CB4 T5.5 — interprocedural `transitive_loop_depth` propagation.
 *
 * Worst-case nested-loop depth spreads along CALLS edges: a caller's
 * `transitiveLoopDepth` is the max of its own `loopDepth` and every callee's
 * transitive depth. Propagation runs to a monotone fixpoint (bounded by node
 * count), so call cycles converge to the reachable maximum without unbounded
 * recursion — the C project's conservative semantics.
 *
 * @module @flowforge/plugin-codebase/loop-depth
 */

import type { NodeRecord, CodebaseStore } from './store.ts'
import type { GraphNode } from './graph-model.ts'

export interface LoopDepthResult {
  readonly project: string
  /** Callers whose transitive depth was (re)computed, to be upserted. */
  readonly propagated: readonly NodeRecord[]
}

function nodeToUpsert(node: GraphNode, transitive: number): NodeRecord {
  return {
    id: node.id,
    project: node.project,
    label: node.label,
    name: node.name,
    ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
    ...(node.language === undefined ? {} : { language: node.language }),
    ...(node.lines === undefined ? {} : { lines: node.lines }),
    ...(node.sizeBytes === undefined ? {} : { sizeBytes: node.sizeBytes }),
    props: { ...(node.props ?? {}), transitiveLoopDepth: transitive },
  }
}

/**
 * T5.5: propagate the worst-case nested-loop depth along CALLS edges to a
 * fixpoint and return the Function/Method nodes to upsert with
 * `transitiveLoopDepth`.
 */
export function propagateLoopDepth(store: CodebaseStore, project: string): LoopDepthResult {
  const calls = store.edgesByType(project, ['CALLS'])
  const callees = new Map<string, string[]>()
  for (const edge of calls) {
    const bucket = callees.get(edge.source)
    if (bucket === undefined) callees.set(edge.source, [edge.target])
    else bucket.push(edge.target)
  }

  const nodes = store.allNodes(project).filter(node =>
    (node.label === 'Function' || node.label === 'Method') && node.props?.loopDepth !== undefined)

  const transitive = new Map<string, number>()
  for (const node of nodes) transitive.set(node.id, Math.max(Number(node.props?.loopDepth ?? 0), Number(node.props?.transitiveLoopDepth ?? 0)))

  // Monotone fixpoint: max never decreases, bounded by |nodes| iterations.
  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let changed = false
    for (const node of nodes) {
      const targets = callees.get(node.id) ?? []
      let best = transitive.get(node.id) ?? 0
      for (const callee of targets) {
        const calleeDepth = transitive.get(callee)
        if (calleeDepth !== undefined && calleeDepth > best) best = calleeDepth
      }
      if (best > (transitive.get(node.id) ?? 0)) {
        transitive.set(node.id, best)
        changed = true
      }
    }
    if (!changed) break
  }

  const propagated: NodeRecord[] = []
  for (const node of nodes) {
    const computed = transitive.get(node.id) as number
    const stored = Number(node.props?.transitiveLoopDepth ?? 0)
    if (computed !== stored) propagated.push(nodeToUpsert(node, computed))
  }
  if (propagated.length > 0) store.upsertNodes(propagated)
  return { project, propagated }
}