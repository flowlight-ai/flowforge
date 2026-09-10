import { describe, it, expect } from 'vitest'
import {
  cloneSnapshot,
  compareSnapshots,
  createSnapshot,
  replaySnapshot,
  snapshotEqual,
} from '../src/index.ts'

const ENTRIES = [
  { id: 'm1', turn: 0, role: 'user', content: 'ping' },
  { id: 'm2', turn: 0, role: 'assistant', content: 'pong' },
] as const

/** Build a snapshot with a stable timestamp so metadata can not skew comparison. */
function build(source = 'fixture'): ReturnType<typeof createSnapshot> {
  return createSnapshot(source, [...ENTRIES], '2026-01-01T00:00:00.000Z')
}

/** Build a snapshot whose second entry's content is `overridden`. */
function buildWith(content: string): ReturnType<typeof createSnapshot> {
  return createSnapshot('fixture', [{ ...ENTRIES[0]! }, { ...ENTRIES[1]!, content }], '2026-01-01T00:00:00.000Z')
}

/** Build a snapshot with a third trailing entry. */
function buildExtra(): ReturnType<typeof createSnapshot> {
  return createSnapshot('fixture', [ ...ENTRIES, { id: 'm3', turn: 1, role: 'assistant', content: 'later' }], '2026-01-01T00:00:00.000Z')
}

describe('createSnapshot', () => {
  it('produces a frozen, structurally-stable snapshot', () => {
    const snapshot = build()
    expect(snapshot.version).toBe(1)
    expect(snapshot.source).toBe('fixture')
    expect(snapshot.entries.map(entry => entry.content)).toEqual(['ping', 'pong'])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.entries)).toBe(true)
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true)
  })

  it('defaults capturedAt to a real ISO timestamp when not supplied', () => {
    const snapshot = createSnapshot('x', [])
    expect(new Date(snapshot.capturedAt).getTime()).not.toBeNaN()
  })
})

describe('snapshotEqual / cloneSnapshot', () => {
  it('considers identical records equal', () => {
    expect(snapshotEqual(build(), build())).toBe(true)
  })

  it('distinguishes a drifted entry field', () => {
    expect(snapshotEqual(build(), buildWith('changed'))).toBe(false)
  })

  it('cloneSnapshot returns a structurally separate but equal record', () => {
    const original = build()
    const copy = cloneSnapshot(original)
    expect(snapshotEqual(original, copy)).toBe(true)
    expect(copy.entries[0]).not.toBe(original.entries[0])
  })
})

describe('compareSnapshots', () => {
  it('reports equal for identical snapshots', () => {
    const diff = compareSnapshots(build(), build())
    expect(diff.equal).toBe(true)
    expect(diff.differences).toEqual([])
  })

  it('reports a field-level mismatch with a path', () => {
    const diff = compareSnapshots(buildWith('pong-changed'), build())
    expect(diff.equal).toBe(false)
    const content = diff.differences.find(d => d.path === 'entries[1].content')
    expect(content).toMatchObject({ index: 1, id: 'm2', actual: 'pong-changed', expected: 'pong' })
  })

  it('flags a length delta as missing entries', () => {
    const diff = compareSnapshots(buildExtra(), build())
    expect(diff.equal).toBe(false)
    expect(diff.differences.some(d => d.path === 'entries[2]' && d.expected === '<missing>')).toBe(true)
  })

  it('honors the injected field comparator', () => {
    const diff = compareSnapshots(buildWith('PONG'), build(), { field: (a, b) =>
      typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b })
    expect(diff.equal).toBe(true)
  })

  it('honors the `only` entry filter', () => {
    // m2 is drifted in `actual`; restricting to m1 excludes it, leaving equality.
    const diff = compareSnapshots(buildWith('drifted'), build(), { only: ['m1'] })
    expect(diff.equal).toBe(true)
  })

  it('reports a version mismatch', () => {
    const other = build()
    const foreignVersion = { ...other, version: 2 as const } as unknown as ReturnType<typeof createSnapshot>
    const diff = compareSnapshots(foreignVersion, build())
    expect(diff.equal).toBe(false)
    expect(diff.differences.some(d => d.path === 'version')).toBe(true)
  })
})

describe('replaySnapshot', () => {
  it('yields every entry in order then signals completion', async () => {
    const seen: string[] = []
    for await (const entry of replaySnapshot(build())) {
      seen.push(entry.content)
    }
    expect(seen).toEqual(['ping', 'pong'])
  })

  it('supports pull-based early termination', async () => {
    const cursor = replaySnapshot(build())
    const first = await cursor.next()
    expect(first.done).toBe(false)
    if (!first.done) expect(first.value.content).toBe('ping')
    // The remaining entries continue to be readable on demand.
    const second = await cursor.next()
    expect(second.done).toBe(false)
    if (!second.done) expect(second.value.content).toBe('pong')
    const done = await cursor.next()
    expect(done.done).toBe(true)
  })
})