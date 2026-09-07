/**
 * @flowforge/plugin-codebase — model-facing tool registry (EP-CB0, T1.8).
 *
 * The full 17-tool surface carried over from codebase-memory-mcp is declared
 * here up front (name + description + input schema), so later batches extend
 * implementations without breaking the registry contract. EP-CB0 implements
 * the structure-level six: index_repository, list_projects, delete_project,
 * index_status, get_graph_schema, search_graph (structural subset).
 *
 * The registry mirrors the @flowforge/tool-lsp shape (schema + description +
 * execute dispatch) and stays a plain library surface — MCP mounting lands
 * with the harness integration batch (EP-CB2 T3.5).
 *
 * @module @flowforge/plugin-codebase/tools
 */

import { indexRepository } from './indexer.ts'
import type { IndexMode, IndexResult } from './indexer.ts'
import { searchNodes, schemaFor, indexStatus } from './query.ts'
import type { ProjectInfo, SchemaOverview, StoreQueryResult } from './store.ts'
import type { CodebaseStore } from './store.ts'

export type ToolName =
  | 'index_repository'
  | 'search_graph'
  | 'query_graph'
  | 'trace_path'
  | 'get_code_snippet'
  | 'get_file_outline'
  | 'get_graph_schema'
  | 'compare_graphs'
  | 'get_architecture'
  | 'search_code'
  | 'list_projects'
  | 'delete_project'
  | 'index_status'
  | 'check_index_coverage'
  | 'detect_changes'
  | 'manage_adr'
  | 'ingest_traces'

export interface ToolDefinition {
  readonly name: ToolName
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** EP-CB0 batch marker; unimplemented names are declared but not executable. */
  readonly implementedIn: 'EP-CB0' | 'EP-CB1' | 'EP-CB2' | 'EP-CB3' | 'EP-CB4'
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'index_repository',
    description: 'Index a repository into the knowledge graph. Modes: full (every discovered file), moderate/fast (code extensions slice; semantic edges land with EP-CB4). The response reports files that were NOT indexed — excluded (by design, gitignore-style rules) and skipped (failed reads) — absence is NOT a completeness guarantee.',
    implementedIn: 'EP-CB0',
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: { type: 'string', description: 'Path to the repository' },
        mode: { type: 'string', enum: ['full', 'moderate', 'fast'], default: 'full' },
        name: { type: 'string', description: 'Override the derived project name (sanitized: non-ASCII encoded, unsafe path characters normalized)' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'Extra exclusion directory patterns beyond the defaults' },
      },
      required: ['repo_path'],
    },
  },
  {
    name: 'search_graph',
    description: 'Search the code knowledge graph. query= BM25 ranked full-text with camelCase splitting and structural label boosting; name_pattern / file_pattern = regex filters; min_degree/max_degree over CALLS/USAGE/CALL_REFERENCE/INHERITS/IMPLEMENTS. Pagination contract: total + has_more with limit/offset.',
    implementedIn: 'EP-CB0',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        query: { type: 'string', description: 'BM25 full-text tokens (whitespace split, implicit OR)' },
        label: { type: 'string', description: 'Exact node label filter (File/Folder/Function/...)' },
        name_pattern: { type: 'string', description: 'Regex on node qualified name' },
        file_pattern: { type: 'string', description: 'Regex on file path' },
        min_degree: { type: 'integer' },
        max_degree: { type: 'integer' },
        limit: { type: 'integer', default: 50 },
        offset: { type: 'integer', default: 0 },
      },
      required: ['project'],
    },
  },
  {
    name: 'query_graph',
    description: 'Execute a Cypher query against the knowledge graph (MATCH/WHERE/RETURN/ORDER BY/LIMIT subset, 100k row ceiling).',
    implementedIn: 'EP-CB3',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, project: { type: 'string' }, graph: { type: 'string', enum: ['code', 'missed'], default: 'code' } }, required: ['query'] },
  },
  {
    name: 'trace_path',
    description: 'Trace caller/callee paths through the graph.',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, qualified_name: { type: 'string' }, direction: { type: 'string', enum: ['callers', 'callees'], default: 'callers' }, max_depth: { type: 'integer', default: 5 } }, required: ['project', 'qualified_name'] },
  },
  {
    name: 'get_code_snippet',
    description: 'Read a code snippet by file + line range with context.',
    implementedIn: 'EP-CB1',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, file_path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['project', 'file_path', 'start_line', 'end_line'] },
  },
  {
    name: 'get_file_outline',
    description: 'Symbol outline of a file (functions/classes with line spans).',
    implementedIn: 'EP-CB1',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, file_path: { type: 'string' } }, required: ['project', 'file_path'] },
  },
  {
    name: 'get_graph_schema',
    description: 'Node label counts, edge type counts and registered projects of the knowledge graph.',
    implementedIn: 'EP-CB0',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
  },
  {
    name: 'compare_graphs',
    description: 'Compare two indexed snapshots (added/removed nodes and edges).',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project_a: { type: 'string' }, project_b: { type: 'string' } }, required: ['project_a', 'project_b'] },
  },
  {
    name: 'get_architecture',
    description: 'Architecture overview: module boundaries, cross-module dependencies, hot files.',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, depth: { type: 'integer', default: 2 } }, required: ['project'] },
  },
  {
    name: 'search_code',
    description: 'Search raw code text (literal/regex) across indexed files.',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, pattern: { type: 'string' }, file_pattern: { type: 'string' } }, required: ['project', 'pattern'] },
  },
  {
    name: 'list_projects',
    description: 'List indexed projects with their index state.',
    implementedIn: 'EP-CB0',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_project',
    description: 'Delete an indexed project and all its graph data.',
    implementedIn: 'EP-CB0',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] },
  },
  {
    name: 'index_status',
    description: 'Index freshness and per-project stats (files, nodes, edges, coverage signals).',
    implementedIn: 'EP-CB0',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } } },
  },
  {
    name: 'check_index_coverage',
    description: 'Targeted index-coverage check: which files/constructs may be missing from the graph (parse_partial ranges, skipped files, excluded rules).',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, file_pattern: { type: 'string' } }, required: ['project'] },
  },
  {
    name: 'detect_changes',
    description: 'Detect source changes since the last index (git-aware incremental hints).',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, repo_path: { type: 'string' } }, required: ['project', 'repo_path'] },
  },
  {
    name: 'manage_adr',
    description: 'Architecture decision record management integrated with docs/decisions/.',
    implementedIn: 'EP-CB2',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, action: { type: 'string', enum: ['list', 'get', 'create'] }, id: { type: 'string' } }, required: ['project', 'action'] },
  },
  {
    name: 'ingest_traces',
    description: 'Ingest agent execution traces into the graph for usage analytics.',
    implementedIn: 'EP-CB3',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, trace_path: { type: 'string' } }, required: ['project', 'trace_path'] },
  },
]

