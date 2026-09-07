/**
 * Contract suite: symbol extraction (EP-CB1, T2.2b).
 *
 * Real wasm parsing (no mocks) against the C semantics pinned in the design
 * doc: QN rules, walk order, label families, method/enum/variable minting and
 * the DEFINES / DEFINES_METHOD edge material.
 */

import { describe, expect, it } from 'vitest'
import { createCodebaseParser } from '../src/index.ts'
import {
  computeQualifiedName,
  extractSymbols,
  fileNodeId,
  symbolNodeId,
} from '../src/index.ts'

const PROJECT = 'demo'
const REL = 'src/store.ts'

async function extract(source: string, relPath = REL): Promise<ReturnType<typeof extractSymbols>> {
  const parser = await createCodebaseParser()
  const tree = parser.parseFile(source, 'ts')
  if (tree === undefined) throw new Error('ts 解析失败')
  return extractSymbols(tree, source, { project: PROJECT, relPath, language: 'typescript' })
}

function nodeByQn(result: ReturnType<typeof extractSymbols>, qn: string) {
  return result.nodes.find(node => node.name === qn)
}

describe('computeQualifiedName（cbm_fqn_compute 移植）', () => {
  it('joins project, path stem and name with dots', () => {
    expect(computeQualifiedName('demo', 'src/store.ts', 'upsertNodes')).toBe('demo.src.store.upsertNodes')
  })

  it('drops the index stem when a name follows', () => {
    expect(computeQualifiedName('demo', 'src/index.ts', 'run')).toBe('demo.src.run')
  })

  it('keeps dotfile stems (leading dot stripped, no extension split)', () => {
    expect(computeQualifiedName('demo', '.env', 'x')).toBe('demo.env.x')
    expect(computeQualifiedName('demo', 'tools/.meta.ts', 'x')).toBe('demo.tools.meta.x')
  })
})

describe('extractSymbols（walk_defs 移植）', () => {
  it('mints a Function with QN, signature, return type and complexity', async () => {
    const result = await extract(`export function upsertNodes(a: number, b: string): boolean {
  if (a > 0) { return true }
  return false
}`)
    const fn = nodeByQn(result, 'demo.src.store.upsertNodes')
    expect(fn).toBeDefined()
    expect(fn?.label).toBe('Function')
    expect(fn?.lines).toBe(4)
    expect(fn?.props?.signature).toBe('(a: number, b: string)')
    expect(fn?.props?.paramCount).toBe(2)
    expect(fn?.props?.returnType).toBe('boolean')
    expect(fn?.props?.complexity).toBe(1)
    expect(fn?.props?.shortName).toBe('upsertNodes')
  })

  it('mints a Class with Method nodes and DEFINES_METHOD material', async () => {
    const result = await extract(`export class Store {
  private count = 0
  upsert(id: string): void {}
  handleClick = () => { this.count++ }
}`)
    const cls = nodeByQn(result, 'demo.src.store.Store')
    expect(cls?.label).toBe('Class')
    const method = nodeByQn(result, 'demo.src.store.Store.upsert')
    expect(method?.label).toBe('Method')
    expect(method?.props?.parentClass).toBe('demo.src.store.Store')
    // #new_ts_class_field_arrow: class-field arrow function is a Method too.
    const arrowMethod = nodeByQn(result, 'demo.src.store.Store.handleClick')
    expect(arrowMethod?.label).toBe('Method')
    expect(result.methods).toContainEqual({
      source: symbolNodeId(PROJECT, 'demo.src.store.Store'),
      target: symbolNodeId(PROJECT, 'demo.src.store.Store.upsert'),
      type: 'DEFINES_METHOD',
    })
  })

  it('labels interface/enum/type alias nodes and enum members', async () => {
    const result = await extract(`export interface User { id: string }
export enum Color { Red, Green = 2 }
export type ID = string | number`)
    expect(nodeByQn(result, 'demo.src.store.User')?.label).toBe('Interface')
    expect(nodeByQn(result, 'demo.src.store.Color')?.label).toBe('Enum')
    expect(nodeByQn(result, 'demo.src.store.ID')?.label).toBe('Type')
    expect(nodeByQn(result, 'demo.src.store.Color.Red')?.label).toBe('Variable')
    expect(nodeByQn(result, 'demo.src.store.Color.Green')?.label).toBe('Variable')
  })

  it('mints module-level const as Variable and skips function values', async () => {
    const result = await extract(`export const total = 1
const fn = (x: number) => x + 1
const { a, b } = obj`)
    expect(nodeByQn(result, 'demo.src.store.total')?.label).toBe('Variable')
    expect(nodeByQn(result, 'demo.src.store.a')?.label).toBe('Variable')
    expect(nodeByQn(result, 'demo.src.store.b')?.label).toBe('Variable')
    // The arrow is minted by the function path, not the variable path.
    expect(nodeByQn(result, 'demo.src.store.fn')?.label).toBe('Function')
  })

  it('qualifies nested classes and namespaced functions by their enclosing scope', async () => {
    const result = await extract(`namespace Util {
  export function helper(x: number): number { return x }
  namespace Deep {
    export function deepFn(): void {}
  }
}
function outer() {
  class Inner {
    nested(): void {}
  }
  return Inner
}`)
    expect(nodeByQn(result, 'demo.src.store.Util')?.label).toBe('Module')
    expect(nodeByQn(result, 'demo.src.store.Util.helper')?.label).toBe('Function')
    expect(nodeByQn(result, 'demo.src.store.Util.Deep')?.label).toBe('Module')
    expect(nodeByQn(result, 'demo.src.store.Util.Deep.deepFn')?.label).toBe('Function')
    // A class declared inside a free function is file-scoped (enclosing undefined).
    expect(nodeByQn(result, 'demo.src.store.Inner')?.label).toBe('Class')
    expect(nodeByQn(result, 'demo.src.store.Inner.nested')?.label).toBe('Method')
  })

  it('skips anonymous arrows and function expressions without names', async () => {
    const result = await extract(`arr.map(x => x * 2)
export default (() => 1)()
const handler = function () {}`)
    expect(result.nodes.filter(node => node.name === 'demo.src.store.map')).toHaveLength(0)
    expect(result.nodes.filter(node => node.name === 'demo.src.store.handler')).toHaveLength(0)
  })

  it('emits one DEFINES edge per symbol rooted at the file node', async () => {
    const result = await extract(`export const total = 1
export function run(): void {}`)
    const fileId = fileNodeId(PROJECT, REL)
    expect(result.defines).toHaveLength(result.nodes.length)
    for (const edge of result.defines) {
      expect(edge.source).toBe(fileId)
      expect(edge.type).toBe('DEFINES')
    }
    expect(result.defines.map(edge => edge.target)).toContain(symbolNodeId(PROJECT, 'demo.src.store.run'))
  })
})
