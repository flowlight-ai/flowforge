/**
 * @flowforge/plugin-codebase — structural indexer (EP-CB0, T1.5).
 *
 * Ported from codebase-memory-mcp's graph_buffer + pipeline design (structure
 * slice): aggregate the Project → Folder → File tree in RAM first, then flush
 * nodes/edges to the store in two batched transactions (RAM-first). Module
 * detection marks package directories (package.json / pyproject.toml) on the
 * Folder node's properties; dedicated Module nodes with IMPORTS dependency
 * edges land with the symbol pipeline (EP-CB1+).
 *
 * Index modes (C parity): `full` indexes every discovered file (subject to
 * exclusion rules); `moderate`/`fast` restrict to code extensions — modes
 * are honest file filters, later batches add semantic-edge differences.
 *
 * @module @flowforge/plugin-codebase/indexer
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { emptyCoverage } from './coverage.ts'
import type { CoverageReport, SkippedFile } from './coverage.ts'
import { discoverFiles } from './discover.ts'
import type { NodeRecord, EdgeRecord, CodebaseStore } from './store.ts'
import { deriveProjectName } from './project.ts'

export type IndexMode = 'full' | 'moderate' | 'fast'

export const INDEX_MODES: readonly IndexMode[] = ['full', 'moderate', 'fast']

/** Extensions kept in moderate/fast modes (code-centric slice). */
const CODE_EXTENSIONS: readonly string[] = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc',
  'py', 'pyi', 'toml', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cc',
  'cpp', 'hpp', 'cs', 'rb', 'php', 'sh', 'ps1', 'sql', 'yaml', 'yml',
]

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
  py: 'python', pyi: 'python', toml: 'toml', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cc: 'cpp',
  cpp: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  sql: 'sql', yaml: 'yaml', yml: 'yaml', css: 'css', scss: 'scss',
  html: 'html', xml: 'xml', svg: 'svg', txt: 'text',
}

/** Files that identify a package directory (Module detection). */
const PACKAGE_MARKERS: Readonly<Record<string, 'npm' | 'python'>> = {
  'package.json': 'npm',
  'pyproject.toml': 'python',
}

export interface IndexOptions {
  readonly repoPath: string
  readonly store: CodebaseStore
  /** Override the derived project name (C parity: `name` param). */
  readonly projectName?: string
  readonly mode?: IndexMode
  readonly exclude?: readonly string[]
  /** Max file size in bytes to read for line counting (larger files are counted skipped). */
  readonly maxFileBytes?: number
}

export interface IndexResult {
  readonly project: string
  readonly mode: IndexMode
  readonly filesIndexed: number
  readonly nodeCount: number
  readonly edgeCount: number
  readonly coverage: CoverageReport
  readonly durationMs: number
}

function extensionOf(relativePath: string): string {
  const name = relativePath.split('/').pop() as string
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function detectLanguage(relativePath: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[extensionOf(relativePath)]
}

function countLines(content: string): number {
  if (content.length === 0) return 0
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
}

function folderOf(relativePath: string): string {
  const parent = dirname(relativePath)
  return parent === '.' ? '' : parent.split('\\').join('/')
}

interface PackageIdentity {
  readonly kind: 'npm' | 'python'
  readonly name?: string
  readonly version?: string
}

function readPackageIdentity(root: string, relativePath: string): PackageIdentity | undefined {
  const kind = PACKAGE_MARKERS[relativePath.split('/').pop() as string]
  if (kind === undefined) return undefined
  try {
    const raw = readFileSync(join(root, relativePath), 'utf8')
    if (kind === 'npm') {
      const parsed = JSON.parse(raw) as { name?: string; version?: string }
      return {
        kind,
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.version === undefined ? {} : { version: parsed.version }),
      }
    }
    const nameMatch = /^name\s*=\s*"([^"]+)"/m.exec(raw)
    const versionMatch = /^version\s*=\s*"([^"]+)"/m.exec(raw)
    return {
      kind,
      ...(nameMatch === null ? {} : { name: nameMatch[1] }),
      ...(versionMatch === null ? {} : { version: versionMatch[1] }),
    }
  } catch {
    return { kind }
  }
}

