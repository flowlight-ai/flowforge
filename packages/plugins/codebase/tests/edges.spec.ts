/**
 * Contract suite: edge extraction (EP-CB1, T2.3).
 *
 * Real wasm parsing (no mocks) against the C semantics pinned in the design
 * doc: the five-level resolution chain (registry.c L1062-1104), weak-member
 * suppression (#592/#606), this/super method calls, heritage edges
 * (extract_ts_bases) and module-level caller attribution.
 */

import { describe, expect, it } from 'vitest'
import { createCodebaseParser } from '../src/index.ts'
import {
  buildRegistry,
  extractEdges,
  fileNodeId,
  resolveCall,
  symbolNodeId,
} from '../src/index.ts'
import type { ImportBinding, NodeRecord } from '../src/index.ts'

const PROJECT = 'demo'
const REL = 'src/store.ts'
const FILE_QN = 'demo.src.store'

function sym(qn: string, label: NodeRecord['label']): NodeRecord {
  return { id: symbolNodeId(PROJECT, qn), project: PROJECT, label, name: qn, filePath: REL }
}

function registryOf(...nodes: NodeRecord[]) {
  return buildRegistry(nodes)
}

async function extract(source: string) {
  const parser = await createCodebaseParser()
  const tree = parser.parseFile(source, 'ts')
  if (tree === undefined) throw new Error('ts 解析失败')
  return { tree, source }
}

describe('resolveCall（registry.c 五级链移植）', () => {
  it('resolves a bare call in the same file via same_module', () => {
    const registry = registryOf(sym(`${FILE_QN}.helper`, 'Function'))
    const res = resolveCall('helper', { fileQn: FILE_QN, imports: [], registry })
    expect(res?.qn).toBe(`${FILE_QN}.helper`)
    expect(res?.strategy).toBe('same_module')
  })

  it('resolves imported symbols and namespace members via import_map', () => {
    const registry = registryOf(
      sym('demo.lib.util.upsertNodes', 'Function'),
      sym('demo.lib.util.merge', 'Function'),
    )
    // named import: local alias → symbol QN (direct hit)
    const named: readonly ImportBinding[] = [{ localName: 'upsert', targetQn: 'demo.lib.util.upsertNodes' }]
    expect(resolveCall('upsert', { fileQn: FILE_QN, imports: named, registry })).toEqual({
      qn: 'demo.lib.util.upsertNodes',
      strategy: 'import_map',
    })
    // namespace import: local name → module QN, callee qualified with a suffix
    const ns: readonly ImportBinding[] = [{ localName: 'Util', targetQn: 'demo.lib.util' }]
    expect(resolveCall('Util.merge', { fileQn: FILE_QN, imports: ns, registry })).toEqual({
      qn: 'demo.lib.util.merge',
      strategy: 'import_map',
    })
  })

  it('resolves a unique cross-file name via unique_name', () => {
    const registry = registryOf(sym('demo.a.one.doWork', 'Function'))
    const res = resolveCall('doWork', { fileQn: 'demo.b.two', imports: [], registry })
    expect(res?.qn).toBe('demo.a.one.doWork')
    expect(res?.strategy).toBe('unique_name')
  })

  it('picks the import-reachable candidate among many via suffix_match', () => {
    const registry = registryOf(
      sym('demo.a.one.render', 'Method'),
      sym('demo.b.two.render', 'Method'),
    )
    const imports: readonly ImportBinding[] = [{ localName: 'r', targetQn: 'demo.a.one.render' }]
    const res = resolveCall('render', { fileQn: FILE_QN, imports, registry })
    expect(res?.strategy).toBe('suffix_match')
    expect(res?.qn).toBe('demo.a.one.render')
  })

  it('suppresses weak strategies for member calls with an unresolved receiver', () => {
    const registry = registryOf(
      sym('demo.a.other.render', 'Method'),
      sym('demo.b.two.test', 'Function'),
    )
    // obj.render() — unique_name is weak for member calls → dropped (#592/#606)
    expect(resolveCall('obj.render', { fileQn: FILE_QN, imports: [], registry, isMethod: true })).toBeUndefined()
    // re.test() against multiple candidates — suffix_match is weak → dropped
    const multi = registryOf(sym('demo.a.other.test', 'Function'), sym('demo.c.three.test', 'Function'))
    expect(resolveCall('re.test', { fileQn: FILE_QN, imports: [], registry: multi, isMethod: true })).toBeUndefined()
    // a bare call keeps the weak strategy (no receiver to reason about)
    expect(resolveCall('obj.render', { fileQn: FILE_QN, imports: [], registry })?.strategy).toBe('unique_name')
  })

  it('resolves this.method() against the enclosing class via same_module', () => {
    const registry = registryOf(
      sym(`${FILE_QN}.Store.save`, 'Method'),
      sym(`${FILE_QN}.Store.run`, 'Method'),
    )
    const res = resolveCall('save', {
      fileQn: FILE_QN,
      classQn: `${FILE_QN}.Store`,
      imports: [],
      registry,
    })
    expect(res?.qn).toBe(`${FILE_QN}.Store.save`)
    expect(res?.strategy).toBe('same_module')
  })
})

