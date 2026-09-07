/**
 * @flowforge/plugin-codebase — coverage honesty contract (EP-CB0, T1.5/T1.6).
 *
 * Carried over from codebase-memory-mcp: indexing reports what was NOT
 * indexed and why. Absence from these lists is NOT a completeness guarantee.
 *
 * - `excluded`: deliberately not indexed (default/caller exclusion rules) —
 *   by design, not a failure.
 * - `skipped`: intended to be indexed but failed (stat/read/oversize) —
 *   best-effort, reported with reason.
 * - `parsePartial`: indexed, but constructs in flagged ranges may be missing
 *   from the graph (populated by the tree-sitter pipeline in EP-CB1).
 *
 * @module @flowforge/plugin-codebase/coverage
 */

export interface SkippedFile {
  readonly path: string
  readonly reason: string
}

export interface CoverageReport {
  /** Exclusion rules that fired during discovery (patterns, not files). */
  readonly excluded: readonly string[]
  /** Files that failed to index, with reasons. */
  readonly skipped: readonly SkippedFile[]
  /** Partially parsed files with flagged line ranges (EP-CB1 pipeline). */
  readonly parsePartial: readonly SkippedFile[]
}

export function emptyCoverage(excluded: readonly string[] = []): CoverageReport {
  return { excluded, skipped: [], parsePartial: [] }
}
