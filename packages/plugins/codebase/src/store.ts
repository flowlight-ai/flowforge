/**
 * @flowforge/plugin-codebase — node:sqlite storage engine (EP-CB0, T1.3).
 *
 * Ported from codebase-memory-mcp's store/graph_buffer design:
 * - RAM-first: callers aggregate NodeRecord/EdgeRecord arrays in memory, then
 *   flush in batched transactions (`upsertNodes` / `insertEdges`).
 * - FTS5 full-text index with camelCase splitting (`updateCloudClient` is
 *   indexed as `update cloud client`) and BM25 ranking with structural label
 *   boosting (Function/Method +10, Route +8, Class/Interface +5) plus noise
 *   label filtering — weights carried over from the C search_graph tool.
 * - Pagination contract: total / hasMore / offset / limit.
 *
 * The store is a plain library surface (no cordis dependency): the indexer
 * CLI writes, tools and queries read — mirroring the C project's separation
 * of the indexing worker process from the read-only MCP server.
 *
 * @module @flowforge/plugin-codebase/store
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BM25_LABEL_BOOST, BM25_NOISE_LABELS, SYMBOL_LABELS } from './graph-model.ts'
import type { EdgeType, GraphEdge, GraphNode, NodeLabel } from './graph-model.ts'

/** Persisted node record (input shape for upserts). */
export interface NodeRecord {
  readonly id: string
  readonly project: string
  readonly label: NodeLabel
  readonly name: string
  readonly filePath?: string
  readonly language?: string
  readonly lines?: number
  readonly sizeBytes?: number
  readonly props?: Readonly<Record<string, string | number | boolean>>
}

/** Persisted edge record (input shape for inserts). */
export interface EdgeRecord {
  readonly project: string
  readonly source: string
  readonly target: string
  readonly type: EdgeType
}

export interface ProjectInfo {
  readonly name: string
  readonly createdAt: string
  readonly lastIndexedAt?: string
  readonly lastMode?: string
  readonly filesIndexed?: number
}

export interface LabelCount {
  readonly label: string
  readonly count: number
}

export interface EdgeTypeCount {
  readonly type: string
  readonly count: number
}

/** EP-CB3: a trace record ingested by ingest_traces (external agent trace). */
export interface TraceRecord {
  readonly project: string
  readonly trace_id: string
  readonly name: string
  readonly agent?: string
  readonly timestamp?: string
  readonly metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface SchemaOverview {
  readonly projects: readonly ProjectInfo[]
  readonly nodeLabels: readonly LabelCount[]
  readonly edgeTypes: readonly EdgeTypeCount[]
}

export interface SearchOptions {
  readonly project: string
  /** BM25 full-text query (whitespace tokens, implicit OR, camelCase-split index). */
  readonly query?: string
  readonly label?: NodeLabel
  /** Regex applied to node name (post-filter, ranked order preserved). */
  readonly namePattern?: string
  /** Regex applied to file path (post-filter, ranked order preserved). */
  readonly filePattern?: string
  readonly minDegree?: number
  readonly maxDegree?: number
  readonly limit?: number
  readonly offset?: number
}

export interface StoreQueryResult {
  readonly rows: readonly GraphNode[]
  readonly total: number
  readonly hasMore: boolean
}

export interface FileOutlineOptions {
  /** Restrict the outline to these labels (defaults to all symbol labels). */
  readonly labels?: readonly string[]
  readonly limit?: number
  readonly offset?: number
}

/** Edge types counted toward the in/out degree surface (C parity). */
const DEGREE_EDGE_TYPES = ['CALLS', 'USAGE', 'CALL_REFERENCE', 'INHERITS', 'IMPLEMENTS'] as const

/** Edge types traversed by trace_path (C parity). */
export const TRACE_EDGE_TYPES = ['CALLS', 'USAGE', 'INHERITS', 'IMPLEMENTS'] as const

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_indexed_at TEXT,
  last_mode TEXT,
  files_indexed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT,
  language TEXT,
  lines INTEGER,
  size_bytes INTEGER,
  props_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project);
