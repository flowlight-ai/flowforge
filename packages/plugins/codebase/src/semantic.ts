/**
 * EP-CB4 T5.1/T5.2 — semantic layer: SIMILAR similarity edges and the
 * min-cosine vector-retrieval contract (`semantic_query`).
 *
 * Carried over from the C search_graph semantics:
 * - `simhash` reduces symbol prose (name + signature + docstring) to a 64-bit
 *   fingerprint; Hamming distance below the threshold flags semantic duplicates.
 * - `semanticQuery` scores each node as the **minimum cosine** across a keyword
 *   array (AND semantics), ranked descending, paginated with the
 *   total/hasMore contract — mirroring the C `semantic_query` tool.
 *
 * Determinism: all hashing (FNV-1a) and sorting are pure; no Mock of the store
 * or filesystem (ironclad rule T1).
 *
 * @module @flowforge/plugin-codebase/semantic
 */

import type { EdgeRecord, NodeRecord, StoreQueryResult } from './store.ts'
import type { CodebaseStore } from './store.ts'
import type { GraphNode } from './graph-model.ts'

/** Edge/symbol labels that participate in SIMILAR duplicate detection (C parity). */
export const SIMILAR_LABELS = ['Function', 'Method', 'Class', 'Interface'] as const

export interface SemanticSimilarityOptions {
  readonly threshold?: number
}

export interface SemanticSimilarityResult {
  readonly project: string
  /** SIMILAR edges from the canonical node to each in-cluster duplicate. */
  readonly edges: readonly EdgeRecord[]
  /** Non-canonical duplicates to upsert with `props.similarTo` backfilled. */
  readonly canonicalUpdates: readonly NodeRecord[]
}

export interface SemanticQueryOptions {
  /** AND keywords; each node is scored by the minimum cosine across them. */
  readonly keywords: readonly string[]
  readonly limit?: number
  readonly offset?: number
}

/** FNV-1a 32-bit hash (two seeds → 64-bit fingerprint halves). */
function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

const SEED_A = 0x811c9dc5
const SEED_B = 0x01000193

/** Reduce prose to a 64-bit fingerprint: per-bit vote over token hashes. */
export function simhash(text: string): bigint {
  const tokens = text.toLowerCase().split(' ').filter(token => token.length > 0)
  const votes = new Array<number>(64).fill(0)
  for (const token of tokens) {
    // 64-bit: high word from seed A, low word from seed B.
    const h = fnv1a32(token, SEED_A)
    const low = fnv1a32(token, SEED_B)
    for (let bit = 0; bit < 32; bit += 1) {
      if (((h >>> bit) & 1) === 1) votes[bit] = (votes[bit] ?? 0) + 1
      else votes[bit] = (votes[bit] ?? 0) - 1
      if (((low >>> bit) & 1) === 1) votes[bit + 32] = (votes[bit + 32] ?? 0) + 1
      else votes[bit + 32] = (votes[bit + 32] ?? 0) - 1
    }
  }
  let signature = 0n
  for (let bit = 0; bit < 64; bit += 1) {
    if ((votes[bit] ?? 0) > 0) signature |= 1n << BigInt(bit)
  }
  return signature
}

/** Number of differing bits between two 64-bit fingerprints. */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b
  let count = 0
  while (xor !== 0n) {
    xor &= xor - 1n
    count += 1
  }
  return count
}

/** Term-frequency vector for a node's prose (name + signature + docstring). */
export function termFrequency(name: string, signature: string | undefined, docstring: string | undefined): Map<string, number> {
  const vector = new Map<string, number>()
  const bump = (term: string): void => {
    const key = term.toLowerCase()
    vector.set(key, (vector.get(key) ?? 0) + 1)
  }
  const add = (chunk: string): void => {
    for (const token of chunk
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[\s_.:/\\\-]+/)
      .filter(part => part.length > 0)) {
      bump(token.toLowerCase())
    }
  }
  add(name)
  if (signature !== undefined) add(signature)
  if (docstring !== undefined) add(docstring)
  return vector
}

/** Cosine similarity between two term-frequency vectors (zero-safe). */
export function cosineSimilarity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [term, weight] of a) {
    const other = b.get(term)
    if (other !== undefined) dot += weight * other
    normA += weight * weight
  }
  for (const [, weight] of b) normB += weight * weight
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Simplified simple-name of a symbol node (last segment) for clustering. */
function simpleName(node: GraphNode): string {
  return (node.props?.shortName as string | undefined) ?? node.name.split('.').pop() ?? node.name
}

