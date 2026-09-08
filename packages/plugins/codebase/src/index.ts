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
  checkIndexCoverage,
} from './query.ts'
export type { QueryInput, IndexStatus, IndexCoverageResult } from './query.ts'

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

export { tracePath } from './trace.ts'
export type { TraceOptions, TraceResult, TraceRow, TraceDirection } from './trace.ts'

export { searchCode } from './search.ts'
export type { SearchCodeOptions, SearchCodeResult, SearchCodeMatch } from './search.ts'

export { getArchitecture } from './architecture.ts'
export type {
  ArchitectureOptions,
  ArchitectureResult,
  ArchitectureModule,
  CrossModuleDependency,
  HotFile,
} from './architecture.ts'

export { detectChanges } from './changes.ts'
export type {
  DetectChangesOptions,
  DetectChangesResult,
  ChangeGroup,
} from './changes.ts'

export { compareGraphs } from './compare.ts'
export type {
  CompareGraphsOptions,
  CompareGraphsResult,
  CompareNodeDelta,
  CompareEdgeDelta,
} from './compare.ts'

export { listAdrs, getAdr, createAdr, nextAdrId, AdrNotFoundError } from './adr.ts'
export type {
  AdrAction,
  AdrEntry,
  AdrListResult,
  AdrGetResult,
  AdrCreateResult,
  AdrOptions,
} from './adr.ts'

export { generateDocument } from './docgen.ts'
export type {
  DocTemplate,
  DocgenOptions,
  DocgenResult,
  DocgenSection,
} from './docgen.ts'

export { codebaseToolCards, isCodebaseTool, READ_ONLY_TOOL_NAMES } from './mcp.ts'
export type { McpTocCard } from './mcp.ts'

export { TRACE_EDGE_TYPES } from './store.ts'

export { queryCypher, tokenizeCypher, parseCypher, executeCypher, buildAdjacency, MAX_RESULT_ROWS, DEFAULT_EXEC_BUDGET, MAX_HOPS, ORDER_KEYS_MAX } from './cypher.ts'
export type {
  CypherQueryOptions, CypherResult, ExecOptions, CypherToken, CypherTokenType,
  CypherQuery, CypherPattern, NodePattern, RelPattern, Condition, WhereExpr,
  ReturnItem, OrderKey, PropFilter,
} from './cypher.ts'

export { missedGraph } from './missed.ts'
export type { MissedResult, MissedDir, MissedFile } from './missed.ts'

export { watchIndex, detectFileDelta } from './watcher.ts'
export type { WatchOptions, WatchResult } from './watcher.ts'

export { ingestTraces, queryTraces } from './traces.ts'
export type { IngestOptions, IngestResult } from './traces.ts'

export { dumpArtifact, restoreArtifact, removeArtifact } from './artifact.ts'
export type { ArtifactReport, DumpOptions, RestoreOptions } from './artifact.ts'

export {
  simhash,
  hammingDistance,
  cosineSimilarity,
  termFrequency,
  semanticSimilarityEdges,
  semanticQuery,
} from './semantic.ts'
export type {
  SemanticSimilarityOptions,
  SemanticSimilarityResult,
  SemanticQueryOptions,
} from './semantic.ts'

export { augmentWithLsp, LSP_EDGE_TYPES } from './lsp-seam.ts'
export type {
  LspSeam,
  LspEnhanceRequest,
  AugmentWithLspOptions,
  AugmentResult,
} from './lsp-seam.ts'

export { detectCrossProjectEdges } from './cross-repo.ts'
export type { SiblingProject, CrossRepoOptions, CrossRepoResult } from './cross-repo.ts'

export { propagateLoopDepth } from './loop-depth.ts'
export type { LoopDepthResult } from './loop-depth.ts'
