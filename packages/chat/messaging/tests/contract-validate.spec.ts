/**
 * Plugin Messaging input admission — contract tests (T-D1, INV-2 / D-4).
 */
import { describe, expect, it } from 'vitest'
import { validateMessagingRowInput, validateMessagingRowResult } from '@flowforge/plugin-contract'
import { MessagingError } from '../src/contract/host-types.js'
import { validateAppendInput, validateDraft } from '../src/contract/validate.js'

function validDraft(): Record<string, unknown> {
  return {
    address: { kind: 'thread_handle', handle: 'th_1' },
    idempotencyKey: 'op-1',
    payload: {
      provenance: { origin: { kind: 'plugin', instanceId: 'inst-1' }, epistemicStatus: 'inference' },
      elements: [{ elementId: 'e1', kind: 'text', payload: { text: 'hi' }, epistemicStatus: 'inference' }],
    },
  }
}

describe('validateMessagingRowInput (send)', () => {
  it('accepts a well-formed draft', () => {
    const result = validateMessagingRowInput('messaging.send', validDraft())
    expect(result.valid).toBe(true)
  })

  it('rejects a draft with a host provenance origin (D-4)', () => {
    const draft = validDraft()
    ;(draft.payload as Record<string, unknown>).provenance = {
      origin: { kind: 'host' },
      epistemicStatus: 'inference',
    }
    expect(validateMessagingRowInput('messaging.send', draft).valid).toBe(false)
  })

  it('rejects a draft with a system draftAudience (INV-2)', () => {
    const draft = validDraft()
    draft.draftAudience = { kind: 'system' }
    expect(validateMessagingRowInput('messaging.send', draft).valid).toBe(false)
  })

  it('rejects duplicate element ids', () => {
    const payload = {
      provenance: { origin: { kind: 'plugin', instanceId: 'inst-1' }, epistemicStatus: 'inference' },
      elements: [
        { elementId: 'e1', kind: 'text', payload: { text: 'a' }, epistemicStatus: 'inference' },
        { elementId: 'e1', kind: 'text', payload: { text: 'b' }, epistemicStatus: 'inference' },
      ],
    }
    expect(validateMessagingRowInput('messaging.send', { ...validDraft(), payload }).valid).toBe(false)
  })
})

describe('validateDraft', () => {
  it('returns the validated draft for a conformant input', () => {
    const draft = validateDraft(validDraft())
    expect(draft.idempotencyKey).toBe('op-1')
    expect(draft.payload.elements).toHaveLength(1)
  })

  it('rejects a derivedFromElementId that references a later element', () => {
    const payload = {
      provenance: { origin: { kind: 'plugin', instanceId: 'inst-1' }, epistemicStatus: 'user_intent' },
      elements: [
        { elementId: 'a', kind: 'text', payload: { text: 'a' }, epistemicStatus: 'user_intent', derivedFromElementId: 'b' },
        { elementId: 'b', kind: 'text', payload: { text: 'b' }, epistemicStatus: 'user_intent' },
      ],
    }
    expect(() => validateDraft({ ...validDraft(), payload })).toThrow(MessagingError)
  })

  it('rejects host provenance declared by a draft', () => {
    const draft = validDraft()
    ;(draft.payload as Record<string, unknown>).provenance = {
      origin: { kind: 'host' },
      epistemicStatus: 'inference',
    }
    expect(() => validateDraft(draft)).toThrow(MessagingError)
  })
})

describe('validateAppendInput', () => {
  it('accepts a well-formed append request', () => {
    const input = {
      handle: { kind: 'message', token: 'mh_1' },
      operationId: 'op-2',
      elements: [{ elementId: 'e2', kind: 'text', payload: { text: 'more' }, epistemicStatus: 'inference' }],
    }
    expect(validateAppendInput(input).operationId).toBe('op-2')
  })

  it('rejects an append request with an invalid handle kind', () => {
    const input = {
      handle: { kind: 'thread_handle', token: 'th_1' },
      operationId: 'op-2',
      elements: [{ elementId: 'e2', kind: 'text', payload: { text: 'more' }, epistemicStatus: 'inference' }],
    }
    expect(() => validateAppendInput(input)).toThrow(MessagingError)
  })

  it('rejects an append request with duplicate element ids', () => {
    const input = {
      handle: { kind: 'message', token: 'mh_1' },
      operationId: 'op-2',
      elements: [
        { elementId: 'e2', kind: 'text', payload: { text: 'a' }, epistemicStatus: 'inference' },
        { elementId: 'e2', kind: 'text', payload: { text: 'b' }, epistemicStatus: 'inference' },
      ],
    }
    expect(() => validateAppendInput(input)).toThrow(MessagingError)
  })
})

describe('validateMessagingRowResult (snapshot)', () => {
  it('accepts a well-formed snapshot row', () => {
    const result = validateMessagingRowResult('messaging.snapshot', {
      items: [
        {
          messageId: 'm1',
          revision: 1,
          threadId: 't1',
          actor: { kind: 'user', id: 'u1' },
          audience: { kind: 'public' },
          occurredAt: '2026-01-01T00:00:00.000Z',
          payload: {
            provenance: { origin: { kind: 'host' }, epistemicStatus: 'user_intent' },
            elements: [{ elementId: 'e1', kind: 'text', payload: { text: 'hi' }, epistemicStatus: 'inference' }],
          },
        },
      ],
      nextPageToken: null,
      snapshotAckToken: 'ack-1',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects a snapshot row with a non-Z occurredAt', () => {
    const base = {
      items: [
        {
          messageId: 'm1',
          revision: 1,
          threadId: 't1',
          actor: { kind: 'user', id: 'u1' },
          audience: { kind: 'public' },
          occurredAt: '2026-01-01T00:00:00.000',
          payload: {
            provenance: { origin: { kind: 'host' }, epistemicStatus: 'user_intent' },
            elements: [{ elementId: 'e1', kind: 'text', payload: { text: 'hi' }, epistemicStatus: 'inference' }],
          },
        },
      ],
      nextPageToken: null,
      snapshotAckToken: 'ack-1',
    }
    expect(validateMessagingRowResult('messaging.snapshot', base).valid).toBe(false)
  })

  it('rejects an unknown operation fail-closed', () => {
    expect(validateMessagingRowInput('messaging.snapshot', {}).valid).toBe(false)
  })
})