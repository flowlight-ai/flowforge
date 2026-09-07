/**
 * @flowforge/plugin-codebase — graph snapshot comparison (EP-CB2, T3.2c).
 *
 * Ported from codebase-memory-mcp's `compare_graphs` tool: produce the
 * added/removed node and edge sets between two indexed project snapshots.
 * Deterministic output (sorted keys) for caller assertions.
 *
 * Pure read-only consumer over the store's public surface (allNodes +
 * edgesOf), consistently honoring the no-mock / no-fragile-SQL discipline.
 *
 * @module @flowforge/plugin-codebase/compare
 */

import type { CodebaseStore } from './store.ts'
import { ProjectNotFoundError } from './query.ts'

export interface CompareGraphsOptions {
  readonly projectA: string
  readonly projectB: string
}

export interface CompareNodeDelta {
  readonly id: string
  readonly label: string
  readonly name: string
}

export interface CompareEdgeDelta {
  readonly source: string
  readonly target: string
  readonly type: string
}

export interface CompareGraphsResult {
  readonly projectA: string
  readonly projectB: string
  readonly added: {
    readonly nodes: readonly CompareNodeDelta[]
    readonly edges: readonly CompareEdgeDelta[]
  }
  readonly removed: {
    readonly nodes: readonly CompareNodeDelta[]
    readonly edges: readonly CompareEdgeDelta[]
  }
  readonly identical: boolean
}

function nodeDeltas(existing: readonly { id: string; label: string; name: string }[], otherIds: ReadonlySet<string>): CompareNodeDelta[] {
  return existing
    .filter(entry => !otherIds.has(entry.id))
    .map(entry => ({ id: entry.id, label: entry.label, name: entry.name }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function edgeDeltas(existing: readonly { source: string; target: string; type: string }[], otherKeys: ReadonlySet<string>): CompareEdgeDelta[] {
  return existing
    .filter(entry => !otherKeys.has(edgeKey(entry)))
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.type.localeCompare(b.type))
}

function edgeKey(edge: { source: string; target: string; type: string }): string {
  return `${edge.source}|${edge.target}|${edge.type}`
}

/**
 * Compare two indexed project snapshots. `projectA` is the reference; `removed`
 * = things in B but not A, `added` = things in A but not B (mirroring the C
 * tool's base-vs-head semantics). `identical` is true when both node and edge
 * sets match.
 */
export function compareGraphs(store: CodebaseStore, options: CompareGraphsOptions): CompareGraphsResult {
  const { projectA, projectB } = options
  for (const project of [projectA, projectB]) {
    if (store.listProjects().find(info => info.name === project) === undefined) {
      throw new ProjectNotFoundError(project)
    }
  }

  const aNodes = store.allNodes(projectA)
  const bNodes = store.allNodes(projectB)
  const aEdges = store.edgesOf(projectA)
  const bEdges = store.edgesOf(projectB)

  const aIds = new Set(aNodes.map(node => node.id))
  const bIds = new Set(bNodes.map(node => node.id))
  const aEdgeKeys = new Set(aEdges.map(edgeKey))
  const bEdgeKeys = new Set(bEdges.map(edgeKey))

  const added = {
    nodes: nodeDeltas(aNodes, bIds),
    edges: edgeDeltas(aEdges, bEdgeKeys),
  }
  const removed = {
    nodes: nodeDeltas(bNodes, aIds),
    edges: edgeDeltas(bEdges, aEdgeKeys),
  }
  const identical = aIds.size === bIds.size
    && aEdgeKeys.size === bEdgeKeys.size
    && added.nodes.length === 0
    && added.edges.length === 0

  return { projectA, projectB, added, removed, identical }
}