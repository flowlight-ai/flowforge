import { describe, expect, it } from 'vitest'
import { dynamicCordisContext, cordisViewKey } from '../src/guard.ts'
import type { DynamicCordisGuardEnv, DynamicCordisSlotLedgerRow } from '../src/guard.ts'
import { createMemoryServiceHost } from '../src/ports/service-host.ts'
import { createMemoryClientSlots } from '../src/ports/slots.ts'
import type { DynamicCordisPackage } from '../src/types.ts'

const pkg: DynamicCordisPackage = {
  pluginId: 'p1',
  packageId: 'p1@v1',
  pluginRunId: 'p1#1',
  name: 'p1',
}

function makeGuard({ maySlot = 'slot-a' }: { maySlot?: string } = {}) {
  const host = createMemoryServiceHost()
  const slots = createMemoryClientSlots()
  slots.declare(maySlot, { kind: 'list', scope: 'root' })
  host.provide('slots', slots)
  host.setDeclaredServices(['slots', 'theme'])
  const ledger: DynamicCordisSlotLedgerRow[] = []
  const failures: string[] = []
  const claims: number[] = []
  const env: DynamicCordisGuardEnv = {
    pkg,
    ledger,
    claim: (_c) => { claims.push(1) },
    allocatePriority: () => 7,
    reportFailure: (error) => { failures.push(error.message) },
    bindCordisViewKey: () => cordisViewKey(pkg.pluginId, pkg.packageId),
  }
  const ctx = dynamicCordisContext(host, env) as unknown as {
    get(name: string): unknown
    slots: { register(options: object, component?: unknown): unknown }
    theme?: { overrideTokens(src: unknown, tokens: unknown): unknown }
    effect(fn: () => void): void
    provide(name: string, value: unknown): unknown
  }
  return { host, slots, ledger, failures, claims, ctx }
}

describe('dynamicCordisContext (guard facade)', () => {
  it('gives structured reads for declared services', () => {
    const { ctx, slots } = makeGuard()
    ctx.slots.register({ name: 'slot-a' }, { render: 'x' })
    expect(slots.entries('slot-a')).toHaveLength(1)
  })

  it('records ledger rows and assigns a shadowing priority for non-chain slots', () => {
    const { ctx, ledger, failures } = makeGuard()
    ctx.slots.register({ name: 'slot-a' }, { v: 1 })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].slot).toBe('slot-a')
    expect(ledger[0].priority).toBe(7)
    expect(failures).toHaveLength(0)
  })

  it('rejects registrations without a string name', () => {
    const { ctx, failures } = makeGuard()
    // slots.register is a Proxy get; calling without an object name rejects.
    expect(() => (ctx.slots as unknown as { register(o: unknown, c?: unknown): unknown }).register(null, {}))
      .toThrow(/options object with a `name`/)
    expect(failures.some(f => f.includes('name'))).toBe(true)
  })

  it('denies reads of undeclared services', () => {
    const { ctx, failures } = makeGuard()
    // 'secret' is not provided and not declared → denied read
    expect(() => (ctx as unknown as { secret: unknown }).secret).toThrow(/does not expose/)
    expect(failures.some(f => f.includes('does not expose'))).toBe(true)
  })

  it('denies assignments (read-only facade)', () => {
    const { ctx, failures } = makeGuard()
    expect(() => {
      ;(ctx as unknown as Record<string, unknown>).anything = 1
    }).toThrow(/read-only/)
    expect(failures.some(f => f.includes('read-only'))).toBe(true)
  })

  it('binds tool.view.cordis "self" registrations to the package key', () => {
    const { ctx, slots } = makeGuard({ maySlot: 'tool.view.cordis' })
    slots.declare('tool.view.cordis', { kind: 'keyed', scope: 'session' })
    ctx.slots.register({ name: 'tool.view.cordis', key: 'self' }, { v: 1 })
    const entry = slots.entries('tool.view.cordis')[0]
    expect(entry.options.key).toBe('p1.p1@v1')
  })

  it('exposes the timer helpers only when `timer` is declared', () => {
    const { ctx, failures } = makeGuard()
    expect(() => (ctx as unknown as { timeout(): void }).timeout()).toThrow()
    expect(failures.some(f => f.includes('timer'))).toBe(true)
  })

  it('lets registerEffect and provide pass through to the real host', () => {
    const { ctx, host } = makeGuard()
    let cleaned = 0
    ;(ctx as unknown as { registerEffect(fn: () => void, label?: string): () => void })
      .registerEffect(() => { cleaned += 1 }, 'ctx.effect()')
    expect(cleaned).toBe(0)
    host.disposeEffects()
    expect(cleaned).toBe(1)
  })

  it('exposes a provided theme service and routes access through the facade', () => {
    const { host, ctx } = makeGuard()
    let overridden: string | undefined
    const theme = {
      overrideTokens(source: string, tokens: unknown) {
        overridden = `${source}/${typeof tokens}`
        return () => {}
      },
    }
    host.provide('theme', theme)
    // theme is declared, so reading it returns the guarded theme proxy whose
    // overrideTokens forces `source` to the package business-view key.
    const guarded = (ctx as unknown as { theme: { overrideTokens(s: string, t: unknown): () => void } }).theme
    expect(typeof guarded.overrideTokens).toBe('function')
    guarded.overrideTokens('ignored', { color: 'red' })
    expect(overridden).toBe('p1.p1@v1/object')
  })
})