/** Prose hashed for SIMILAR detection (simple name + signature + docstring; the
 * fully-qualified name is excluded so near-identical duplicates whose paths
 * differ still collapse to the same fingerprint). */
function symbolProse(node: GraphNode): string {
  return [simpleName(node), node.props?.signature, node.props?.docstring].filter(v => typeof v === 'string' && v.length > 0).join(' ')
}

/**
 * T5.1: same-cluster Function/Method/Class/Interface duplicate detection.
 * Nodes grouped by simple name; the longest (line-span) node is canonical, the
 * rest link via SIMILAR edges when their Hamming distance is within threshold.
 */
export function semanticSimilarityEdges(store: CodebaseStore, project: string, options: SemanticSimilarityOptions = {}): SemanticSimilarityResult {
  const threshold = options.threshold ?? 3
  const nodes = store.allNodes(project).filter(node => (SIMILAR_LABELS as readonly string[]).includes(node.label))

  // Cluster by simple name.
  const clusters = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const key = simpleName(node)
    const bucket = clusters.get(key)
    if (bucket === undefined) clusters.set(key, [node])
    else bucket.push(node)
  }

  const edges: EdgeRecord[] = []
  const canonicalUpdates: NodeRecord[] = []
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue
    const signatures = new Map<string, bigint>()
    for (const node of cluster) signatures.set(node.id, simhash(symbolProse(node)))
    // Canonical: longest line span wins; ties break by name ascending.
    const canonical = [...cluster].sort((a, b) =>
      (Number(b.lines ?? b.props?.lines ?? 0) - Number(a.lines ?? a.props?.lines ?? 0)) || a.name.localeCompare(b.name))[0] as GraphNode
    const canonicalSig = signatures.get(canonical.id) as bigint
    for (const node of cluster) {
      if (node.id === canonical.id) continue
      const sig = signatures.get(node.id) as bigint
      if (hammingDistance(sig, canonicalSig) > threshold) continue
      edges.push({ project, source: canonical.id, target: node.id, type: 'SIMILAR' })
      canonicalUpdates.push({
        id: node.id,
        project,
        label: node.label,
        name: node.name,
        ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
        ...(node.language === undefined ? {} : { language: node.language }),
        ...(node.lines === undefined ? {} : { lines: node.lines }),
        ...(node.sizeBytes === undefined ? {} : { sizeBytes: node.sizeBytes }),
        props: { ...(node.props ?? {}), similarTo: canonical.id },
      })
    }
  }
  return { project, edges, canonicalUpdates }
}

/**
 * T5.2: vector retrieval with the per-keyword min-cosine contract. Each node is
 * scored by the minimum cosine over its keyword vectors; only symbol nodes are
 * retrievable (BM25 noise labels excluded), preserving the total/hasMore page.
 */
export function semanticQuery(store: CodebaseStore, project: string, options: SemanticQueryOptions): StoreQueryResult {
  const kws = options.keywords.filter(kw => kw.trim().length > 0)
  if (kws.length === 0) return { rows: [], total: 0, hasMore: false }
  const kwVectors = kws.map(kw => termFrequency(kw, undefined, undefined))

  const nodes = store.allNodes(project).filter(node =>
    // BM25 noise labels are excluded from retrieval (C parity).
    node.label !== 'File' && node.label !== 'Folder' && node.label !== 'Variable' && node.label !== 'Project')

  const scored: { node: GraphNode; score: number }[] = []
  for (const node of nodes) {
    const nodeVec = termFrequency(node.name, node.props?.signature as string | undefined, node.props?.docstring as string | undefined)
    let min = 1
    for (const kwVec of kwVectors) {
      const cosine = cosineSimilarity(kwVec, nodeVec)
      if (cosine < min) min = cosine
    }
    if (min > 0) scored.push({ node, score: min })
  }
  scored.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))

  const limit = Math.max(1, options.limit ?? 50)
  const offset = Math.max(0, options.offset ?? 0)
  const page = scored.slice(offset, offset + limit).map(entry => entry.node)
  return { rows: page, total: scored.length, hasMore: offset + page.length < scored.length }
}