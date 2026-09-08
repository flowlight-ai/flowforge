import { describe, expect, it } from 'vitest'
import {
  DynamicCordisStyles,
  evaluateClientHalf,
  isDynamicCordisPlugin,
} from '../src/evaluator.ts'
import { createMemoryStyleDocument } from '../src/ports/style.ts'
import type { DynamicCordisClosureEnv } from '../src/evaluator.ts'

function env(overrides: Partial<DynamicCordisClosureEnv> = {}): DynamicCordisClosureEnv {
  return {
    noteError: () => {},
    invoke: async () => null,
    ...overrides,
  }
}

/** Real memory style document, so tag ownership and disposal are observable. */
function memoryDoc() {
  return createMemoryStyleDocument()
}

describe('isDynamicCordisPlugin', () => {
  it('accepts a function form and an object form with apply', () => {
    expect(isDynamicCordisPlugin(() => {})).toBe(true)
    expect(isDynamicCordisPlugin({ apply: () => {} })).toBe(true)
  })

  it('rejects null, arrays, undefined and objects without apply', () => {
    expect(isDynamicCordisPlugin(null)).toBe(false)
    expect(isDynamicCordisPlugin([])).toBe(false)
    expect(isDynamicCordisPlugin(undefined)).toBe(false)
    expect(isDynamicCordisPlugin({ name: 'x' })).toBe(false)
    expect(isDynamicCordisPlugin(42)).toBe(false)
  })
})

describe('evaluateClientHalf', () => {
  it('evaluates a function-form plugin that closes over the ctx', async () => {
    const doc = memoryDoc()
    const styles = new DynamicCordisStyles(doc, 'p1')
    const plugin = await evaluateClientHalf('p1',
      'return (ctx) => typeof host.call',
      env(), styles)
    expect(typeof plugin).toBe('function')
    const ctx = plugin as unknown as (context: unknown) => unknown
    expect(ctx(undefined)).toBe('function')
  })

  it('returns an object-form plugin and injects React / styles via the closure', async () => {
    const doc = memoryDoc()
    const styles = new DynamicCordisStyles(doc, 'p1')
    const plugin = await evaluateClientHalf('p1',
      // surface: exercise React symbol + host.call + styles.insert through the body
      'styles.insert("body{color:red}"); const applied = host.call("ping", {a:1}); '
      + 'return { name: "browser", inject: ["slots"], apply() { return applied } }',
      env({
        react: { createElement: () => 'el' },
        invoke: async () => 'pong',
      }),
      styles)
    expect(typeof plugin).toBe('object')
    if (typeof plugin === 'object' && plugin !== null && 'apply' in plugin && typeof plugin.apply === 'function') {
      const { apply } = plugin as { apply(...args: unknown[]): unknown }
      expect(await apply(undefined, undefined)).toBe('pong')
    }
    expect(doc.attachedNodes).toHaveLength(1)
    expect(doc.attachedNodes[0].textContent).toBe('body{color:red}')
  })

  it('records console.error lines into the load report through the tagged console', async () => {
    const notes: string[] = []
    const target: Array<{ level: 'log' | 'info' | 'warn' | 'error' | 'debug'; args: unknown[] }> = []
    const capture: Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...a: unknown[]) => void>
      = {
        log: (...a) => target.push({ level: 'log', args: a }),
        info: (...a) => target.push({ level: 'info', args: a }),
        warn: (...a) => target.push({ level: 'warn', args: a }),
        error: (...a) => target.push({ level: 'error', args: a }),
        debug: (...a) => target.push({ level: 'debug', args: a }),
      }
    await evaluateClientHalf('p1',
      'console.error("boom"); console.log("fine"); return () => {}',
      env({ console: capture, noteError: (m) => notes.push(m) }),
      new DynamicCordisStyles(memoryDoc(), 'p1'))
    expect(target.some(t => t.level === 'log')).toBe(true)
    expect(notes.some(n => n.includes('boom'))).toBe(true)
    expect(notes.some(n => n.includes('fine'))).toBe(false)
  })

  it('throws a teaching parse error for invalid syntax', async () => {
    await expect(evaluateClientHalf('p1', 'return (', env(),
      new DynamicCordisStyles(memoryDoc(), 'p1'))).rejects.toThrow(/failed to parse/)
  })

  it('throws a teaching error when the body returns undefined', async () => {
    await expect(evaluateClientHalf('p1', 'return undefined', env(),
      new DynamicCordisStyles(memoryDoc(), 'p1'))).rejects.toThrow(/return.*undefined/)
  })

  it('throws a teaching error when the body returns a non-plugin', async () => {
    await expect(evaluateClientHalf('p1', 'return 42', env(),
      new DynamicCordisStyles(memoryDoc(), 'p1'))).rejects.toThrow(/must .*return.*plugin/)
  })

  it('redirects the shadowed `fetch` global with a teaching trap', async () => {
    await expect(evaluateClientHalf('p1', 'fetch("/x")', env(),
      new DynamicCordisStyles(memoryDoc(), 'p1'))).rejects.toThrow(/network belongs to the HOST half/)
  })

  it('teaches that the `harness` seat is host-side only', async () => {
    await expect(evaluateClientHalf('p1', 'harness.storage(1)', env(),
      new DynamicCordisStyles(memoryDoc(), 'p1'))).rejects.toThrow(/HOST half/)
  })
})

describe('DynamicCordisStyles', () => {
  it('inserts, disposes and reports a live tag count', () => {
    const doc = memoryDoc()
    const styles = new DynamicCordisStyles(doc, 'p1')
    expect(styles.count).toBe(0)
    const a = styles.insert('a{}')
    styles.insert('b{}')
    expect(styles.count).toBe(2)
    a()
    expect(styles.count).toBe(1)
    expect(doc.attachedNodes).toHaveLength(1)
    styles.dispose()
    expect(styles.count).toBe(0)
    expect(doc.attachedNodes).toHaveLength(0)
  })

  it('rejects non-string CSS', () => {
    const doc = memoryDoc()
    const styles = new DynamicCordisStyles(doc, 'p1')
    expect(() => styles.insert(42 as unknown as string)).toThrow(/CSS string/)
  })
})