describe('extractEdges（pass_calls / heritage 移植）', () => {
  it('emits a CALLS edge with the enclosing function as caller', async () => {
    const { tree, source } = await extract(`export function helper(): void {}

export function run(): void {
  helper()
}`)
    const registry = registryOf(sym(`${FILE_QN}.helper`, 'Function'), sym(`${FILE_QN}.run`, 'Function'))
    const result = extractEdges(tree, source, {
      project: PROJECT,
      relPath: REL,
      fileQn: FILE_QN,
      imports: [],
      registry,
    })
    expect(result.calls).toContainEqual({
      source: symbolNodeId(PROJECT, `${FILE_QN}.run`),
      target: symbolNodeId(PROJECT, `${FILE_QN}.helper`),
      type: 'CALLS',
    })
  })

  it('attributes module-level calls to the file and drops unresolved callees', async () => {
    const { tree, source } = await extract(`helper()
ghost()`)
    const registry = registryOf(sym(`${FILE_QN}.helper`, 'Function'))
    const result = extractEdges(tree, source, {
      project: PROJECT,
      relPath: REL,
      fileQn: FILE_QN,
      imports: [],
      registry,
    })
    expect(result.calls).toEqual([
      { source: fileNodeId(PROJECT, REL), target: symbolNodeId(PROJECT, `${FILE_QN}.helper`), type: 'CALLS' },
    ])
  })

  it('resolves this.save() inside a class method to the class QN', async () => {
    const source = `export class Store {
  save(): void {}
  run(): void {
    this.save()
  }
}`
    const { tree } = await extract(source)
    const registry = registryOf(
      sym(`${FILE_QN}.Store.save`, 'Method'),
      sym(`${FILE_QN}.Store.run`, 'Method'),
    )
    const result = extractEdges(tree, source, {
      project: PROJECT,
      relPath: REL,
      fileQn: FILE_QN,
      imports: [],
      registry,
    })
    expect(result.calls).toContainEqual({
      source: symbolNodeId(PROJECT, `${FILE_QN}.Store.run`),
      target: symbolNodeId(PROJECT, `${FILE_QN}.Store.save`),
      type: 'CALLS',
    })
  })

  it('emits INHERITS and IMPLEMENTS edges from the class heritage', async () => {
    const source = `export class Base {}

export interface Shape {
  area(): number
}

export class Circle extends Base implements Shape {
  area(): number { return 1 }
}`
    const { tree } = await extract(source)
    const registry = registryOf(
      sym(`${FILE_QN}.Circle`, 'Class'),
      sym(`${FILE_QN}.Base`, 'Class'),
      sym(`${FILE_QN}.Shape`, 'Interface'),
    )
    const result = extractEdges(tree, source, {
      project: PROJECT,
      relPath: REL,
      fileQn: FILE_QN,
      imports: [],
      registry,
    })
    expect(result.inherits).toContainEqual({
      source: symbolNodeId(PROJECT, `${FILE_QN}.Circle`),
      target: symbolNodeId(PROJECT, `${FILE_QN}.Base`),
      type: 'INHERITS',
    })
    expect(result.implements).toContainEqual({
      source: symbolNodeId(PROJECT, `${FILE_QN}.Circle`),
      target: symbolNodeId(PROJECT, `${FILE_QN}.Shape`),
      type: 'IMPLEMENTS',
    })
  })

  it('suppresses obj.method() calls that only weakly resolve', async () => {
    const source = `export function render(): void {}

export function run(): void {
  obj.render()
}`
    const { tree } = await extract(source)
    // render lives in ANOTHER file: same-module cannot hit, so the only
    // binding would be the weak unique_name — suppressed for obj.render().
    const registry = registryOf(sym('demo.a.other.render', 'Function'), sym(`${FILE_QN}.run`, 'Function'))
    const result = extractEdges(tree, source, {
      project: PROJECT,
      relPath: REL,
      fileQn: FILE_QN,
      imports: [],
      registry,
    })
    // obj.render() would unique_name-bind demo.src.store.render — suppressed
    expect(result.calls).toEqual([])
  })

  it('emits USAGE edges for same-file module-level variable references', async () => {
    const source = `export const limit = 10

export function read(): number {
  return limit
}`
    const { tree } = await extract(source)
    const registry = registryOf(sym(`${FILE_QN}.limit`, 'Variable'), sym(`${FILE_QN}.read`, 'Function'))
    const result = extractEdges(tree, source, {
      project: PROJECT,
      relPath: REL,
      fileQn: FILE_QN,
      imports: [],
      registry,
    })
    expect(result.usages).toContainEqual({
      source: symbolNodeId(PROJECT, `${FILE_QN}.read`),
      target: symbolNodeId(PROJECT, `${FILE_QN}.limit`),
      type: 'USAGE',
    })
  })
})