CREATE INDEX IF NOT EXISTS idx_nodes_project_file ON nodes(project, file_path);
CREATE TABLE IF NOT EXISTS edges (
  project TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (source, target, type)
);
CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project);
CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
  name_text,
  node_id UNINDEXED,
  project UNINDEXED
);
CREATE TABLE IF NOT EXISTS traces (
  project TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  agent TEXT,
  timestamp TEXT,
  metadata_json TEXT,
  PRIMARY KEY (project, trace_id)
);
CREATE INDEX IF NOT EXISTS idx_traces_project_time ON traces(project, timestamp);
`

interface NodeRow {
  id: string
  project: string
  label: string
  name: string
  file_path: string | null
  language: string | null
  lines: number | null
  size_bytes: number | null
  props_json: string | null
}

/**
 * Split an identifier into FTS tokens: camelCase boundaries (both the
 * lowercase→uppercase rule and the acronym rule, `XMLParser` → `XML Parser`),
 * snake/kebab separators and the raw identifier are all emitted, lower-cased.
 * `updateCloudClient` → `updatecloudclient update cloud client`.
 */
export function tokenizeName(name: string): string {
  const raw = name.toLowerCase()
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.:/\\]+/)
    .filter(part => part.length > 0)
    .map(part => part.toLowerCase())
  const unique = Array.from(new Set([raw, ...parts]))
  return unique.join(' ')
}

/** Escape a whitespace-token user query into a safe FTS5 MATCH expression. */
export function buildFtsMatch(query: string): string {
  const tokens = query.split(/\s+/).filter(token => token.length > 0)
  if (tokens.length === 0) return '""'
  return tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(' OR ')
}

function boostForLabel(label: string): number {
  return BM25_LABEL_BOOST[label] ?? 0
}

function rowToNode(row: NodeRow): GraphNode {
  const props = row.props_json === null ? undefined : (JSON.parse(row.props_json) as Record<string, string | number | boolean>)
  const node: GraphNode = {
    id: row.id,
    project: row.project,
    label: row.label as NodeLabel,
    name: row.name,
    ...(row.file_path === null ? {} : { filePath: row.file_path }),
    ...(row.language === null ? {} : { language: row.language }),
    ...(row.lines === null ? {} : { lines: row.lines }),
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
    ...(props === undefined ? {} : { props }),
  }
  return node
}

/**
 * SQLite-backed knowledge-graph store. One database file holds multiple
 * projects (mirroring the C project's multi-project store).
 */
export class CodebaseStore {
  private db: DatabaseSync | undefined
  private readonly dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  /** Open the database and ensure the schema exists. Idempotent. */
  open(): void {
    if (this.db !== undefined) return
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec(SCHEMA_SQL)
  }

  dispose(): void {
    this.db?.close()
    this.db = undefined
  }

  private requireDb(): DatabaseSync {
    if (this.db === undefined) throw new Error('store 未 open（先调用 open()）')
    return this.db
  }

  /** Register (or refresh) a project row. */
  registerProject(name: string): void {
    const db = this.requireDb()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO projects (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').run(name, now)
  }

  updateProjectIndexState(name: string, mode: string, filesIndexed: number): void {
    const db = this.requireDb()
    const now = new Date().toISOString()
    db.prepare('UPDATE projects SET last_indexed_at = ?, last_mode = ?, files_indexed = ? WHERE name = ?').run(now, mode, filesIndexed, name)
  }

  listProjects(): readonly ProjectInfo[] {
    const db = this.requireDb()
    const rows = db.prepare('SELECT name, created_at, last_indexed_at, last_mode, files_indexed FROM projects ORDER BY name').all() as Record<string, unknown>[]
    return rows.map(row => {
      const info: ProjectInfo = {
        name: row.name as string,
        createdAt: row.created_at as string,
        ...(row.last_indexed_at === null ? {} : { lastIndexedAt: row.last_indexed_at as string }),
        ...(row.last_mode === null ? {} : { lastMode: row.last_mode as string }),
        ...(row.files_indexed === null ? {} : { filesIndexed: row.files_indexed as number }),
      }
      return info
    })
  }

  deleteProject(name: string): boolean {
    const db = this.requireDb()
    const existing = db.prepare('SELECT name FROM projects WHERE name = ?').get(name)
    if (existing === undefined) return false
    const transaction = db.prepare('BEGIN')
    transaction.run()
    try {
      db.prepare('DELETE FROM nodes WHERE project = ?').run(name)
      db.prepare('DELETE FROM edges WHERE project = ?').run(name)
      db.prepare('DELETE FROM node_fts WHERE project = ?').run(name)
      db.prepare('DELETE FROM traces WHERE project = ?').run(name)
      db.prepare('DELETE FROM projects WHERE name = ?').run(name)
      db.exec('COMMIT')
      return true
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** Batch upsert nodes in a single transaction, syncing the FTS index. */
  upsertNodes(nodes: readonly NodeRecord[]): void {
    const db = this.requireDb()
    if (nodes.length === 0) return
    db.exec('BEGIN')
    try {
      const upsert = db.prepare(`
        INSERT INTO nodes (id, project, label, name, file_path, language, lines, size_bytes, props_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project = excluded.project,
          label = excluded.label,
          name = excluded.name,
          file_path = excluded.file_path,
          language = excluded.language,
          lines = excluded.lines,
          size_bytes = excluded.size_bytes,
          props_json = excluded.props_json
      `)
      const ftsDelete = db.prepare('DELETE FROM node_fts WHERE node_id = ?')
      const ftsInsert = db.prepare('INSERT INTO node_fts (name_text, node_id, project) VALUES (?, ?, ?)')
      for (const node of nodes) {
        const propsJson = node.props === undefined ? null : JSON.stringify(node.props)
        upsert.run(node.id, node.project, node.label, node.name, node.filePath ?? null, node.language ?? null, node.lines ?? null, node.sizeBytes ?? null, propsJson)
        ftsDelete.run(node.id)
        ftsInsert.run(tokenizeName(node.name), node.id, node.project)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** Batch insert edges in a single transaction (dedup via PK). */
  insertEdges(edges: readonly EdgeRecord[]): void {
    const db = this.requireDb()
    if (edges.length === 0) return
    db.exec('BEGIN')
    try {
      const insert = db.prepare('INSERT OR IGNORE INTO edges (project, source, target, type) VALUES (?, ?, ?, ?)')
      for (const edge of edges) {
        insert.run(edge.project, edge.source, edge.target, edge.type)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  labelCounts(project?: string): readonly LabelCount[] {
    const db = this.requireDb()
    const rows = project === undefined
      ? db.prepare('SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC').all() as Record<string, unknown>[]
      : db.prepare('SELECT label, COUNT(*) AS count FROM nodes WHERE project = ? GROUP BY label ORDER BY count DESC').all(project) as Record<string, unknown>[]
    return rows.map(row => ({ label: row.label as string, count: row.count as number }))
  }

  edgeTypeCounts(project?: string): readonly EdgeTypeCount[] {
    const db = this.requireDb()
    const rows = project === undefined
      ? db.prepare('SELECT type, COUNT(*) AS count FROM edges GROUP BY type ORDER BY count DESC').all() as Record<string, unknown>[]
      : db.prepare('SELECT type, COUNT(*) AS count FROM edges WHERE project = ? GROUP BY type ORDER BY count DESC').all(project) as Record<string, unknown>[]
    return rows.map(row => ({ type: row.type as string, count: row.count as number }))
  }

  schemaOverview(project?: string): SchemaOverview {
    return {
      projects: this.listProjects(),
      nodeLabels: this.labelCounts(project),
      edgeTypes: this.edgeTypeCounts(project),
    }
  }

  private loadDegrees(project: string): Map<string, { in: number; out: number }> {
    const db = this.requireDb()
    const placeholders = DEGREE_EDGE_TYPES.map(() => '?').join(', ')
    const rows = db.prepare(
      `SELECT source, target FROM edges WHERE project = ? AND type IN (${placeholders})`,
    ).all(project, ...DEGREE_EDGE_TYPES) as Record<string, unknown>[]
    const degrees = new Map<string, { in: number; out: number }>()
    const bump = (id: string): { in: number; out: number } => {
      const entry = degrees.get(id)
      if (entry !== undefined) return entry
      const fresh = { in: 0, out: 0 }
      degrees.set(id, fresh)
      return fresh
    }
    for (const row of rows) {
      bump(row.source as string).out += 1
      bump(row.target as string).in += 1
    }
    return degrees
  }

  private static degreeOk(degrees: Map<string, { in: number; out: number }>, id: string, min: number | undefined, max: number | undefined): boolean {
    const entry = degrees.get(id)
    const total = entry === undefined ? 0 : entry.in + entry.out
    if (min !== undefined && total < min) return false
    if (max !== undefined && total > max) return false
    return true
  }

  private filterRows(rows: readonly GraphNode[], degrees: Map<string, { in: number; out: number }>, options: SearchOptions): GraphNode[] {
    const nameRegex = options.namePattern === undefined ? undefined : new RegExp(options.namePattern, 'u')
    const fileRegex = options.filePattern === undefined ? undefined : new RegExp(options.filePattern, 'u')
    const filtered: GraphNode[] = []
    for (const node of rows) {
      if (options.label !== undefined && node.label !== options.label) continue
      if (nameRegex !== undefined && !nameRegex.test(node.name)) continue
      if (fileRegex !== undefined && (node.filePath === undefined || !fileRegex.test(node.filePath))) continue
      if (!CodebaseStore.degreeOk(degrees, node.id, options.minDegree, options.maxDegree)) continue
      filtered.push(node)
    }
    return filtered
  }

  /**
   * Search nodes. When `query` is provided, results come from the FTS5 BM25
   * index (ranked, label-boosted, noise labels filtered) and structural
   * filters are applied as post-filters preserving rank order; otherwise the
   * structural filters run over the project's nodes directly.
   */
  search(options: SearchOptions): StoreQueryResult {
    const db = this.requireDb()
    const limit = Math.max(1, options.limit ?? 50)
    const offset = Math.max(0, options.offset ?? 0)
    const degrees = this.loadDegrees(options.project)

    let rows: GraphNode[]
    if (options.query !== undefined && options.query.trim().length > 0) {
      const noiseLabels = BM25_NOISE_LABELS.map(() => '?').join(', ')
      const ftsRows = db.prepare(`
        SELECT node_fts.node_id AS node_id, (bm25(node_fts) - CASE n.label
          ${Object.entries(BM25_LABEL_BOOST).map(([label]) => `WHEN '${label}' THEN ${boostForLabel(label)}`).join('\n')}
          ELSE 0 END) AS score
        FROM node_fts
        JOIN nodes n ON n.id = node_fts.node_id
        WHERE node_fts MATCH ? AND node_fts.project = ? AND n.label NOT IN (${noiseLabels})
        ORDER BY score, node_fts.node_id
      `).all(buildFtsMatch(options.query), options.project, ...BM25_NOISE_LABELS) as Record<string, unknown>[]
      const byId = new Map<string, GraphNode>()
      const placeholders = ftsRows.length === 0 ? "''" : ftsRows.map(() => '?').join(', ')
      const nodeRows = ftsRows.length === 0
        ? []
        : db.prepare(`SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json FROM nodes WHERE id IN (${placeholders})`)
          .all(...ftsRows.map(row => row.node_id as string)) as unknown as NodeRow[]
      for (const row of nodeRows) {
        byId.set(row.id, rowToNode(row))
      }
      rows = []
      for (const ftsRow of ftsRows) {
        const node = byId.get(ftsRow.node_id as string)
        if (node !== undefined) rows.push(node)
      }
    } else {
      const nodeRows = db.prepare('SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json FROM nodes WHERE project = ?')
        .all(options.project) as unknown as NodeRow[]
      rows = nodeRows.map(rowToNode)
    }

    const filtered = this.filterRows(rows, degrees, options)
    const total = filtered.length
    const page = filtered.slice(offset, offset + limit)
    return { rows: page, total, hasMore: offset + page.length < total }
  }

  /** Direct edge access for callers that need raw adjacency (trace prep). */
  edgesOf(project: string): readonly GraphEdge[] {
    const db = this.requireDb()
    const rows = db.prepare('SELECT project, source, target, type FROM edges WHERE project = ?').all(project) as Record<string, unknown>[]
    return rows.map(row => ({ project: row.project as string, source: row.source as string, target: row.target as string, type: row.type as EdgeType }))
  }

  /** File nodes of a project (structural index surface for disk reads). */
  listFileNodes(project: string): readonly GraphNode[] {
    const db = this.requireDb()
    const rows = db.prepare('SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json FROM nodes WHERE project = ? AND label = ?')
      .all(project, 'File') as unknown as NodeRow[]
    return rows.map(rowToNode)
  }

  /** Maps node id → file_path for every node carrying one (O(1) resolve). */
  indexNodePaths(project: string): ReadonlyMap<string, string> {
    const db = this.requireDb()
    const rows = db.prepare('SELECT id, file_path FROM nodes WHERE project = ? AND file_path IS NOT NULL').all(project) as Record<string, unknown>[]
    const map = new Map<string, string>()
    for (const row of rows) map.set(row.id as string, row.file_path as string)
    return map
  }

  /** Every node of a project (summary fields for compare/other consumers). */
  allNodes(project: string): readonly GraphNode[] {
    const db = this.requireDb()
    const rows = db.prepare('SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json FROM nodes WHERE project = ?')
      .all(project) as unknown as NodeRow[]
    return rows.map(rowToNode)
  }

  /** The most recent `last_indexed_at` for a project (mtime baseline). */
  lastIndexedAt(project: string): string | undefined {
    const db = this.requireDb()
    const row = db.prepare('SELECT last_indexed_at FROM projects WHERE name = ?').get(project) as { last_indexed_at: string | null } | undefined
    return row === undefined || row.last_indexed_at === null ? undefined : row.last_indexed_at
  }

  /**
   * Exact qualified-name lookup over symbol nodes (the `name` column holds the
   * QN for symbols; File/Folder nodes carry path-shaped names and are
   * excluded). Returns the first match deterministically (label ascending).
   */
  findNodeByQn(project: string, qn: string): GraphNode | undefined {
    const db = this.requireDb()
    const placeholders = SYMBOL_LABELS.map(() => '?').join(', ')
    const rows = db.prepare(`SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json
      FROM nodes WHERE project = ? AND name = ? AND label IN (${placeholders}) ORDER BY label, id`)
      .all(project, qn, ...SYMBOL_LABELS) as unknown as NodeRow[]
    return rows.length === 0 ? undefined : rowToNode(rows[0] as NodeRow)
  }

  /**
   * Segment-boundary suffix lookup: `store.upsertNodes` matches QNs equal to
   * `qn` or ending with `.<qn>` (the snippet tool's disambiguation surface —
   * never a mid-segment substring).
   */
  findNodesByQnSuffix(project: string, qn: string): readonly GraphNode[] {
    const db = this.requireDb()
    const placeholders = SYMBOL_LABELS.map(() => '?').join(', ')
    const rows = db.prepare(`SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json
      FROM nodes WHERE project = ? AND label IN (${placeholders})`)
      .all(project, ...SYMBOL_LABELS) as unknown as NodeRow[]
    const suffix = `.${qn}`
    return rows
      .filter(row => row.name === qn || row.name.endsWith(suffix))
      .map(row => rowToNode(row))
  }

  /**
   * File outline: symbol nodes of a file ordered by start line (ascending),
   * paginated with the total/hasMore contract. Non-symbol nodes of the file
   * (none today) would be excluded by the label filter.
   */
  fileOutline(project: string, filePath: string, options: FileOutlineOptions = {}): StoreQueryResult {
    const db = this.requireDb()
    const labels = options.labels ?? SYMBOL_LABELS
    if (labels.length === 0) return { rows: [], total: 0, hasMore: false }
    const placeholders = labels.map(() => '?').join(', ')
    const rows = db.prepare(`SELECT id, project, label, name, file_path, language, lines, size_bytes, props_json
      FROM nodes WHERE project = ? AND file_path = ? AND label IN (${placeholders})`)
      .all(project, filePath, ...labels) as unknown as NodeRow[]
    const sorted = rows
      .map(row => rowToNode(row))
      .sort((a, b) => (Number(a.props?.startLine ?? 0) - Number(b.props?.startLine ?? 0))
        || (Number(a.props?.endLine ?? 0) - Number(b.props?.endLine ?? 0))
        || a.name.localeCompare(b.name))
    const limit = Math.max(1, options.limit ?? 100)
    const offset = Math.max(0, options.offset ?? 0)
    const page = sorted.slice(offset, offset + limit)
    return { rows: page, total: sorted.length, hasMore: offset + page.length < sorted.length }
  }

  /**
   * EP-CB3: edges filtered to the given edge types (the Cypher executor and
   * watcher load adjacency subsets rather than the full edge table).
   */
  edgesByType(project: string, types: readonly string[]): readonly GraphEdge[] {
    const db = this.requireDb()
    if (types.length === 0) return []
    const placeholders = types.map(() => '?').join(', ')
    const rows = db.prepare('SELECT project, source, target, type FROM edges WHERE project = ? AND type IN (' + placeholders + ')')
      .all(project, ...types) as Record<string, unknown>[]
    return rows.map(row => ({ project: row.project as string, source: row.source as string, target: row.target as string, type: row.type as EdgeType }))
  }

  /**
   * EP-CB3: all edges of a project as raw {source,target,type} adjacency
   * (watcher/executor bulk-consumption surface; same data as edgesOf).
   */
  edgesByProject(project: string): readonly GraphEdge[] {
    return this.edgesOf(project)
  }

  /**
   * EP-CB3: upvote trace records for a project (idempotent on (project,trace_id)
   * primary key). Exposes the metadata bag as the `props` record.
   */
  upsertTraces(traces: readonly TraceRecord[]): void {
    const db = this.requireDb()
    if (traces.length === 0) return
    db.exec('BEGIN')
    try {
      const upsert = db.prepare(`
        INSERT INTO traces (project, trace_id, name, agent, timestamp, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project, trace_id) DO UPDATE SET
          name = excluded.name,
          agent = excluded.agent,
          timestamp = excluded.timestamp,
          metadata_json = excluded.metadata_json
      `)
      for (const trace of traces) {
        upsert.run(trace.project, trace.trace_id, trace.name, trace.agent ?? null, trace.timestamp ?? null, trace.metadata === undefined ? null : JSON.stringify(trace.metadata))
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** EP-CB3: most recent trace records of a project, newest first. */
  queryTraces(project: string, limit = 50): readonly TraceRecord[] {
    const db = this.requireDb()
    const rows = db.prepare('SELECT project, trace_id, name, agent, timestamp, metadata_json FROM traces WHERE project = ? ORDER BY COALESCE(timestamp, trace_id) DESC LIMIT ?')
      .all(project, Math.max(1, limit)) as Record<string, unknown>[]
    return rows.map(row => {
      const record: TraceRecord = {
        project: row.project as string,
        trace_id: row.trace_id as string,
        name: row.name as string,
        ...(row.agent === null ? {} : { agent: row.agent as string }),
        ...(row.timestamp === null ? {} : { timestamp: row.timestamp as string }),
        ...(row.metadata_json === null ? {} : { metadata: JSON.parse(row.metadata_json as string) as Record<string, string | number | boolean> }),
      }
      return record
    })
  }

  /**
   * EP-CB3: delete the nodes of the given file paths (File nodes plus their
   * symbol children) and any edge touching them, plus FTS rows. Used by the
   * watcher when a file disappears.
   */
  subtractNodesForFiles(project: string, filePaths: readonly string[]): number {
    const db = this.requireDb()
    if (filePaths.length === 0) return 0
    const ids = db.prepare('SELECT id FROM nodes WHERE project = ? AND file_path IN (' + filePaths.map(() => '?').join(', ') + ')')
      .all(project, ...filePaths) as Record<string, unknown>[]
    const nodeIds = ids.map(row => row.id as string)
    if (nodeIds.length === 0) return 0
    const placeholders = nodeIds.map(() => '?').join(', ')
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM edges WHERE project = ? AND (source IN (' + placeholders + ') OR target IN (' + placeholders + '))')
        .run(project, ...nodeIds, ...nodeIds)
      db.prepare('DELETE FROM node_fts WHERE node_id IN (' + placeholders + ')').run(...nodeIds)
      db.prepare('DELETE FROM nodes WHERE id IN (' + placeholders + ')').run(...nodeIds)
      db.exec('COMMIT')
      return nodeIds.length
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
