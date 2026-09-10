import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@flowforge/llm'
import { Session, SessionId, type SessionEvent } from '@flowforge/session'
import { preview, turnOutlineProjectionDefinition } from '../src/index.ts'
import type { TurnOutlineState } from '../src/index.ts'

/** Fold the whole log through the unit, returning the final state and the view. */
function fold(events: readonly SessionEvent[]): { state: TurnOutlineState; view: readonly import('../src/index.ts').TurnOutlineEntry[] } {
  let state = turnOutlineProjectionDefinition.init()
  for (const event of events) {
    state = turnOutlineProjectionDefinition.apply(state, event)
  }
  return { state, view: turnOutlineProjectionDefinition.view(state) }
}

function user(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function assistant(text: string): ReturnType<typeof createAssistantMessage> {
  return createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: 'mock', model: 'mock' },
  })
}

describe('preview', () => {
  it('space-joins text blocks and collapses whitespace', () => {
    expect(preview([
      { type: 'text', text: 'hello' },
      { type: 'text', text: '   world  \n again' },
    ], 120)).toBe('hello world again')
  })

  it('skips non-text blocks', () => {
    expect(preview([
      { type: 'text', text: 'only' },
      { type: 'image', attachment: {} as never },
      { type: 'tool-call', id: '1' as never, name: 'x', arguments: '{}' },
    ], 120)).toBe('only')
  })

  it('clips over-limit text with an ellipsis', () => {
    const clipped = preview([{ type: 'text', text: 'x'.repeat(300) }], 50)
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped.length).toBe(50)
    expect(clipped.startsWith('x'.repeat(49))).toBe(true)
  })

  it('returns an empty string for no text and marks a clipped tail', () => {
    expect(preview([{ type: 'text', text: '   ' }], 50)).toBe('')
    const clipped = preview([{ type: 'text', text: 'ab'.repeat(40) }], 50)
    expect(clipped).toHaveLength(50)
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped.startsWith('ab')).toBe(true)
  })
})

describe('turnOutline projection fold', () => {
  it('opens turns at turn/start with their seq and empty previews', () => {
    const session = Session.create(SessionId('s1'))
    session.append('turn/start', { turn: 1 })
    session.append('turn/start', { turn: 2 })
    const { view } = fold(session.events)
    expect(view).toEqual([
      { turn: 1, seq: 0, prompt: '', response: '' },
      { turn: 2, seq: 1, prompt: '', response: '' },
    ])
  })

  it('records the first human prompt and commits the final response at turn/end', () => {
    const session = Session.create(SessionId('s1'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', user('first prompt'), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1, step: 1, message: assistant('first answer'),
    }, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1, step: 1, message: assistant('final answer'),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const { view } = fold(session.events)
    expect(view).toEqual([
      { turn: 1, seq: 0, prompt: 'first prompt', response: 'final answer' },
    ])
  })

  it('keeps the first prompt when later steering messages arrive', () => {
    const session = Session.create(SessionId('s1'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', user('opening'), { surfaceOp: 'append' })
    session.append('user/message', user('steering'), { surfaceOp: 'append' })
    const { view } = fold(session.events)
    expect(view[0]?.prompt).toBe('opening')
  })

  it('ignores a retried boundary that does not advance the turn number', () => {
    const session = Session.create(SessionId('s1'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', user('prompt'), { surfaceOp: 'append' })
    session.append('turn/start', { turn: 1 })
    const { view } = fold(session.events)
    expect(view).toHaveLength(1)
    expect(view[0]).toMatchObject({ turn: 1, prompt: 'prompt' })
  })

  it('returns the same reference for uninteresting and draft-only events', () => {
    const state = turnOutlineProjectionDefinition.init()
    const session = Session.create(SessionId('s1'))
    session.append('turn/start', { turn: 1 })
    const uninteresting: SessionEvent = session.events[0]!
    expect(turnOutlineProjectionDefinition.apply(state, uninteresting)).not.toBe(state)

    session.append('user/message', user('p'), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: assistant('draft') }, { surfaceOp: 'append' })
    const opened = turnOutlineProjectionDefinition.apply(state, session.events[0]!)
    const prompted = turnOutlineProjectionDefinition.apply(opened, session.events[1]!)
    const drafted = turnOutlineProjectionDefinition.apply(prompted, session.events[2]!)
    expect(drafted.turns).toBe(prompted.turns)
  })

  it('validates strictly increasing turns on the wire view', () => {
    const schema = turnOutlineProjectionDefinition.schema
    expect(schema.parse([
      { turn: 1, seq: 0, prompt: 'a', response: '' },
      { turn: 2, seq: 1, prompt: 'b', response: 'c' },
    ])).toHaveLength(2)
    expect(() => schema.parse([
      { turn: 2, seq: 1, prompt: 'b', response: 'c' },
      { turn: 1, seq: 0, prompt: 'a', response: '' },
    ])).toThrow(/strictly increasing by turn/)
    expect(() => schema.parse([
      { turn: 1, seq: 0, prompt: 'a', response: '' },
      { turn: 1, seq: 1, prompt: 'b', response: 'c' },
    ])).toThrow(/strictly increasing by turn/)
  })
})
