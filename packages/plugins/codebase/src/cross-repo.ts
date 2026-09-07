/**
 * EP-CB4 T5.4 — cross-repository intelligence.
 *
 * Graded CROSS_* edges across sibling project stores. Each symbol node may
 * carry cross-service target lists in its props; this pass opens the sibling
 * store read-only, resolves each target QN, and records a CROSS_* edge in the
 * LOCAL project's edge table using a namespaced sibling target id
 * (`<sibling>::<qn>`), reflecting the CROSS_HTTP_CALLS / CROSS_ASYNC_CALLS /
 * CROSS_CHANNEL edge family.
 *
 * Stores are plain library surfaces; sibling DBs are opened read-only via the
 * real node:sqlite driver in temp/fixture directories (no Mock, ironclad T1).
 *
 * @module @flowforge/plugin-codebase/cross-repo
 */

import type { EdgeRecord, CodebaseStore } from './store.ts'
import { CodebaseStore as RealStore } from './store.ts'
import type { EdgeType } from './graph-model.ts'

/** A sibling project reachable for cross-edge resolution. */
export interface SiblingProject {
  readonly name: string
  readonly dbPath: string
}

export interface CrossRepoOptions {
  readonly siblings: readonly SiblingProject[]
}

export interface CrossRepoResult {
  readonly project: string
  /** CROSS_* edges recorded in the local project (targets are sibling-namespaced). */
  readonly contributions: readonly EdgeRecord[]
}

/** Driver → edge-type mapping carried over from the C cross-intelligence model. */
const DRIVER_EDGE_TYPE: Record<string, EdgeType> = {
  crossHttpTargets: 'CROSS_HTTP_CALLS',
  crossAsyncTargets: 'CROSS_ASYNC_CALLS',
  crossChannelTargets: 'CROSS_CHANNEL',
}

/**
 * T5.4: resolve each node's cross-service targets against sibling stores and
 * emit local CROSS_* edges. Idempotent against insertEdges (PK dedup).
 */
export function detectCrossProjectEdges(store: CodebaseStore, project: string, options: CrossRepoOptions): CrossRepoResult {
  const contributions: EdgeRecord[] = []
  const localNodes = store.allNodes(project)

  for (const node of localNodes) {
    for (const [driver, type] of Object.entries(DRIVER_EDGE_TYPE)) {
      const raw = node.props?.[driver]
      if (raw === undefined) continue
      const targets = String(raw).split(',').map(t => t.trim()).filter(t => t.length > 0)
      for (const target of targets) {
        const sep = target.indexOf('::')
        if (sep <= 0) continue
        const siblingName = target.slice(0, sep)
        const qn = target.slice(sep + 2)
        const sibling = options.siblings.find(s => s.name === siblingName)
        if (sibling === undefined) continue
        const siblingStore = new RealStore(sibling.dbPath)
        siblingStore.open()
        try {
          const resolved = siblingStore.findNodeByQn(sibling.name, qn)
          if (resolved !== undefined) {
            contributions.push({
              project,
              source: node.id,
              target: `${sibling.name}::${qn}`,
              type,
            })
          }
        } finally {
          siblingStore.dispose()
        }
      }
    }
  }

  if (contributions.length > 0) store.insertEdges(contributions)
  return { project, contributions }
}