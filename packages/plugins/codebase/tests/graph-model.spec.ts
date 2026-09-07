/**
 * Contract suite: knowledge-graph domain model (EP-CB0, T1.10).
 *
 * Pins the ported C semantics: the exact node-label / edge-type vocabularies,
 * structural vs complexity label families, BM25 boost weights and the
 * noise-label filter (Module deliberately retained — C #518/#519).
 */

import { describe, expect, it } from 'vitest'
import {
  BM25_LABEL_BOOST,
  BM25_NOISE_LABELS,
  COMPLEXITY_LABELS,
  EDGE_TYPES,
  NODE_LABELS,
  STRUCTURAL_LABELS,
  SYMBOL_LABELS,
  isEdgeType,
  isNodeLabel,
} from '../src/index.ts'

describe('NODE_LABELS / EDGE_TYPES（C 词表契约）', () => {
  it('carries the full node label vocabulary from the C graph model', () => {
    expect(NODE_LABELS).toEqual([
      'Project',
      'Folder',
      'File',
      'Module',
      'Function',
      'Method',
      'Class',
      'Interface',
      'Enum',
      'Type',
      'Field',
      'Route',
      'Variable',
      'Resource',
      'Channel',
    ])
  })

  it('carries the full edge type vocabulary from the C graph model', () => {
    expect(EDGE_TYPES).toEqual([
      'DEFINES',
      'DEFINES_METHOD',
      'CALLS',
      'USAGE',
      'CALL_REFERENCE',
      'INHERITS',
      'IMPLEMENTS',
      'CONTAINS_FOLDER',
      'CONTAINS_FILE',
      'IMPORTS',
      'CROSS_HTTP_CALLS',
      'CROSS_ASYNC_CALLS',
      'CROSS_CHANNEL',
    ])
  })

  it('guards label and edge type membership', () => {
    expect(isNodeLabel('Function')).toBe(true)
    expect(isNodeLabel('Function'.toLowerCase())).toBe(false)
    expect(isEdgeType('CALLS')).toBe(true)
    expect(isEdgeType('CONTAINS')).toBe(false)
    expect(NODE_LABELS.every(label => isNodeLabel(label))).toBe(true)
    expect(EDGE_TYPES.every(type => isEdgeType(type))).toBe(true)
  })

  it('splits structural from complexity-bearing labels', () => {
    expect(STRUCTURAL_LABELS).toEqual(['Project', 'Folder', 'File', 'Module'])
    expect(COMPLEXITY_LABELS).toEqual(['Function', 'Method'])
    for (const label of COMPLEXITY_LABELS) expect(isNodeLabel(label)).toBe(true)
    for (const label of STRUCTURAL_LABELS) expect(isNodeLabel(label)).toBe(true)
  })

  it('declares the symbol-label family populated by the EP-CB1 pipeline', () => {
    expect(SYMBOL_LABELS).toEqual(['Function', 'Method', 'Class', 'Interface', 'Enum', 'Type', 'Variable'])
    for (const label of SYMBOL_LABELS) {
      expect(isNodeLabel(label)).toBe(true)
      expect(STRUCTURAL_LABELS).not.toContain(label)
    }
  })
})

describe('BM25 ranking contract（C search_graph 权重照搬）', () => {
  it('boosts callables highest, routes next, type-like labels last', () => {
    expect(BM25_LABEL_BOOST).toEqual({
      Function: 10,
      Method: 10,
      Route: 8,
      Class: 5,
      Interface: 5,
    })
  })

  it('filters File/Folder/Variable/Project as noise but keeps Module (C #518/#519)', () => {
    expect(BM25_NOISE_LABELS).toEqual(['File', 'Folder', 'Variable', 'Project'])
    expect(BM25_NOISE_LABELS).not.toContain('Module')
    for (const label of BM25_NOISE_LABELS) expect(isNodeLabel(label)).toBe(true)
  })

  it('never filters a boosted label out of the ranking', () => {
    for (const label of Object.keys(BM25_LABEL_BOOST)) {
      expect(BM25_NOISE_LABELS).not.toContain(label)
    }
  })
})