export function implementedTools(): readonly ToolDefinition[] {
  return TOOLS.filter(tool => tool.implementedIn === 'EP-CB0')
}

export interface ToolContext {
  readonly store: CodebaseStore
}

export interface IndexRepositoryInput {
  readonly repoPath: string
  readonly mode?: IndexMode
  readonly name?: string
  readonly exclude?: readonly string[]
}

export interface SearchGraphInput {
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

export type ToolResult =
  | { readonly kind: 'index'; readonly result: IndexResult }
  | { readonly kind: 'search'; readonly result: StoreQueryResult }
  | { readonly kind: 'schema'; readonly result: SchemaOverview }
  | { readonly kind: 'projects'; readonly result: readonly ProjectInfo[] }
  | { readonly kind: 'status'; readonly result: ReturnType<typeof indexStatus> }
  | { readonly kind: 'deleted'; readonly result: boolean }
  | { readonly kind: 'not-implemented'; readonly plannedFor: string }

/**
 * Execute a tool by name. Throws UsageError/ProjectNotFoundError from the
 * query layer for contract violations (callers map them to exit codes).
 */
export function executeTool(context: ToolContext, name: ToolName, args: Readonly<Record<string, unknown>>): ToolResult {
  switch (name) {
    case 'index_repository': {
      const input = args as unknown as IndexRepositoryInput
      return {
        kind: 'index',
        result: indexRepository({
          repoPath: input.repoPath,
          store: context.store,
          ...(input.mode === undefined ? {} : { mode: input.mode }),
          ...(input.name === undefined ? {} : { projectName: input.name }),
          ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
        }),
      }
    }
    case 'search_graph': {
      const input = args as unknown as SearchGraphInput
      return { kind: 'search', result: searchNodes(context.store, input) }
    }
    case 'get_graph_schema':
      return { kind: 'schema', result: schemaFor(context.store, args.project as string | undefined) }
    case 'list_projects':
      return { kind: 'projects', result: context.store.listProjects() }
    case 'index_status':
      return { kind: 'status', result: indexStatus(context.store, args.project as string | undefined) }
    case 'delete_project':
      return { kind: 'deleted', result: context.store.deleteProject(args.project as string) }
    default: {
      const plannedFor = TOOLS.find(tool => tool.name === name)?.implementedIn ?? 'later batch'
      return { kind: 'not-implemented', plannedFor }
    }
  }
}
