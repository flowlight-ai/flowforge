/**
 * EP-CB4 T5.3 — Hybrid LSP enhancement seam (Q15).
 *
 * tree-sitter is the primary CALL/USAGE extraction chain; the LSP host
 * (packages/lsp `ctx.lsp`) is plugged in as an *optional* semantic source that
 * returns resolved extra edges. Absent a seam (default), behaviour is identical
 * to the current tree-sitter-only pipeline.
 *
 * @module @flowforge/plugin-codebase/lsp-seam
 */

import type { EdgeRecord, CodebaseStore } from './store.ts'

/** Edge types the seam may contribute (semantic CALL/USAGE/IMPLEMENTS). */
export const LSP_EDGE_TYPES = ['CALLS', 'USAGE', 'IMPLEMENTS'] as const

export interface LspEnhanceRequest {
  readonly project: string
  readonly filePath?: string
  readonly language?: string
  readonly nodeId: string
  readonly nodeName: string
}

/**
 * Optional external LSP semantics provider. `enhance` returns resolved edges
 * (source/target are in-store node IDs; type limited to LSP_EDGE_TYPES). When
 * undefined the pipeline stays pure tree-sitter.
 */
export interface LspSeam {
  readonly enhance?: (request: LspEnhanceRequest) => readonly EdgeRecord[]
}

export interface AugmentWithLspOptions {
  /** Seam carrying LSP semantics; omit/undefined to disable enhancement. */
  readonly seam?: LspSeam
}

export interface AugmentResult {
  readonly project: string
  /** All edges contributed by the seam this run (empty when no seam). */
  readonly edges: readonly EdgeRecord[]
}

const SYMBOL_LABELS_FOR_LSP = ['Function', 'Method', 'Class', 'Interface'] as const

/**
 * T5.3: walk Function/Method/Class/Interface nodes and forward each to the
 * optional seam; valid LSP edge types are inserted (idempotent via PK).
 */
export function augmentWithLsp(store: CodebaseStore, project: string, options: AugmentWithLspOptions = {}): AugmentResult {
  if (options.seam?.enhance === undefined) return { project, edges: [] }

  const nodes = store.allNodes(project).filter(node =>
    (SYMBOL_LABELS_FOR_LSP as readonly string[]).includes(node.label))

  const contributed: EdgeRecord[] = []
  for (const node of nodes) {
    const extra = options.seam.enhance({
      project,
      ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
      ...(node.language === undefined ? {} : { language: node.language }),
      nodeId: node.id,
      nodeName: node.name,
    })
    for (const edge of extra) {
      if ((LSP_EDGE_TYPES as readonly string[]).includes(edge.type)) {
        contributed.push({ project, source: edge.source, target: edge.target, type: edge.type })
      }
    }
  }
  if (contributed.length > 0) store.insertEdges(contributed)
  return { project, edges: contributed }
}