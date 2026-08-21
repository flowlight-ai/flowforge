/**
 * catalog-loaders — 默认生态目录 JSON loaders（T5.8.1）。
 *
 * 移植 clowder-ai `marketplace/catalog-loaders.ts`。目录 JSON 随包发布
 * （`src/marketplace/catalog-data/*.json`），经 `import.meta.url` 定位，
 * 适配器选项注入（R13 一切皆插件改造：调用方可在选项层替换 loader）。
 *
 * @module @flowforge/chat-misc/marketplace
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AntigravityCatalogEntry } from './adapters/antigravity-adapter.ts'
import type { ClaudeCatalogEntry } from './adapters/claude-adapter.ts'
import type { CodexCatalogEntry } from './adapters/codex-adapter.ts'
import type { OpenClawCatalogEntry } from './adapters/openclaw-adapter.ts'

const thisDir = dirname(fileURLToPath(import.meta.url))
const catalogDir = join(thisDir, 'catalog-data')

async function loadJSON<T>(filename: string): Promise<T[]> {
  const raw = await readFile(join(catalogDir, filename), 'utf-8')
  return JSON.parse(raw) as T[]
}

export function loadClaudeCatalog(): Promise<ClaudeCatalogEntry[]> {
  return loadJSON<ClaudeCatalogEntry>('claude.json')
}

export function loadCodexCatalog(): Promise<CodexCatalogEntry[]> {
  return loadJSON<CodexCatalogEntry>('codex.json')
}

export function loadOpenClawCatalog(): Promise<OpenClawCatalogEntry[]> {
  return loadJSON<OpenClawCatalogEntry>('openclaw.json')
}

export function loadAntigravityCatalog(): Promise<AntigravityCatalogEntry[]> {
  return loadJSON<AntigravityCatalogEntry>('antigravity.json')
}
