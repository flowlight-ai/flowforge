/**
 * @flowforge/plugin-codebase — architecture overview (EP-CB2, T3.1c).
 *
 * Ported from codebase-memory-mcp's `get_architecture` tool: derive module
 * boundaries from the indexed file tree, aggregate cross-module dependencies
 * (CALLS/IMPORTS edges), and rank hot files by complexity (fallback: degree).
 *
 * Pure read-only consumer over the store via the id→path index. Deterministic
 * ordering: module name ascending; dependencies from/to ascending; hot files
 * by rank (complexity desc → degree desc → path asc).
 *
 * @module @flowforge/plugin-codebase/architecture
 */

import type { CodebaseStore } from './store.ts'
import { ProjectNotFoundError } from './query.ts'

export interface ArchitectureOptions {
  readonly project: string
  readonly depth?: number
}

export interface ArchitectureModule {
  readonly name: string
  readonly fileCount: number
}

export interface CrossModuleDependency {
  readonly from: string
  readonly to: string
  readonly count: number
  readonly edgeTypes: readonly string[]
}

export interface HotFile {
  readonly filePath: string
  readonly complexity: number | undefined
  readonly degree: number
}

export interface ArchitectureResult {
  readonly project: string
  readonly depth: number
  readonly moduleCount: number
  readonly modules: readonly ArchitectureModule[]
  readonly dependencies: readonly CrossModuleDependency[]
  readonly hotFiles: readonly HotFile[]
}

const CROSS_MODULE_EDGE_TYPES = new Set<string>(['CALLS', 'IMPORTS', 'USAGE'])

/**
 * Compute an architecture view. Modules are inferred from the first `depth`
 * path segments of each indexed File node; cross-module dependencies aggregate
 * CALLS/IMPORTS/USAGE edges; hot files rank by complexity then degree.
 */
export function getArchitecture(store: CodebaseStore, options: ArchitectureOptions): ArchitectureResult {
  const project = options.project
  if (store.listProjects().find(info => info.name === project) === undefined) {
    throw new ProjectNotFoundError(project)
  }
  const depth = Math.max(1, options.depth ?? 2)

  const files = store.listFileNodes(project)
  const edges = store.edgesOf(project)
  const nodePath = store.indexNodePaths(project)

  // Assign each File to a module = first `depth` segments of its path, keeping a
  // file_path → module map so symbol nodes (edges target File-level attrs) can
  // be resolved through their owning file.
  const pathToModule = new Map<string, string>()
  const moduleFileCount = new Map<string, number>()
  for (const node of files) {
    if (node.filePath === undefined) continue
    const segments = node.filePath.split('/').filter(segment => segment.length > 0)
    const module = segments.slice(0, depth).join('/')
    pathToModule.set(node.filePath, module)
    moduleFileCount.set(module, (moduleFileCount.get(module) ?? 0) + 1)
  }

  const modules: ArchitectureModule[] = Array.from(moduleFileCount.entries())
    .map(([name, count]) => ({ name, fileCount: count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Cross-module dependency aggregation (source id → path → module).
  const depAgg = new Map<string, Map<string, Set<string>>>()
  for (const edge of edges) {
    if (!CROSS_MODULE_EDGE_TYPES.has(edge.type)) continue
    const from = nodePath.get(edge.source)
    const to = nodePath.get(edge.target)
    // Resolve both ends to a module via their owning file path (skip synthetic ids).
    if (from === undefined || to === undefined) continue
    const fromModule = pathToModule.get(from)
    const toModule = pathToModule.get(to)
    if (fromModule === undefined || toModule === undefined || fromModule === toModule) continue
    const inner = depAgg.get(fromModule)
    if (inner === undefined) {
      depAgg.set(fromModule, new Map())
      depAgg.get(fromModule)!.set(toModule, new Set([edge.type]))
      continue
    }
    const types = inner.get(toModule)
    if (types === undefined) inner.set(toModule, new Set([edge.type]))
    else types.add(edge.type)
  }
  const dependencies: CrossModuleDependency[] = []
  for (const from of Array.from(depAgg.keys()).sort()) {
    for (const to of Array.from(depAgg.get(from)!.keys()).sort()) {
      const types = depAgg.get(from)!.get(to)!
      dependencies.push({ from, to, count: types.size, edgeTypes: Array.from(types).sort() })
    }
  }

  // Hot files ranked by complexity (fallback degree), deterministic tie-breaks.
  const degrees = new Map<string, number>()
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
  }
  const hotFiles: HotFile[] = files
    .filter(node => node.filePath !== undefined)
    .map(node => ({
      filePath: node.filePath as string,
      complexity: typeof node.props?.complexity === 'number' ? node.props.complexity : undefined,
      degree: degrees.get(node.id) ?? 0,
    }))
    .sort((a, b) => (b.complexity ?? -1) - (a.complexity ?? -1) || b.degree - a.degree || a.filePath.localeCompare(b.filePath))
    .slice(0, 10)

  return { project, depth, moduleCount: modules.length, modules, dependencies, hotFiles }
}