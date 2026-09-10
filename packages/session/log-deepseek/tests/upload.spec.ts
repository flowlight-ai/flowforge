import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@flowforge/llm'
import { Session, SessionId, type SessionEvent } from '@flowforge/session'
import {
  acceptedThrough,
  retrieveSessionLog,
  wireEvent,
  wireHeader,
  type SessionLogPort,
} from '../src/index.ts'
import type { DeepSeekSessionLogExtension } from '../src/index.ts'

function headerFor(id: string, extras: Partial<SessionLogPort['header']> = {}): SessionLogPort['header'] {
  return {
    version: 0,
    id: SessionId(id),
    createdAt: 1700000000000,
    ...extras,
  }
}

function appendUser(session: Session, text: string): SessionEvent {
  return session.append('user/message', {
    turn: 1,
    step: 1,
    message: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
  } as never, {
    surfaceOp: 'append',
  } as never)
}

/** Port wrapping a real @flowforge/session Session with live reads. */
function portFrom(session: Session): SessionLogPort {
  return {
    header: session.header,
    get seq() { return session.seq },
    get events() { return session.events },
    append: (type, data) => session.append(type, data),
  }
}

describe('acceptedThrough', () => {
  it('returns -1 before any accepted request', () => {
    const session = Session.create(SessionId('s1'))
    const port = portFrom(session)
    expect(acceptedThrough(port)).toBe(-1)
  })

  it('folds matching acceptance watermarks incrementally', () => {
    const session = Session.create(SessionId('s1'))
    const port = portFrom(session)
    appendUser(session, 'hello')
    appendUser(session, 'world')

    const first = retrieveSessionLog(port, 's1')
    expect(first).toBeDefined()
    expect(first!.value.events.map(event => event.seq)).toEqual([0, 1])
    first!.accept()
    expect(acceptedThrough(port)).toBe(1)

    appendUser(session, 'again')
    expect(acceptedThrough(port)).toBe(1)
    const second = retrieveSessionLog(port, 's1')
    // The prior acceptance marker is re-uploaded so the receiver sees the watermark.
    expect(second!.value.events.map(event => event.seq)).toEqual([2, 3])
    second!.accept()
    expect(acceptedThrough(port)).toBe(3)
  })

  it('ignores acceptance events for a different session or format version', () => {
    const session = Session.create(SessionId('s1'))
    const port = portFrom(session)
    appendUser(session, 'hello')
    session.append('session-log-deepseek/delivery-accepted', {
      sessionId: SessionId('other'),
      sessionFormatVersion: 0,
      throughSeq: 0,
    })
    session.append('session-log-deepseek/delivery-accepted', {
      sessionId: SessionId('s1'),
      sessionFormatVersion: 99,
      throughSeq: 99,
    })
    expect(acceptedThrough(port)).toBe(-1)
  })

  it('rejects malformed acceptance watermarks', () => {
    const session = Session.create(SessionId('s1'))
    const port = portFrom(session)
    appendUser(session, 'hello')
    session.append('session-log-deepseek/delivery-accepted', {
      sessionId: SessionId('s1'),
      sessionFormatVersion: 0,
      throughSeq: -5,
    } as never)
    expect(() => acceptedThrough(port)).toThrow(/malformed acceptance watermark/)
  })
})

