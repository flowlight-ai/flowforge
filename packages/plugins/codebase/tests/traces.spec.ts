/**
 * trace ingestion suite (EP-CB3, T4.4) — ingestTraces/queryTraces over a real
 * temp-dir store (T1-T9).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, ingestTraces, queryTraces, ProjectNotFoundError } from '../src/index.ts'

const PROJECT = 'demo'
let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-traces-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject(PROJECT)
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('ingestTraces / queryTraces', () => {
  it('persists ingested traces and returns the count written', () => {
    const result = ingestTraces(store, {
      project: PROJECT,
      traces: [
        { project: PROJECT, trace_id: 't-1', name: 'index' },
        { project: PROJECT, trace_id: 't-2', name: 'query' },
      ],
    })
    expect(result.ingested).toBe(2)
    expect(queryTraces(store, PROJECT).map(trace => trace.trace_id)).toEqual(['t-2', 't-1'])
  })

  it('queries the most recent N traces newest-first within a limit', () => {
    ingestTraces(store, {
      project: PROJECT,
      traces: Array.from({ length: 5 }, (_, index) => ({
        project: PROJECT,
        trace_id: `t-${index}`,
        name: `step-${index}`,
        timestamp: `2026-09-07T0${index}:00:00Z`,
      })),
    })
    const recent = queryTraces(store, PROJECT, 2)
    expect(recent).toHaveLength(2)
    expect(recent[0]?.trace_id).toBe('t-4')
    expect(recent[1]?.trace_id).toBe('t-3')
  })

  it('overwrites records with the same trace_id (idempotent upsert)', () => {
    ingestTraces(store, { project: PROJECT, traces: [{ project: PROJECT, trace_id: 't-1', name: 'first' }] })
    ingestTraces(store, { project: PROJECT, traces: [{ project: PROJECT, trace_id: 't-1', name: 'second' }] })
    const traces = queryTraces(store, PROJECT)
    expect(traces).toHaveLength(1)
    expect(traces[0]?.name).toBe('second')
  })

  it('round-trips the metadata bag', () => {
    ingestTraces(store, {
      project: PROJECT,
      traces: [{ project: PROJECT, trace_id: 't-9', name: 'index', metadata: { files: 12, delta: true } }],
    })
    expect(queryTraces(store, PROJECT)[0]?.metadata).toEqual({ files: 12, delta: true })
  })

  it('raises ProjectNotFoundError for an unknown project', () => {
    expect(() => ingestTraces(store, { project: 'ghost', traces: [{ project: 'ghost', trace_id: 't', name: 'x' }] })).toThrow(ProjectNotFoundError)
  })
})