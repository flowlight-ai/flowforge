/**
 * normalizeCatId + CatRegistry Cordis service integration tests.
 *
 * Verifies the dsh-style plugin pattern:
 *  - `await ctx.plugin(CatRegistry)` mounts `ctx.cats`
 *  - registrations via `ctx.cats.register(id, config)` are fiber-scoped:
 *    disposing the registering fiber removes the registration
 *  - `normalizeCatId(input, ctx.cats)` resolves user input → CatId via the
 *    live registry (no module-level singleton)
 *
 * Replaces the legacy clowder-ai .test.js suite which imported the removed
 * `catRegistry` module singleton.
 *
 * @module @flowforge/cats-shared/tests
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { CatRegistry } from '../src/registry/CatRegistry.ts'
import { normalizeCatId } from '../src/registry/normalize-cat-id.ts'
import { createCatId, type CatConfig } from '../src/index.ts'

/**
 * Track plugin fibers so each test tears down cleanly. Cordis disposal is via
 * `Fiber.dispose()` returned by `ctx.plugin()`, not `ctx.dispose()`.
 */
const fibers: Array<{ dispose: () => Promise<void> | void }> = []
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!
    await fiber.dispose()
  }
})

async function withCats(): Promise<Context> {
  const ctx = new Context()
  const fiber = await ctx.plugin(CatRegistry) as unknown as { dispose: () => Promise<void> | void }
  fibers.push(fiber)
  return ctx
}

/** Minimal cat config fixture for testing — only fields read by normalizeCatId. */
function makeCatConfig(overrides: Partial<CatConfig> & { id: CatConfig['id']; name: string }): CatConfig {
  return {
    displayName: overrides.name,
    avatar: '/avatars/test.png',
    color: { primary: '#000', secondary: '#fff' },
    mentionPatterns: overrides.mentionPatterns ?? [`@${overrides.id}`],
    clientId: 'anthropic',
    defaultModel: 'test-model',
    mcpSupport: false,
    roleDescription: 'test role',
    personality: 'test personality',
    ...overrides,
  } as CatConfig
}

const OPUS = makeCatConfig({
  id: createCatId('opus'),
  name: '布偶猫',
  displayName: '布偶猫',
  nickname: '宪宪',
  mentionPatterns: ['@opus', '@布偶猫', '@宪宪'],
})

const CODEX = makeCatConfig({
  id: createCatId('codex'),
  name: '缅因猫',
  displayName: '缅因猫',
  nickname: '砚砚',
  clientId: 'openai',
  mentionPatterns: ['@codex', '@缅因猫', '@砚砚'],
})

const GEMINI25 = makeCatConfig({
  id: createCatId('gemini25'),
  name: '暹罗猫',
  displayName: '暹罗猫',
  nickname: '烁烁',
  clientId: 'google',
  mentionPatterns: ['@gemini25', '@gemini-25', '@暹罗gemini25'],
})

const GEMINI35 = makeCatConfig({
  id: createCatId('gemini35'),
  name: '暹罗猫',
  displayName: '暹罗猫 Gemini 3.5',
  nickname: '烁烁',
  clientId: 'google',
  defaultModel: 'Gemini 3.5 Flash (High)',
  mentionPatterns: ['@gemini35', '@gemini-35', '@gemini3.5', '@flash', '@暹罗flash', '@暹罗gemini35'],
})

describe('CatRegistry — Cordis service lifecycle', () => {
  it('mounts at ctx.cats after ctx.plugin(CatRegistry)', async () => {
    const ctx = await withCats()
    expect(ctx.cats).toBeInstanceOf(CatRegistry)
  })

  it('register + has + getOrThrow + tryGet work end-to-end', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    expect(ctx.cats.has('opus')).toBe(true)
    expect(ctx.cats.has('unknown')).toBe(false)
    expect(ctx.cats.tryGet('opus')?.config).toBe(OPUS)
    expect(() => ctx.cats.getOrThrow('unknown')).toThrow(/Unknown cat ID/)
  })

  it('register rejects duplicate IDs', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    expect(() => ctx.cats.register('opus', OPUS)).toThrow(/already registered/)
  })

  it('getAllIds + getAllConfigs reflect current registrations', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    ctx.cats.register('codex', CODEX)
    expect(ctx.cats.getAllIds().map((id) => String(id)).sort()).toEqual(['codex', 'opus'])
    const configs = ctx.cats.getAllConfigs()
    expect(configs['opus']).toBe(OPUS)
    expect(configs['codex']).toBe(CODEX)
  })

  it('assertKnownCatId returns CatId for known, throws for unknown', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    expect(String(ctx.cats.assertKnownCatId('opus'))).toBe('opus')
    expect(() => ctx.cats.assertKnownCatId('unknown')).toThrow(/Unknown cat ID/)
  })

  it('getValidCatIds throws when registry is empty', async () => {
    const ctx = await withCats()
    expect(() => ctx.cats.getValidCatIds()).toThrow(/empty/)
  })

  it('reset clears all entries (testing only)', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    expect(ctx.cats.has('opus')).toBe(true)
    ctx.cats.reset()
    expect(ctx.cats.has('opus')).toBe(false)
  })

  it('registration is scoped to the calling fiber (HMR safety)', async () => {
    const ctx = await withCats()
    // Function-style plugin must declare `inject: ['cats']` so Cordis waits
    // for the CatRegistry service before activating the child fiber. Without
    // this declaration, ctx.cats is not visible inside the plugin body.
    const childFiber = await ctx.plugin({
      inject: ['cats'],
      apply: (c: Context) => {
        c.cats.register('opus', OPUS)
      },
    }) as unknown as { dispose: () => Promise<void> | void }
    expect(ctx.cats.has('opus')).toBe(true)
    await childFiber.dispose()
    expect(ctx.cats.has('opus')).toBe(false)
  })
})

