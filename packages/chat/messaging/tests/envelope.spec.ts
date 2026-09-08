/**
 * Envelope pure projection — contract tests (T-D1, D-1 / P4).
 */
import { describe, expect, it } from 'vitest'
import type { EnvelopeStoredMessage } from '../src/envelope.js'
import { projectEnvelope, renderElementsText } from '../src/envelope.js'

function baseRow(overrides: Partial<EnvelopeStoredMessage> = {}): EnvelopeStoredMessage {
  return {
    id: 'm1',
    threadId: 't1',
    userId: 'u1',
    catId: null,
    content: 'plain',
    mentions: [],
    timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function pluginExtra(): Record<string, unknown> {
  return {
    instanceId: 'inst-1',
    revision: 1,
    provenance: { origin: { kind: 'plugin', instanceId: 'inst-1' }, epistemicStatus: 'inference' },
    elements: [{ elementId: 'e1', kind: 'text', payload: { text: 'hello' }, epistemicStatus: 'inference' }],
    appendOps: [],
  }
}

describe('projectEnvelope — user message', () => {
  it('projects a user message with user_intent epistemic and user actor', () => {
    const env = projectEnvelope(baseRow())
    expect(env).not.toBeNull()
    expect(env!.actor).toEqual({ kind: 'user', id: 'u1' })
    expect(env!.revision).toBe(1)
    expect(env!.audience).toEqual({ kind: 'public' })
    const payload = env!.payload as { provenance: { epistemicStatus: string } }
    expect(payload.provenance.epistemicStatus).toBe('user_intent')
    const elements = env!.payload.elements as unknown as Array<{ payload: { text: string } }>
    expect(elements[0]!.payload.text).toBe('plain')
  })
})

describe('projectEnvelope — cat message', () => {
  it('projects a cat message with inference epistemic and cat actor', () => {
    const env = projectEnvelope(baseRow({ catId: 'c1' }))
    expect(env).not.toBeNull()
    expect(env!.actor).toEqual({ kind: 'cat', id: 'c1' })
    const payload = env!.payload as { provenance: { epistemicStatus: string } }
    expect(payload.provenance.epistemicStatus).toBe('inference')
  })
})

describe('projectEnvelope — whisper audience', () => {
  it('projects visibility=whisper into a whisper audience with target copies', () => {
    const env = projectEnvelope(baseRow({ visibility: 'whisper', whisperTo: ['u2', 'u3'] }))
    expect(env).not.toBeNull()
    expect(env!.audience).toEqual({ kind: 'whisper', targets: ['u2', 'u3'] })
  })
})

describe('projectEnvelope — plugin message', () => {
  it('projects extra.pluginMessage into a plugin envelope', () => {
    const env = projectEnvelope(baseRow({ extra: { pluginMessage: pluginExtra() } }))
    expect(env).not.toBeNull()
    expect(env!.actor).toEqual({ kind: 'plugin', id: 'inst-1' })
    expect(env!.revision).toBe(1)
    expect(env!.payload.elements).toHaveLength(1)
    const serialized = env!.payload.elements as unknown as Array<{ payload: { text: string } }>
    expect(serialized[0]!.payload.text).toBe('hello')
  })

  it('returns null for a malformed plugin message (fail-closed)', () => {
    const malformed = { ...(pluginExtra() as Record<string, unknown>), revision: 'not-a-number' }
    expect(projectEnvelope(baseRow({ extra: { pluginMessage: malformed } }))).toBeNull()
  })
})

describe('projectEnvelope — deletion', () => {
  it('returns null for tombstoned messages', () => {
    expect(projectEnvelope(baseRow({ _tombstone: true }))).toBeNull()
  })

  it('returns null for soft-deleted messages', () => {
    expect(projectEnvelope(baseRow({ deletedAt: Date.now() }))).toBeNull()
  })
})

describe('renderElementsText', () => {
  it('joins text payloads and marks non-text elements', () => {
    const text = { elementId: 'e1', kind: 'text' as const, payload: { text: 'hello' } }
    const media = { elementId: 'e2', kind: 'media_ref' as const, payload: { ref: 'x' } }
    expect(renderElementsText([text, media])).toBe('hello\n[media_ref:e2]')
  })
})