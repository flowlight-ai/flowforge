/**
 * @flowforge/plugin-codebase — structured query surface (EP-CB0, T1.6).
 *
 * Thin validated layer over CodebaseStore.search: compiles regex filters
 * eagerly (usage errors surface as exit 2), verifies the project exists
 * (exit 1 semantics for the caller), and exposes the schema/status views
 * used by the CLI and the tool registry.
 *
 * @module @flowforge/plugin-codebase/query
 */

import type { NodeLabel, Pagination } from './graph-model.ts'
import { SYMBOL_LABELS } from './graph-model.ts'
import type { CodebaseStore, SearchOptions, StoreQueryResult, ProjectInfo, SchemaOverview } from './store.ts'
import { discoverFiles } from './discover.ts'

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export class ProjectNotFoundError extends Error {
  constructor(project: string) {
    super(`项目不存在：${project}（先执行 ff_codebase index）`)
    this.name = 'ProjectNotFoundError'
  }
}

export interface QueryInput {
  readonly project: string
  readonly query?: string
  readonly label?: string
  readonly namePattern?: string
  readonly filePattern?: string
  readonly minDegree?: number
  readonly maxDegree?: number
  readonly limit?: number
  readonly offset?: number
}

function assertRegex(kind: string, pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'u')
  } catch (error) {
    throw new UsageError(`无效 ${kind} 正则 "${pattern}"：${(error as Error).message}`)
  }
}

/** Shared guard: exit-1 semantics for unknown projects (outline reuses it). */
export function requireProject(store: CodebaseStore, project: string): void {
  const known = store.listProjects().find(info => info.name === project)
  if (known === undefined) throw new ProjectNotFoundError(project)
}

/** Structured + BM25 search over one project's nodes (pagination contract). */
export function searchNodes(store: CodebaseStore, input: QueryInput): StoreQueryResult {
  requireProject(store, input.project)
  if (input.namePattern !== undefined) assertRegex('--name-pattern', input.namePattern)
  if (input.filePattern !== undefined) assertRegex('--file-pattern', input.filePattern)
  const options: SearchOptions = {
    project: input.project,
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.label === undefined ? {} : { label: input.label as NodeLabel }),
    ...(input.namePattern === undefined ? {} : { namePattern: input.namePattern }),
    ...(input.filePattern === undefined ? {} : { filePattern: input.filePattern }),
    ...(input.minDegree === undefined ? {} : { minDegree: input.minDegree }),
    ...(input.maxDegree === undefined ? {} : { maxDegree: input.maxDegree }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  }
  return store.search(options)
}

/** Label/edge schema overview for one project (get_graph_schema parity). */
export function schemaFor(store: CodebaseStore, project?: string): SchemaOverview {
  if (project !== undefined) requireProject(store, project)
  return store.schemaOverview(project)
}

/** Index status: project row + live counts (index_status parity). */
export interface IndexStatus {
  readonly project: ProjectInfo
  readonly nodeCount: number
  readonly edgeCount: number
  /** Symbol-layer node count (EP-CB1): nodes under the symbol labels. */
  readonly symbolCount: number
}

export function indexStatus(store: CodebaseStore, project?: string): IndexStatus[] {
  const targets = project === undefined
    ? store.listProjects()
    : (requireProject(store, project), store.listProjects().filter(info => info.name === project))
  return targets.map(info => {
    const labels = store.labelCounts(info.name)
    const nodeCount = labels.reduce((sum, entry) => sum + entry.count, 0)
    const edgeCount = store.edgeTypeCounts(info.name).reduce((sum, entry) => sum + entry.count, 0)
    const symbolCount = labels
      .filter(entry => SYMBOL_LABELS.includes(entry.label as NodeLabel))
      .reduce((sum, entry) => sum + entry.count, 0)
    return { project: info, nodeCount, edgeCount, symbolCount }
  })
}

/** Page through every result of a search (helper for CLI dump modes). */
export function* iteratePages(store: CodebaseStore, input: QueryInput, pageSize = 100): Generator<readonly StoreQueryResult['rows'][number][]> {
  let offset = 0
  for (;;) {
    const page: StoreQueryResult = searchNodes(store, { ...input, limit: pageSize, offset })
    if (page.rows.length === 0) return
    yield page.rows
    offset += page.rows.length
    if (!page.hasMore) return
  }
}

/**
 * Targeted index-coverage check (EP-CB2, T3.2a): "absence ≠ complete" honor
 * contract. Lists which disk files are NOT present in the graph (optionally
 * filtered), so a caller can tell "fully indexed" from "best-effort". The
 * indexer's transient coverage signals (skipped/parse_partial) are not
 * persisted; this surface re-derives the durable facts: indexed vs on-disk.
 */
export function checkIndexCoverage(store: CodebaseStore, project: string, repoPath: string, filePattern?: string): IndexCoverageResult {
  requireProject(store, project)
  const regex = filePattern === undefined ? undefined : new RegExp(filePattern, 'u')
  const indexed = new Set(
    store.listFileNodes(project)
      .map(node => node.filePath)
      .filter((path): path is string => path !== undefined),
  )
  const disk = discoverFiles(repoPath.replace(/\\/g, '/'))
  const absent: string[] = []
  for (const file of disk.files) {
    if (regex !== undefined && !regex.test(file.relativePath)) continue
    if (!indexed.has(file.relativePath)) absent.push(file.relativePath)
  }
  absent.sort()
  const status = indexStatus(store, project) as readonly IndexStatus[]
  return {
    project,
    nodeCount: status[0]?.nodeCount ?? 0,
    edgeCount: status[0]?.edgeCount ?? 0,
    symbolCount: status[0]?.symbolCount ?? 0,
    excluded: disk.excluded,
    absentFiles: absent,
    absentCount: absent.length,
  }
}

export interface IndexCoverageResult {
  readonly project: string
  readonly nodeCount: number
  readonly edgeCount: number
  readonly symbolCount: number
  readonly excluded: readonly string[]
  readonly absentFiles: readonly string[]
  readonly absentCount: number
}

export type { Pagination }
