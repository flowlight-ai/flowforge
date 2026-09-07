/**
 * @flowforge/plugin-codebase — artifact persistence (EP-CB3, T4.5).
 *
 * Portable, shareable snapshot of a project's graph: dumps the full node/edge/
 * prop set as NDJSON, then compresses it (zstd via the `zstd` CLI when
 * available; gzip fallback otherwise — the format is reported honestly so a
 * consumer never mis-parses). Restore upserts the snapshot into a target store
 * idempotently.
 *
 * Zero external runtime dependencies (T1-T9 + the no-dependency redline).
 *
 * @module @flowforge/plugin-codebase/artifact
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gzipSync, gunzipSync } from 'node:zlib'
import type { CodebaseStore, EdgeRecord, NodeRecord, TraceRecord } from './store.ts'
import { requireProject } from './query.ts'

export interface ArtifactReport {
  readonly project: string
  readonly format: 'zstd' | 'gzip'
  readonly path: string
  readonly nodeCount: number
  readonly edgeCount: number
  readonly traceCount: number
}

export interface DumpOptions {
  readonly store: CodebaseStore
  readonly project: string
  readonly outPath: string
  /** Force a compression format (default: zstd when the CLI exists). */
  readonly format?: 'zstd' | 'gzip'
}

export interface RestoreOptions {
  readonly store: CodebaseStore
  readonly project: string
  readonly inPath: string
}

function zstdAvailable(): boolean {
  try {
    const probe = spawnSync('zstd', ['--version'], { stdio: 'ignore' })
    return probe.status === 0
  } catch {
    return false
  }
}

function compress(data: string, format: 'zstd' | 'gzip'): Buffer {
  if (format === 'gzip') return gzipSync(Buffer.from(data, 'utf8'))
  const input = Buffer.from(data, 'utf8')
  const result = spawnSync('zstd', ['-q', '-o', '-'], { input, stdio: ['pipe', 'pipe', 'ignore'] })
  if (result.status === 0 && result.stdout.length > 0) {
    return Buffer.from(result.stdout)
  }
  // zstd CLI failed at runtime — degrade to gzip (honest fallback).
  return gzipSync(input)
}

function decompress(data: Buffer, format: 'zstd' | 'gzip'): string {
  if (format === 'gzip') return gunzipSync(data).toString('utf8')
  const result = spawnSync('zstd', ['-d', '-q', '-o', '-'], { input: data, stdio: ['pipe', 'pipe', 'ignore'] })
  if (result.status === 0 && result.stdout.length > 0) {
    return Buffer.from(result.stdout).toString('utf8')
  }
  return gunzipSync(data).toString('utf8')
}

function detectFormat(path: string): 'zstd' | 'gzip' {
  const ext = extname(path).toLowerCase()
  if (ext === '.zst') return 'zstd'
  if (ext === '.gz') return 'gzip'
  return 'gzip' // default by signature sniff fallback
}

/**
 * Dump a project's full graph (nodes + edges + traces) to a compressed
 * artifact file. Returns the report with the actual format used.
 */
export function dumpArtifact(options: DumpOptions): ArtifactReport {
  requireProject(options.store, options.project)
  const format: 'zstd' | 'gzip' = options.format ?? (zstdAvailable() ? 'zstd' : 'gzip')
  const nodes = options.store.allNodes(options.project)
  const edges = options.store.edgesOf(options.project)
  const traces = options.store.queryTraces(options.project, 100_000)
  const payload = {
    schemaVersion: 1,
    format,
    project: options.project,
    nodes: nodes.map(node => ({ id: node.id, label: node.label, name: node.name, filePath: node.filePath, language: node.language, lines: node.lines, sizeBytes: node.sizeBytes, props: node.props })),
    edges: edges.map(edge => ({ source: edge.source, target: edge.target, type: edge.type })),
    traces,
  }
  const json = JSON.stringify(payload)
  mkdirSync(dirname(options.outPath), { recursive: true })
  const filePath = format === 'zstd' ? `${options.outPath}.zst` : `${options.outPath}.gz`
  writeFileSync(filePath, compress(json, format))
  return {
    project: options.project,
    format,
    path: filePath,
    nodeCount: payload.nodes.length,
    edgeCount: payload.edges.length,
    traceCount: payload.traces.length,
  }
}

/**
 * Restore an artifact snapshot into the target store. Nodes/edges/traces are
 * upserted idempotently (same ids overwrite; edges dedup by PK).
 */
export function restoreArtifact(options: RestoreOptions): ArtifactReport {
  // Restore registers the target project itself (upsert semantics); the source
  // artifact is the authority, so no requireProject gate applies on entry.
  const format = detectFormat(options.inPath)
  const raw = readFileSync(options.inPath)
  const json = decompress(raw, format)
  const payload = JSON.parse(json) as {
    nodes: Array<{ id: string; label: string; name: string; filePath?: string; language?: string; lines?: number; sizeBytes?: number; props?: Record<string, string | number | boolean> }>
    edges: Array<{ source: string; target: string; type: string }>
    traces: readonly TraceRecord[]
  }
  options.store.registerProject(options.project)
  options.store.upsertNodes(payload.nodes.map(node => ({
    id: node.id, project: options.project, label: node.label as NodeRecord['label'], name: node.name,
    ...(node.filePath === undefined ? {} : { filePath: node.filePath }),
    ...(node.language === undefined ? {} : { language: node.language }),
    ...(node.lines === undefined ? {} : { lines: node.lines }),
    ...(node.sizeBytes === undefined ? {} : { sizeBytes: node.sizeBytes }),
    ...(node.props === undefined ? {} : { props: node.props }),
  })))
  options.store.insertEdges(payload.edges.map(edge => ({
    project: options.project, source: edge.source, target: edge.target, type: edge.type as EdgeRecord['type'],
  })))
  options.store.upsertTraces(payload.traces.map(trace => ({ project: options.project, trace_id: trace.trace_id, name: trace.name, ...(trace.agent === undefined ? {} : { agent: trace.agent }), ...(trace.timestamp === undefined ? {} : { timestamp: trace.timestamp }), ...(trace.metadata === undefined ? {} : { metadata: trace.metadata }) })))
  return {
    project: options.project,
    format,
    path: options.inPath,
    nodeCount: payload.nodes.length,
    edgeCount: payload.edges.length,
    traceCount: payload.traces.length,
  }
}

/** Remove a temporary artifact file (used by tests / cleanup paths). */
export function removeArtifact(path: string): void {
  rmSync(path, { force: true })
}