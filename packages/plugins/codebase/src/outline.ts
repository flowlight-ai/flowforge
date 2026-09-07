/**
 * @flowforge/plugin-codebase — file outline + code snippet (EP-CB1, T2.4).
 *
 * Port of the mcp.c get_file_outline / get_code_snippet contract:
 * - outline: line-ordered symbol rows of one file with the pagination
 *   contract (total/returned/hasMore);
 * - snippet: three-tier qualified-name resolution (exact → unique suffix →
 *   ambiguous suggestions) and ±5 context-line expansion, slicing the real
 *   on-disk source so callers always see ground truth.
 *
 * @module @flowforge/plugin-codebase/outline
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { SYMBOL_LABELS, isNodeLabel } from './graph-model.ts'
import type { GraphNode } from './graph-model.ts'
import type { CodebaseStore } from './store.ts'
import { UsageError, requireProject } from './query.ts'

/** Neighbor context lines added on each side with includeNeighbors. */
const NEIGHBOR_CONTEXT_LINES = 5

export class SymbolNotFoundError extends Error {
  constructor(qualifiedName: string) {
    super(`未找到符号 ${qualifiedName}（先索引，或改用唯一后缀名重试）`)
    this.name = 'SymbolNotFoundError'
  }
}

export interface OutlineOptions {
  /** Restrict the outline to these symbol labels (defaults to all). */
  readonly labels?: readonly string[]
  readonly limit?: number
  readonly offset?: number
}

export interface OutlineRow {
  /** Fully qualified name (the node `name`). */
  readonly qn: string
  /** Short name (props.shortName, QN tail segment as fallback). */
  readonly name: string
  readonly label: string
  /** Line span "start-end" (line count when the span is unavailable). */
  readonly lines: string
  readonly filePath?: string
  readonly language?: string
}

export interface OutlineResult {
  readonly file: string
  readonly rows: readonly OutlineRow[]
  readonly total: number
  readonly returned: number
  readonly hasMore: boolean
}

export interface SnippetOptions {
  /** Repository root the symbol file_path resolves against. */
  readonly repoPath: string
  readonly includeNeighbors?: boolean
}

export interface SnippetSuggestion {
  readonly qn: string
  readonly label: string
  readonly filePath?: string
}

export type SnippetResult =
  | {
    readonly kind: 'snippet'
    readonly qualifiedName: string
    readonly label: string
    readonly filePath?: string
    readonly startLine: number
    readonly endLine: number
    readonly source: string
    /** Set only when the QN resolved via a unique suffix (exact stays unset, C parity). */
    readonly matchMethod?: 'suffix'
  }
  | {
    readonly kind: 'ambiguous'
    readonly qualifiedName: string
    readonly suggestions: readonly SnippetSuggestion[]
  }

function shortNameOf(node: GraphNode): string {
  const short = node.props?.shortName
  if (typeof short === 'string' && short.length > 0) return short
  const tail = node.name.split('.').pop()
  return tail === undefined ? node.name : tail
}

function spanOf(node: GraphNode): string {
  const start = node.props?.startLine
  const end = node.props?.endLine
  if (typeof start === 'number' && typeof end === 'number') return `${start}-${end}`
  return node.lines === undefined ? '' : String(node.lines)
}

function numberOrThrow(value: number, kind: string): number {
  if (!Number.isInteger(value)) throw new UsageError(`${kind} 需要整数，收到 "${value}"`)
  return value
}

/**
 * Symbol outline of one file: line-ordered rows with the pagination
 * contract. Validated surface: unknown labels / out-of-range limit-offset
 * exit 2 (UsageError), unknown projects exit 1 (ProjectNotFoundError).
 */
export function fileOutline(store: CodebaseStore, project: string, filePath: string, options: OutlineOptions = {}): OutlineResult {
  requireProject(store, project)
  if (filePath.length === 0) throw new UsageError('file_path 不能为空')
  const limit = options.limit === undefined ? 100 : numberOrThrow(options.limit, '--limit')
  if (limit < 1 || limit > 200) throw new UsageError(`--limit 需在 1-200 区间，收到 "${limit}"`)
  const offset = options.offset === undefined ? 0 : numberOrThrow(options.offset, '--offset')
  if (offset < 0) throw new UsageError(`--offset 需 >= 0，收到 "${offset}"`)
  const labels = options.labels === undefined ? [...SYMBOL_LABELS] : [...options.labels]
  for (const label of labels) {
    if (!isNodeLabel(label)) throw new UsageError(`未知符号标签 "${label}"（可选：${SYMBOL_LABELS.join(', ')}）`)
  }
  const page = store.fileOutline(project, filePath, { labels, limit, offset })
  const rows: OutlineRow[] = page.rows.map(node => ({
    qn: node.name,
    name: shortNameOf(node),
    label: node.label,
    lines: spanOf(node),
    ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
    ...(node.language === undefined ? {} : { language: node.language }),
  }))
  return {
    file: filePath,
    rows,
    total: page.total,
    returned: rows.length,
    hasMore: page.hasMore,
  }
}

/**
 * Code snippet by qualified name — three-tier resolution: exact QN, unique
 * segment-boundary suffix, then the disambiguation list. Throws
 * SymbolNotFoundError when nothing matches; reads the real source from
 * `repoPath` so the sliced text is ground truth, not an index copy.
 */
export function codeSnippet(store: CodebaseStore, project: string, qualifiedName: string, options: SnippetOptions): SnippetResult {
  requireProject(store, project)
  if (qualifiedName.length === 0) throw new UsageError('qualified_name 不能为空')
  const candidates = store.findNodesByQnSuffix(project, qualifiedName)
  if (candidates.length === 0) throw new SymbolNotFoundError(qualifiedName)

  const exact = candidates.find(node => node.name === qualifiedName)
  const node = exact ?? (candidates.length === 1 ? candidates[0] : undefined)
  if (node === undefined) {
    return {
      kind: 'ambiguous',
      qualifiedName,
      suggestions: candidates.map(candidate => ({
        qn: candidate.name,
        label: candidate.label,
        ...(candidate.filePath === undefined ? {} : { filePath: candidate.filePath }),
      })),
    }
  }

  const filePath = node.filePath
  if (filePath === undefined) throw new UsageError(`符号 ${node.name} 缺少 file_path，无法读取源码（重建索引可修复）`)
  const absolute = isAbsolute(filePath) ? filePath : resolve(options.repoPath, filePath)
  let fileLines: string[]
  try {
    fileLines = readFileSync(absolute, 'utf8').split(/\r?\n/)
  } catch (error) {
    throw new UsageError(`无法读取源文件 ${filePath}：${(error as Error).message}`)
  }

  let startLine = typeof node.props?.startLine === 'number' ? node.props.startLine : 1
  let endLine = typeof node.props?.endLine === 'number' ? node.props.endLine : (node.lines ?? 1)
  if (options.includeNeighbors === true) {
    startLine = Math.max(1, startLine - NEIGHBOR_CONTEXT_LINES)
    endLine = Math.min(Math.max(endLine + NEIGHBOR_CONTEXT_LINES, endLine), Math.max(fileLines.length, 1))
  }
  endLine = Math.min(endLine, Math.max(fileLines.length, 1))
  startLine = Math.max(1, Math.min(startLine, endLine))

  return {
    kind: 'snippet',
    qualifiedName: node.name,
    label: node.label,
    filePath,
    startLine,
    endLine,
    source: fileLines.slice(startLine - 1, endLine).join('\n'),
    ...(exact === undefined ? { matchMethod: 'suffix' as const } : {}),
  }
}