describe('retrieveSessionLog', () => {
  it('returns undefined for an unnamed session or a mismatched id', () => {
    const session = Session.create(SessionId('s1'))
    const port = portFrom(session)
    expect(retrieveSessionLog(port)).toBeUndefined()
    expect(retrieveSessionLog(port, 'other')).toBeUndefined()
  })

  it('returns undefined for an empty log', () => {
    const session = Session.create(SessionId('s1'))
    expect(retrieveSessionLog(portFrom(session), 's1')).toBeUndefined()
  })

  it('re-uploads the prior acceptance marker once the log ends at the watermark', () => {
    const session = Session.create(SessionId('s1'))
    const port = portFrom(session)
    appendUser(session, 'hello')
    const first = retrieveSessionLog(port, 's1')
    first!.accept()
    const next = retrieveSessionLog(port, 's1')
    expect(next).toBeDefined()
    expect(next!.value).toMatchObject({
      afterSeq: 0,
      throughSeq: 1,
    })
    expect(next!.value.events).toEqual([
      expect.objectContaining({ type: 'session-log-deepseek/delivery-accepted', seq: 1 }),
    ])
  })

  it('builds the full wire extension with raw numbers and surface ops', () => {
    const session = Session.create(SessionId('s1'), undefined, headerFor('s1', { cwd: '/work' }))
    const port = portFrom(session)
    appendUser(session, 'hello')

    const result = retrieveSessionLog(port, 's1')!
    const value = result.value as DeepSeekSessionLogExtension
    expect(value.version).toBe(1)
    expect(value.sessionFormatVersion).toBe(0)
    expect(value.session).toMatchObject({ id: 's1', createdAt: 1700000000000, cwd: '/work' })
    expect(value.afterSeq).toBe(-1)
    expect(value.throughSeq).toBe(0)
    expect(value.events).toHaveLength(1)
    expect(value.events[0]).toMatchObject({ type: 'user/message', seq: 0, surfaceOp: 'append' })
  })
})

describe('wireHeader', () => {
  it('omits absent optional fields and stringifies identities', () => {
    const port: SessionLogPort = {
      header: {
        version: 0,
        id: SessionId('s1'),
        createdAt: 1,
        parentSession: SessionId('p'),
      },
      seq: 0,
      events: [],
      append: ((_type: 'session-log-deepseek/delivery-accepted', _data: never) => {
        throw new Error('unreachable')
      }),
    }
    expect(wireHeader(port)).toEqual({ version: 0, id: 's1', createdAt: 1, parentSession: 'p' })
  })

  it('serializes seedLength and remaining fields', () => {
    const port: SessionLogPort = {
      header: {
        version: 0,
        id: SessionId('s1'),
        createdAt: 1,
        seedLength: 3,
        origin: 'subagent',
        delegationDepth: 1,
        agentPreset: 'code',
      },
      seq: 0,
      events: [],
      append: ((_type: 'session-log-deepseek/delivery-accepted', _data: never) => {
        throw new Error('unreachable')
      }),
    }
    expect(wireHeader(port)).toEqual({
      version: 0, id: 's1', createdAt: 1, seedLength: 3,
      origin: 'subagent', delegationDepth: 1, agentPreset: 'code',
    })
  })
})

describe('wireEvent', () => {
  it('serializes a surface replace op with raw numbers', () => {
    const session = Session.create(SessionId('s1'))
    const first = session.append('user/message', {
      turn: 1,
      step: 1,
      message: createUserMessage({
        content: [{ type: 'text', text: 'a' }],
        source: { kind: 'user' },
      }),
    } as never, {
      surfaceOp: 'append',
    } as never)
    const second = session.append('user/message', {
      turn: 1,
      step: 1,
      message: createUserMessage({
        content: [{ type: 'text', text: 'b' }],
        source: { kind: 'user' },
      }),
    } as never, {
      surfaceOp: 'append',
    } as never)
    const replacement = session.append('user/message', {
      turn: 1,
      step: 1,
      message: createUserMessage({
        content: [{ type: 'text', text: 'c' }],
        source: { kind: 'user' },
      }),
    } as never, {
      surfaceOp: { op: 'replace', start: first.seq, end: second.seq },
      sourceEventSeqs: [first.seq, second.seq],
    } as never)
    const wire = wireEvent(replacement)
    expect(wire.surfaceOp).toEqual({ op: 'replace', start: first.seq, end: second.seq })
    expect(wire.sourceEventSeqs).toEqual([first.seq, second.seq])
  })

  it('carries the ignorable marker and JSON data', () => {
    const session = Session.create(SessionId('s1'))
    const event = session.append('session/end-seed', {})
    expect(wireEvent(event)).toMatchObject({ type: 'session/end-seed', seq: 0, data: {} })
  })
})
