/**
 * @flowforge/plugin-codebase — raw source search (EP-CB2, T3.1b).
 *
 * Ported from codebase-memory-mcp's `search_code` tool: on-disk line-level
 * search across a project's indexed files (not the FTS index — this is a
 * literal/regex scan of the actual source). files are read from disk lazily;
 * a read cap reports `truncated` honestly instead of hanging on an enormous
 * repo.
 *
 * Pure read-only consumer over the store + fs. Deterministic order (file path
 * ascending, then line number ascending).
 *
 * @module @flowforge/plugin-codebase/search
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodebaseStore } from './store.ts'
import { ProjectNotFoundError } from './query.ts'

export interface SearchCodeOptions {
  readonly project: string
  readonly pattern: string
  readonly filePattern?: string
  readonly repoPath?: string
  readonly limit?: number
  /** Max files scanned before honest truncation (default 2000). */
  readonly maxFiles?: number
}

export interface SearchCodeMatch {
  readonly filePath: string
  readonly lineNumber: number
  readonly lineText: string
  readonly column?: number
}

export interface SearchCodeResult {
  readonly project: string
  readonly pattern: string
  readonly matches: readonly SearchCodeMatch[]
  readonly total: number
  readonly hasMore: boolean
  readonly truncated: boolean
}

/** Line length above which column calculation is skipped (honesty perf guard). */
const MAX_LINE_COLUMN = 2000

/**
 * Search raw source across a project's indexed files. `pattern` is treated as a
 * RegExp when it compiles (with `g`), otherwise as a literal substring. Files
 * are matched by `filePattern` regex when given; reads are capped by maxFiles.
 */
export function searchCode(store: CodebaseStore, options: SearchCodeOptions): SearchCodeResult {
  const project = options.project
  if (store.listProjects().find(info => info.name === project) === undefined) {
    throw new ProjectNotFoundError(project)
  }
  let regex: RegExp
  let literal: string | undefined
  try {
    regex = new RegExp(options.pattern, 'gu')
  } catch {
    literal = options.pattern
    regex = /(?:)/gu
    regex.lastIndex = 0
  }
  const fileRegex = options.filePattern === undefined ? undefined : new RegExp(options.filePattern, 'u')
  const repoPath = options.repoPath ?? '.'
  const limit = Math.max(1, options.limit ?? 100)
  const maxFiles = Math.max(1, options.maxFiles ?? 2000)

  const matches: SearchCodeMatch[] = []
  let truncated = false
  let hasMore = false
  let filesScanned = 0

  const files = store.listFileNodes(project)
    .filter(node => node.filePath !== undefined)
    .sort((a, b) => (a.filePath as string).localeCompare(b.filePath as string))

  for (const node of files) {
    if (truncated) break
    const relPath = node.filePath as string
    if (fileRegex !== undefined && !fileRegex.test(relPath)) continue
    filesScanned += 1
    if (filesScanned > maxFiles) {
      truncated = true
      break
    }
    let content: string
    try {
      content = readFileSync(join(repoPath, relPath.split('/').join('\\')), 'utf8')
    } catch {
      continue // file gone between index and read — skip, absence handled by coverage
    }
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index] as string
      if (literal !== undefined) {
        if (!lineText.includes(literal)) continue
      } else {
        regex.lastIndex = 0
        if (!regex.test(lineText)) continue
      }
      const column = lineText.length <= MAX_LINE_COLUMN ? matchColumn(lineText, literal ?? regex, options.pattern) : undefined
      matches.push({ filePath: relPath, lineNumber: index + 1, lineText, ...(column === undefined || column === -1 ? {} : { column }) })
      if (matches.length >= limit) {
        hasMore = true
        break
      }
    }
    if (matches.length >= limit) break
  }

  const total = matches.length
  const page = matches.slice(0, limit)
  return { project, pattern: options.pattern, matches: page, total, hasMore, truncated }
}

/** First match column of `needle` (literal or regex) within `lineText`. */
function matchColumn(lineText: string, needle: string | RegExp, _pattern: string): number | undefined {
  if (typeof needle === 'string') {
    const index = lineText.indexOf(needle)
    return index === -1 ? undefined : index
  }
  needle.lastIndex = 0
  const hit = needle.exec(lineText)
  if (hit === null) return undefined
  return hit.index
}