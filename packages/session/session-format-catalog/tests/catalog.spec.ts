import { describe, expect, it } from 'vitest'
import type { SessionFormatArtifact, SessionFormatEvent } from '@flowforge/session-format'
import { releasedV0SessionFormatCodec } from '@flowforge/session-format-v0-to-v1'
import { sessionFormatCatalog } from '../src/index.ts'

function event(type: string, seq: number, time: number, data: SessionFormatEvent['data']): SessionFormatEvent {
  return { type, seq, time, data }
}

/** One canonical completed v0 turn with an embedded committed assistant stream. */
const v0Logical: SessionFormatArtifact = {
  header: {
    version: 0,
    id: 'full-chain',
    createdAt: 1,
    isSeeded: false,
    delegationDepth: 0,
  },
  inheritedEventCount: 0,
  events: [
    event('turn/start', 0, 100, { turn: 1 }),
    event('step/start', 1, 101, { turn: 1, step: 1 }),
    event('assistant/chunk', 2, 110, {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'hello' },
    }),
    event('assistant/chunk', 3, 120, {
      turn: 1,
      step: 1,
      chunk: { type: 'finish', reason: { kind: 'stop' } },
    }),
    {
      ...event('assistant/message', 4, 121, {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          source: { kind: 'model', provider: 'mock', model: 'mock' },
        },
      }),
      sourceEventSeqs: [2, 3],
      surfaceOp: 'append',
    },
    event('step/end', 5, 122, { turn: 1, step: 1 }),
    event('turn/end', 6, 123, { turn: 1, reason: { kind: 'completed' } }),
  ],
}

const v0Physical = releasedV0SessionFormatCodec.encodeArtifact(v0Logical, { packChunks: false })

describe('Session format catalog', () => {
  it('statically owns the complete adjacent v0 to v2 chain', () => {
    expect(sessionFormatCatalog.currentVersion).toBe(2)
    const result = sessionFormatCatalog.readHeader(v0Physical.header)
    expect(result.status).toBe('migration-required')
    if (result.status !== 'migration-required') throw new Error('expected migration-required')
    expect(result.storedVersion).toBe(0)
    expect(result.targetVersion).toBe(2)
    expect(result.header).toMatchObject({ version: 2, id: 'full-chain', isSeeded: false })
  })

  it('moves one logical v0 artifact through v0->v1->v2, encodes current, and reads it back', () => {
    const decoded = sessionFormatCatalog.decodeArtifact(v0Physical.header, v0Physical.rows)
    expect(decoded.header.version).toBe(0)

    const migrated = sessionFormatCatalog.migrate(decoded)
    expect(migrated.header.version).toBe(2)
    const folded = migrated.events.find(candidate => candidate.type === 'assistant/message' || candidate.type === 'assistant/attempt')
    expect(folded?.type).toBe('assistant/message')
    if (folded?.type !== 'assistant/message') throw new Error('expected folded assistant/message')
    const stream = folded.data['stream'] as readonly Record<string, unknown>[]
    expect(stream[0]).toMatchObject({ type: 'text-chunks', texts: ['hello'] })
    expect(stream[1]).toMatchObject({ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } })

    const encoded = sessionFormatCatalog.encodeCurrent(migrated)
    expect(encoded.header).toMatchObject({ type: 'session', version: 2, id: 'full-chain' })

    const back = sessionFormatCatalog.decodeArtifact(encoded.header, encoded.rows)
    expect(back.header.version).toBe(2)
    // A current artifact read back is accepted by the current restorer.
    expect(sessionFormatCatalog.migrate(back)).toEqual(migrated)
  })

  it('classifies a current (v2) header as current without migrating it', () => {
    const header = {
      type: 'session',
      version: 2,
      id: 'already-current',
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
    }
    const result = sessionFormatCatalog.readHeader(header)
    expect(result.status).toBe('current')
    if (result.status !== 'current') throw new Error('expected current')
    expect(result.storedVersion).toBe(2)
    expect(result.header).toMatchObject({ version: 2, id: 'already-current' })
  })

  it('reports a newer (unknown large) version as unsupported', () => {
    const result = sessionFormatCatalog.readHeader({ type: 'session', version: 9, id: 'newer' })
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') throw new Error('expected unsupported')
    expect(result.reason).toMatch(/newer format v9/)
  })

  it.each([
    { type: 'session' },
    { type: 'session', version: 0, id: 'broken', createdAt: 1 },
  ])('reports a malformed physical header %# as malformed', (header) => {
    const result = sessionFormatCatalog.readHeader(header)
    expect(result.status).toBe('malformed')
  })

  it('recovers only the complete row prefix of a crash-tailed v0 artifact', () => {
    const prefixRows = [
      { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
      { type: 'turn/end', seq: 1, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const badRow = {
      type: 'text-chunks',
      seq0: 7,
      time0: 4,
      data: { turn: 2, step: 0, index: 0, dt: [1], texts: ['x', 'y'] },
    }
    const header = { type: 'session', version: 0, id: 'recoverable', createdAt: 1, delegationDepth: 0 }

    const recovered = sessionFormatCatalog.decodeRecoverableArtifact(header, [...prefixRows, badRow])
    expect(recovered.events).toEqual(sessionFormatCatalog.decodeArtifact(header, prefixRows).events)
    expect(() => sessionFormatCatalog.decodeArtifact(header, [...prefixRows, badRow])).toThrow()
  })

  it('refuses an unknown required current event type through the installed Session seam', () => {
    const artifact: SessionFormatArtifact = {
      header: { version: 2, id: 'unknown-current', createdAt: 1, isSeeded: false, delegationDepth: 0 },
      inheritedEventCount: 0,
      events: [event('ordinary/not-installed', 0, 1, 'future')],
    }
    expect(() => sessionFormatCatalog.migrate(artifact))
      .toThrow(/unknown event type "ordinary\/not-installed"/)
  })

  it('allows an ignorable unknown current event to survive vocabulary-restored growth', () => {
    const artifact: SessionFormatArtifact = {
      header: { version: 2, id: 'ignorable-current', createdAt: 1, isSeeded: false, delegationDepth: 0 },
      inheritedEventCount: 0,
      events: [
        {
          type: 'ordinary/external',
          seq: 0,
          time: 1,
          data: null,
          ignorable: true,
        } as unknown as SessionFormatEvent,
      ],
    }
    expect(sessionFormatCatalog.migrate(artifact).events).toEqual(artifact.events)
  })

  it('promotes a stored v1 artifact through the single v1->v2 step plus current restore', () => {
    const v1Logical: SessionFormatArtifact = {
      header: { version: 1, id: 'v1-chain', createdAt: 1, isSeeded: false, delegationDepth: 0 },
      inheritedEventCount: 0,
      events: [
        event('turn/start', 0, 100, { turn: 1 }),
        event('step/start', 1, 101, { turn: 1, step: 1 }),
        event('assistant/chunk', 2, 110, {
          turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' },
        }),
        event('assistant/chunk', 3, 120, {
          turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } },
        }),
      ],
    }
    expect(sessionFormatCatalog.readHeader({ type: 'session', version: 1, id: 'v1-chain', createdAt: 1, delegationDepth: 0 }).status)
      .toBe('migration-required')
    const migrated = sessionFormatCatalog.migrate(v1Logical)
    expect(migrated.header.version).toBe(2)
    const folded = migrated.events.find(candidate => candidate.type === 'assistant/attempt')
    expect(folded?.type).toBe('assistant/attempt')
  })
})