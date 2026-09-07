/**
 * @flowforge/plugin-codebase — architecture decision record management
 * (EP-CB2, T3.3).
 *
 * Ported from codebase-memory-mcp's `manage_adr` tool: list, read and create
 * Markdown ADRs in a `docs/decisions/` directory (ADR 1.0 convention). New
 * records get the next sequential number and a standard front-matter template.
 *
 * Pure library surface (fs read/write). Operations map onto exit-code 0/1/2
 * semantics at the CLI layer.
 *
 * @module @flowforge/plugin-codebase/adr
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type AdrAction = 'list' | 'get' | 'create'

export interface AdrEntry {
  readonly id: number
  readonly title: string
  readonly fileName: string
  readonly filePath: string
}

export interface AdrListResult {
  readonly directory: string
  readonly adrs: readonly AdrEntry[]
  readonly total: number
}

export interface AdrGetResult extends AdrEntry {
  readonly content: string
}

export interface AdrCreateResult extends AdrEntry {
  readonly action: 'created'
}

export interface AdrOptions {
  readonly directory: string
  readonly action: AdrAction
  readonly id?: number
  readonly title?: string
  readonly context?: string
  readonly decision?: string
  readonly status?: string
}

export class AdrNotFoundError extends Error {
  constructor(id: number) {
    super(`ADR 不存在：docs/decisions/ 中无 #${id}`)
    this.name = 'AdrNotFoundError'
  }
}

const ADR_LINE_RE = /^#?\s*ADR-(\d+)[\s:：]*(.*)$/u

/** Parse the ADR number + title from a record's first heading line. */
function parseTitle(firstLine: string): { id: number; title: string } | undefined {
  const match = ADR_LINE_RE.exec(firstLine)
  if (match === null) return undefined
  return { id: Number.parseInt(match[1] as string, 10), title: (match[2] ?? '').trim() }
}

/** List ADR records (numbered Markdown files) in ascending id order. */
export function listAdrs(directory: string): AdrListResult {
  const entries: AdrEntry[] = []
  let files: string[]
  try {
    files = readdirSync(directory)
  } catch {
    return { directory, adrs: [], total: 0 }
  }
  for (const fileName of files) {
    if (!fileName.endsWith('.md')) continue
    const filePath = join(directory, fileName)
    const firstLine = firstLineOf(filePath)
    const parsed = firstLine === undefined ? undefined : parseTitle(firstLine)
    if (parsed === undefined) continue
    entries.push({ id: parsed.id, title: parsed.title, fileName, filePath })
  }
  entries.sort((a, b) => a.id - b.id)
  return { directory, adrs: entries, total: entries.length }
}

/** Read a single ADR by number. */
export function getAdr(directory: string, id: number): AdrGetResult {
  const entry = listAdrs(directory).adrs.find(record => record.id === id)
  if (entry === undefined) throw new AdrNotFoundError(id)
  const content = readFileSync(entry.filePath, 'utf8')
  return { ...entry, content }
}

/** Create the next-sequential ADR and return its record. */
export function createAdr(options: AdrOptions): AdrCreateResult {
  const existing = listAdrs(options.directory)
  const id = options.id ?? (existing.total === 0 ? 1 : existing.adrs[existing.adrs.length - 1]!.id + 1)
  const title = options.title ?? `(untitled-${id})`
  const status = options.status ?? 'Proposed'
  mkdirSync(options.directory, { recursive: true })
  const fileName = `${pad(id)}-${slugify(title)}.md`
  const filePath = join(options.directory, fileName)
  const content = template(id, {
    title,
    status,
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.decision === undefined ? {} : { decision: options.decision }),
  })
  writeFileSync(filePath, content, 'utf8')
  return { id, title, fileName, filePath, action: 'created' }
}

/** Next ADR candidate number without creating it (`id` hint via options). */
export function nextAdrId(directory: string): number {
  const existing = listAdrs(directory)
  return existing.total === 0 ? 1 : existing.adrs[existing.adrs.length - 1]!.id + 1
}

function firstLineOf(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf8')
    const line = content.split('\n').find(line => line.startsWith('#'))
    return line
  } catch {
    return undefined
  }
}

function pad(id: number): string {
  return id.toString().padStart(4, '0')
}

function slugify(title: string): string {
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'adr'
}

function template(id: number, data: { title: string; status: string; context?: string; decision?: string }): string {
  const context = data.context ?? ''
  const decision = data.decision ?? ''
  return `# ADR-${id}: ${data.title}

## Status
${data.status}

## Context
${context || '<!-- 决策背景：问题、约束与备选方案 -->'}

## Decision
${decision || '<!-- 决策结论：选择方案及理由 -->'}

## Consequences
<!-- 权衡与影响 -->
`
}