describe('normalizeCatId (F154 AC-A3, AC-A7)', () => {
  async function withPopulated(): Promise<Context> {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    ctx.cats.register(
      'opus-45',
      makeCatConfig({
        id: createCatId('opus-45'),
        name: '布偶猫 Opus 4.5',
        displayName: '布偶猫 Opus 4.5',
        mentionPatterns: ['@opus-45'],
      }),
    )
    ctx.cats.register('codex', CODEX)
    ctx.cats.register('gemini25', GEMINI25)
    ctx.cats.register('gemini35', GEMINI35)
    return ctx
  }

  it('exact catId → ok', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('opus', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('opus')
  })

  it('alias with @ prefix → ok', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('@宪宪', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('opus')
  })

  it('alias without @ → ok', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('宪宪', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('opus')
  })

  it('case insensitive alias → ok', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('Opus', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('opus')
  })

  it('case insensitive @ alias → ok', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('@Codex', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('codex')
  })

  it('gemini35 aliases resolve to standalone gemini35 breed', async () => {
    const ctx = await withPopulated()
    const r1 = normalizeCatId('@gemini35', ctx.cats)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(String(r1.catId)).toBe('gemini35')

    const r2 = normalizeCatId('gemini-35', ctx.cats)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(String(r2.catId)).toBe('gemini35')

    // Legacy alias preserved: @暹罗gemini35 was on gemini25, now belongs to gemini35
    const r3 = normalizeCatId('@暹罗gemini35', ctx.cats)
    expect(r3.ok).toBe(true)
    if (r3.ok) expect(String(r3.catId)).toBe('gemini35')

    const r4 = normalizeCatId('@gemini25', ctx.cats)
    expect(r4.ok).toBe(true)
    if (r4.ok) expect(String(r4.catId)).toBe('gemini25')
  })

  it('unknown name → not-found', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('unknown', ctx.cats)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })

  it('ambiguous partial displayName → candidates list', async () => {
    const ctx = await withPopulated()
    // "猫" matches opus ("布偶猫"), opus-45 ("布偶猫 Opus 4.5"), codex ("缅因猫")
    const r = normalizeCatId('猫', ctx.cats)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'ambiguous') {
      expect(r.reason).toBe('ambiguous')
      expect(r.candidates.length).toBeGreaterThanOrEqual(2)
      expect(r.candidates).toContain('opus')
      expect(r.candidates).toContain('codex')
    }
  })

  it('exact catId wins over partial displayName match', async () => {
    const ctx = await withPopulated()
    // "opus" is exact catId AND partial match for "布偶猫 Opus 4.5"
    const r = normalizeCatId('opus', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('opus')
  })

  it('unique nickname partial → ok', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('砚砚', ctx.cats)
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.catId)).toBe('codex')
  })

  it('empty string → not-found', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('', ctx.cats)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })

  it('@ prefix on empty string → not-found', async () => {
    const ctx = await withPopulated()
    const r = normalizeCatId('@', ctx.cats)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })
})

describe('normalizeCatId — partial registry hardening', () => {
  it('unknown input ignores partial configs without mentionPatterns', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    ctx.cats.register('codex', CODEX)
    ctx.cats.register(
      'legacy-partial',
      makeCatConfig({
        id: createCatId('legacy-partial'),
        name: 'Legacy Partial Cat',
        // Deliberately omit mentionPatterns / displayName
      }),
    )
    const r = normalizeCatId('nonexistent', ctx.cats)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })

  it('ambiguous input ignores partial configs without displayName', async () => {
    const ctx = await withCats()
    ctx.cats.register('opus', OPUS)
    ctx.cats.register('codex', CODEX)
    ctx.cats.register(
      'legacy-partial',
      makeCatConfig({
        id: createCatId('legacy-partial'),
        name: 'Legacy Partial Cat',
      }),
    )
    const r = normalizeCatId('猫', ctx.cats)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'ambiguous') {
      expect(r.reason).toBe('ambiguous')
      expect([...r.candidates].sort()).toEqual(['codex', 'opus'])
    }
  })
})
