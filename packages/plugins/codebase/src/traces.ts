/**
 * @flowforge/plugin-codebase — trace ingestion (EP-CB3, T4.4).
 *
 * Ported from codebase-memory-mcp's traces module: external agent traces are
 * recorded into the store (deduped on (project, trace_id)) and queryable. The
 * traces table is kept separate from the graph/BM25 surface — pure ledger data.
 *
 * @module @flowforge/plugin-codebase/traces
 */

import type { CodebaseStore, TraceRecord } from './store.ts'
import { requireProject } from './query.ts'

export interface IngestOptions {
  readonly project: string
  readonly traces: readonly TraceRecord[]
}

export interface IngestResult {
  readonly project: string
  readonly ingested: number
}

/**
 * Ingest trace records for a project (idempotent per trace_id, upsert
 * semantics). Returns the number of records written.
 */
export function ingestTraces(store: CodebaseStore, options: IngestOptions): IngestResult {
  requireProject(store, options.project)
  const normalized = options.traces.map(trace => ({
    project: options.project,
    trace_id: trace.trace_id,
    name: trace.name,
    ...(trace.agent === undefined ? {} : { agent: trace.agent }),
    ...(trace.timestamp === undefined ? {} : { timestamp: trace.timestamp }),
    ...(trace.metadata === undefined ? {} : { metadata: trace.metadata }),
  }))
  store.upsertTraces(normalized)
  return { project: options.project, ingested: options.traces.length }
}

/** Query the most recent N trace records of a project (newest first). */
export function queryTraces(store: CodebaseStore, project: string, limit = 50): readonly TraceRecord[] {
  requireProject(store, project)
  return store.queryTraces(project, limit)
}