/**
 * @flowforge/plugin-codebase — structural + symbol indexer (EP-CB0 T1.5,
 * EP-CB1 T2.4b).
 *
 * Ported from codebase-memory-mcp's graph_buffer + pipeline design: aggregate
 * the Project → Folder → File tree and the symbol slice in RAM first, then
 * flush nodes/edges to the store in batched transactions (RAM-first). Module
 * detection marks package directories (package.json / pyproject.toml) on the
 * Folder node's properties.
 *
 * Symbol layer (EP-CB1): TS/TSX/JS files parse through the web-tree-sitter
 * singleton; a definition pass aggregates symbol nodes + DEFINES /
 * DEFINES_METHOD material, then a resolution pass rebuilds the registry and
 * emits CALLS / INHERITS / IMPLEMENTS / USAGE edges. Files whose tree carries
 * ERROR nodes are reported through coverage.parsePartial (the coverage
 * honesty contract's third state).
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
import { computeQualifiedName, extractSymbols } from './symbols.ts'
import type { EdgeMaterial } from './symbols.ts'
import { buildRegistry, extractEdges, extractImports } from './edges.ts'
import { createCodebaseParser } from './parser.ts'
import { SUPPORTED_SYMBOL_LANGUAGES } from './parser.ts'
import type { Tree } from 'web-tree-sitter'

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
  /** Symbol-layer node count (EP-CB1): symbols minted by the definition pass. */
  readonly symbolCount: number
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

interface ParsedSymbolFile {
  readonly relPath: string
  readonly language: string
  readonly source: string
  readonly tree: Tree
}

/**
 * Index the structural + symbol slices of a repository into the store.
 * Async since EP-CB1: the first symbol file awaits the parser singleton
 * (wasm preload); structure semantics are unchanged.
 */
export async function indexRepository(options: IndexOptions): Promise<IndexResult> {
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

  // ---- Symbol layer (EP-CB1): definition pass → registry → resolution pass.

  const parser = await createCodebaseParser()
  const skippedPaths = new Set(skipped.map(entry => entry.path))
  const parsed: ParsedSymbolFile[] = []
  for (const file of discovered.files) {
    const ext = extensionOf(file.relativePath)
    if (!SUPPORTED_SYMBOL_LANGUAGES.includes(ext)) continue
    if (mode !== 'full' && !CODE_EXTENSIONS.includes(ext)) continue
    if (skippedPaths.has(file.relativePath) || file.sizeBytes > maxFileBytes) continue
    let source: string
    try {
      source = readFileSync(file.absolutePath, 'utf8')
    } catch {
      continue // already reported by the structural pass (or unreadable)
    }
    const tree = parser.parseFile(source, ext)
    if (tree !== undefined) parsed.push({ relPath: file.relativePath, language: detectLanguage(file.relativePath) ?? ext, source, tree })
  }

  const parsePartial: SkippedFile[] = []
  const symbolNodes: NodeRecord[] = []
  const symbolEdgeMaterial: EdgeMaterial[] = []
  for (const file of parsed) {
    const extraction = extractSymbols(file.tree, file.source, { project, relPath: file.relPath, language: file.language })
    symbolNodes.push(...extraction.nodes)
    symbolEdgeMaterial.push(...extraction.defines, ...extraction.methods)
    if (extraction.parseIncomplete) {
      parsePartial.push({ path: file.relPath, reason: '语法错误（ERROR/MISSING 节点），符号可能不完整' })
    }
  }

  const registry = buildRegistry(symbolNodes)
  for (const file of parsed) {
    const fileQn = computeQualifiedName(project, file.relPath, '')
    const imports = extractImports(file.tree, file.source, { project, relPath: file.relPath })
    const resolved = extractEdges(file.tree, file.source, { project, relPath: file.relPath, fileQn, imports, registry })
    symbolEdgeMaterial.push(...resolved.calls, ...resolved.inherits, ...resolved.implements, ...resolved.usages)
  }

  const symbolEdges: EdgeRecord[] = symbolEdgeMaterial.map(material => ({
    project,
    source: material.source,
    target: material.target,
    type: material.type,
  }))

  options.store.open()
  options.store.deleteProject(project)
  options.store.registerProject(project)
  options.store.upsertNodes(nodes)
  options.store.insertEdges(edges)
  options.store.upsertNodes(symbolNodes)
  options.store.insertEdges(symbolEdges)
  options.store.updateProjectIndexState(project, mode, nodes.filter(node => node.label === 'File').length)

  const coverage: CoverageReport = { ...emptyCoverage(discovered.excluded), skipped, parsePartial }

  return {
    project,
    mode,
    filesIndexed: nodes.filter(node => node.label === 'File').length,
    nodeCount: nodes.length + symbolNodes.length,
    edgeCount: edges.length + symbolEdges.length,
    symbolCount: symbolNodes.length,
    coverage,
    durationMs: Date.now() - started,
  }
}
