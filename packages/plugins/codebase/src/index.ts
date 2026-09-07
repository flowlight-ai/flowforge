/**
 * @flowforge/plugin-codebase — public export surface (EP-CB0).
 *
 * Library form mirrors @flowforge/plugin-dev: consumers import the graph
 * model, store, indexer and query layer directly; the CLI (bin/ff_codebase.mjs)
 * and the tool registry (tools.ts) sit on the same primitives.
 *
 * @module @flowforge/plugin-codebase
 */

export {
  NODE_LABELS,
  EDGE_TYPES,
  STRUCTURAL_LABELS,
  SYMBOL_LABELS,
  COMPLEXITY_LABELS,
  BM25_LABEL_BOOST,
  BM25_NOISE_LABELS,
  isNodeLabel,
  isEdgeType,
} from './graph-model.ts'
export type {
  NodeLabel,
  EdgeType,
  ComplexityProps,
  CodeProps,
  GraphNode,
  GraphEdge,
  Pagination,
} from './graph-model.ts'

export { CodebaseStore, tokenizeName, buildFtsMatch } from './store.ts'
export type {
  NodeRecord,
  EdgeRecord,
  ProjectInfo,
  LabelCount,
  EdgeTypeCount,
  SchemaOverview,
  SearchOptions,
  StoreQueryResult,
  FileOutlineOptions,
} from './store.ts'

export { indexRepository, INDEX_MODES } from './indexer.ts'
export type { IndexMode, IndexOptions, IndexResult } from './indexer.ts'

export { discoverFiles, DEFAULT_EXCLUDED_DIRS } from './discover.ts'
export type { DiscoveredFile, DiscoverResult, DiscoverOptions } from './discover.ts'

export { SUPPORTED_SYMBOL_LANGUAGES, createCodebaseParser } from './parser.ts'
export type { CodebaseParser } from './parser.ts'

export { BRANCHING_NODE_TYPES, computeComplexity, countParams } from './complexity.ts'
export type { ComplexityMetrics } from './complexity.ts'

export {
  CLASS_NODE_TYPES,
  FUNCTION_NODE_TYPES,
  computeQualifiedName,
  extractSymbols,
  fileNodeId,
  isTestFilePath,
  symbolNodeId,
} from './symbols.ts'
export type {
  EdgeMaterial,
  ExtractSymbolsContext,
  SymbolExtraction,
} from './symbols.ts'

export { buildRegistry, extractEdges, extractImports, resolveCall } from './edges.ts'
export type {
  EdgeExtraction,
  ExtractEdgesContext,
  ExtractImportsContext,
  ImportBinding,
  Registry,
  Resolution,
  ResolutionStrategy,
  ResolveCallContext,
} from './edges.ts'

export { emptyCoverage } from './coverage.ts'
export type { CoverageReport, SkippedFile } from './coverage.ts'

export { codeSnippet, fileOutline, SymbolNotFoundError } from './outline.ts'
export type {
  OutlineOptions,
  OutlineResult,
  OutlineRow,
  SnippetOptions,
  SnippetResult,
  SnippetSuggestion,
} from './outline.ts'

export { sanitizeProjectName, deriveProjectName } from './project.ts'

export {
  UsageError,
  ProjectNotFoundError,
  requireProject,
  searchNodes,
  schemaFor,
  indexStatus,
  iteratePages,
} from './query.ts'
export type { QueryInput, IndexStatus } from './query.ts'

export { TOOLS, implementedTools, executeTool } from './tools.ts'
export type {
  ToolName,
  ToolDefinition,
  ToolContext,
  ToolResult,
  IndexRepositoryInput,
  SearchGraphInput,
  GetFileOutlineInput,
  GetCodeSnippetInput,
} from './tools.ts'
