/**
 * Shared fixture harness for EP-CB2 tool suites: index the real mini-repo
 * fixture into a fresh temp-dir store (zero mocks — the T1-T9 iron rules).
 *
 * @module @flowforge/plugin-codebase/_test-fixture
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach } from 'vitest'
import { CodebaseStore, indexRepository } from '../src/index.ts'

export const MINI_REPO = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mini-repo')
export const PROJECT = 'mini-repo'

export interface IndexedFixture {
  store: CodebaseStore
  dir: string
}

/** Create a temp-dir store, index the mini-repo in full mode, and return it. */
export function setupFixture(): IndexedFixture {
  const dir = mkdtempSync(join(tmpdir(), 'ff-codebase-cb2-'))
  const store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject(PROJECT)
  return { store, dir }
}

/** Standard beforeEach/afterEach lifecycle that indexes the mini-repo. */
export function useMiniRepoFixture(): IndexedFixture {
  const ctx: IndexedFixture = { store: undefined as unknown as CodebaseStore, dir: '' }
  beforeEach(async () => {
    Object.assign(ctx, setupFixture())
    await indexRepository({ repoPath: MINI_REPO, store: ctx.store })
  })
  afterEach(() => {
    ctx.store.dispose()
    rmSync(ctx.dir, { recursive: true, force: true })
  })
  // Tests must read `fixture.store` lazily (the hooks above populate it after module-import time).
  return new Proxy(ctx, {
    get(target, prop) {
      return target[prop as keyof IndexedFixture]
    },
  })
}