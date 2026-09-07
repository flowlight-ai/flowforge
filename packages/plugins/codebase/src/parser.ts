/**
 * @flowforge/plugin-codebase — web-tree-sitter integration (EP-CB1, T2.1).
 *
 * Decision D-CB1 (operator 2026-09-07): the parser runs on the WASM build
 * (web-tree-sitter) instead of native grammar bindings, so indexing never
 * depends on node-gyp toolchains. One process-level singleton preloads the
 * three grammar assets (TypeScript, TSX, JavaScript) exactly once; every
 * downstream module (symbols / edges / indexer) shares it.
 *
 * The ESM entry of web-tree-sitter is an esbuild shim whose dynamic requires
 * (`fs/promises`) fail under Node ESM, so the CJS build is loaded through
 * `createRequire` — the same integration the EP-CB1 parser probe validated.
 * `Language.load` is the only async boundary; `parser.parse` stays sync.
 *
 * @module @flowforge/plugin-codebase/parser
 */

import { createRequire } from 'node:module'
import type { Language, Parser, Tree } from 'web-tree-sitter'

/**
 * File extensions that flow through the symbol pipeline (D-CB5: TS/TSX/JS
 * first; further languages land on demand in later batches).
 */
export const SUPPORTED_SYMBOL_LANGUAGES: readonly string[] = ['ts', 'tsx', 'js', 'mjs', 'cjs']

/** Language id → prebuilt grammar wasm shipped inside the grammar package. */
const WASM_BY_LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  mjs: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  cjs: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
}

export interface CodebaseParser {
  /** Parse source text; `undefined` when the language is not supported. */
  parseFile(content: string, language: string): Tree | undefined
  /** Raw parser for a supported language id (walk helpers reuse it). */
  parserFor(language: string): Parser | undefined
}

let singleton: Promise<CodebaseParser> | undefined

/**
 * Create (or return the process-level singleton of) the codebase parser with
 * all grammar assets preloaded. Language loads are cached per process.
 */
export function createCodebaseParser(): Promise<CodebaseParser> {
  singleton ??= (async () => {
    const require_ = createRequire(import.meta.url)
    const { Parser, Language } = require_('web-tree-sitter') as typeof import('web-tree-sitter')
    await Parser.init()
    const parsers = new Map<string, Parser>()
    for (const [language, spec] of Object.entries(WASM_BY_LANGUAGE)) {
      if (parsers.has(language)) continue
      const wasmPath = require_.resolve(spec)
      const grammar: Language = await Language.load(wasmPath)
      const parser = new Parser()
      parser.setLanguage(grammar)
      parsers.set(language, parser)
    }
    return {
      parseFile(content: string, language: string): Tree | undefined {
        return parsers.get(language)?.parse(content) ?? undefined
      },
      parserFor(language: string): Parser | undefined {
        return parsers.get(language)
      },
    }
  })()
  return singleton
}