/** Index the structural slice of a repository into the store. */
export function indexRepository(options: IndexOptions): IndexResult {
  const started = Date.now()
  const mode: IndexMode = options.mode ?? 'full'
  const repoRoot = options.repoPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const project = options.projectName ?? deriveProjectName(options.repoPath)
  const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024
  const discovered = discoverFiles(options.repoPath, { ...(options.exclude === undefined ? {} : { exclude: options.exclude }) })

  const nodes: NodeRecord[] = []
  const edges: EdgeRecord[] = []
  const skipped: SkippedFile[] = []

  // Project root node.
  const projectId = `p:${project}`
  nodes.push({ id: projectId, project, label: 'Project', name: project, filePath: repoRoot })

  const folderIds = new Map<string, string>()
  const ensureFolder = (folderPath: string): string => {
    if (folderPath === '') return projectId
    const existing = folderIds.get(folderPath)
    if (existing !== undefined) return existing
    const id = `d:${project}:${folderPath}`
    folderIds.set(folderPath, id)
    nodes.push({ id, project, label: 'Folder', name: folderPath, filePath: folderPath })
    const parentPath = folderOf(folderPath)
    const parentId = parentPath === '' ? projectId : ensureFolder(parentPath)
    edges.push({ project, source: parentId, target: id, type: 'CONTAINS_FOLDER' })
    return id
  }

  for (const file of discovered.files) {
    const ext = extensionOf(file.relativePath)
    if (mode !== 'full' && !CODE_EXTENSIONS.includes(ext)) continue
    const identity = readPackageIdentity(options.repoPath, file.relativePath)
    const parentId = ensureFolder(folderOf(file.relativePath))
    const fileId = `c:${project}:${file.relativePath}`
    const language = detectLanguage(file.relativePath)
    let lines: number | undefined
    if (file.sizeBytes <= maxFileBytes) {
      try {
        lines = countLines(readFileSync(file.absolutePath, 'utf8'))
      } catch (error) {
        skipped.push({ path: file.relativePath, reason: `读取失败：${(error as Error).message}` })
        continue
      }
    } else {
      skipped.push({ path: file.relativePath, reason: `超过 ${maxFileBytes} 字节行数统计上限` })
      continue
    }
    nodes.push({
      id: fileId,
      project,
      label: 'File',
      name: file.relativePath,
      filePath: file.relativePath,
      ...(language === undefined ? {} : { language }),
      ...(lines === undefined ? {} : { lines }),
      sizeBytes: file.sizeBytes,
      ...(identity === undefined ? {} : { props: { isPackageMarker: true, packageKind: identity.kind, ...(identity.name === undefined ? {} : { packageName: identity.name }), ...(identity.version === undefined ? {} : { packageVersion: identity.version }) } }),
    })
    edges.push({ project, source: parentId, target: fileId, type: 'CONTAINS_FILE' })

    // Module detection: the folder carrying a package marker becomes a
    // module boundary — recorded on the Folder node's props.
    if (identity !== undefined) {
      const folderPath = folderOf(file.relativePath)
      const folderId = folderPath === '' ? projectId : ensureFolder(folderPath)
      const folderNode = nodes.find(node => node.id === folderId)
      if (folderNode !== undefined) {
        const index = nodes.indexOf(folderNode)
        nodes[index] = {
          ...folderNode,
          props: {
            ...(folderNode.props ?? {}),
            module: true,
            moduleKind: identity.kind,
            ...(identity.name === undefined ? {} : { moduleName: identity.name }),
            ...(identity.version === undefined ? {} : { moduleVersion: identity.version }),
          },
        }
      }
    }
  }

  options.store.open()
  options.store.deleteProject(project)
  options.store.registerProject(project)
  options.store.upsertNodes(nodes)
  options.store.insertEdges(edges)
  options.store.updateProjectIndexState(project, mode, nodes.filter(node => node.label === 'File').length)

  const coverage: CoverageReport = { ...emptyCoverage(discovered.excluded), skipped }

  return {
    project,
    mode,
    filesIndexed: nodes.filter(node => node.label === 'File').length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    coverage,
    durationMs: Date.now() - started,
  }
}
