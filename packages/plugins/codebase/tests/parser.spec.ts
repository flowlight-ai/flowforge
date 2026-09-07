/**
 * Parser integration suite (EP-CB1, T2.1) — real web-tree-sitter WASM
 * grammars, zero mocks (test ironclad rule T1–T9).
 *
 * Pins: TS/TSX/JS real parses produce a program root without errors,
 * unsupported languages return undefined, the factory is a process-level
 * singleton, and the supported-language vocabulary stays pinned.
 */

import { describe, expect, it } from 'vitest'
import { SUPPORTED_SYMBOL_LANGUAGES, createCodebaseParser } from '../src/index.ts'

describe('createCodebaseParser（web-tree-sitter WASM 集成）', () => {
  it('parses TS/TSX/JS sources into a program root with hasError=false', async () => {
    const parser = await createCodebaseParser()
    const tsTree = parser.parseFile('export function foo(a: number): number { return a + 1 }', 'ts')
    expect(tsTree?.rootNode.type).toBe('program')
    expect(tsTree?.rootNode.hasError).toBe(false)
    expect(tsTree?.rootNode.namedChild(0)?.type).toBe('export_statement')
    const tsxTree = parser.parseFile('const x = <div className="a">hi</div>', 'tsx')
    expect(tsxTree?.rootNode.type).toBe('program')
    expect(tsxTree?.rootNode.hasError).toBe(false)
    const jsTree = parser.parseFile('const f = () => { return 1 }', 'js')
    expect(jsTree?.rootNode.type).toBe('program')
    expect(jsTree?.rootNode.hasError).toBe(false)
    const mjsTree = parser.parseFile('export const one = 1', 'mjs')
    expect(mjsTree?.rootNode.hasError).toBe(false)
    const cjsTree = parser.parseFile('module.exports = {}', 'cjs')
    expect(cjsTree?.rootNode.hasError).toBe(false)
  })

  it('returns undefined for unknown languages via parseFile and parserFor', async () => {
    const parser = await createCodebaseParser()
    expect(parser.parseFile('def f(): pass', 'py')).toBeUndefined()
    expect(parser.parseFile('SELECT 1', 'sql')).toBeUndefined()
    expect(parser.parserFor('py')).toBeUndefined()
    expect(parser.parserFor('')).toBeUndefined()
  })

  it('reuses the process-level singleton across factory calls', async () => {
    const first = await createCodebaseParser()
    const second = await createCodebaseParser()
    expect(second).toBe(first)
    expect(second.parseFile('const x = 1', 'js')?.rootNode.hasError).toBe(false)
  })

  it('pins the supported symbol language vocabulary', () => {
    expect(SUPPORTED_SYMBOL_LANGUAGES).toEqual(['ts', 'tsx', 'js', 'mjs', 'cjs'])
  })
})
