/**
 * 事件发布契约校验：结构校验（fail-closed）与已安装 schema 子集校验。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import {
  validateDeclaredEventsPublishInput,
  validateEventsPublishInput,
  validateEventsPublishResult,
} from '../src/contract/events-publish.ts'

function validEvent() {
  return {
    signalType: 'feishu.meeting.occurred',
    eventId: 'evt-1',
    idempotencyKey: 'idem-1',
    occurredAt: '2026-09-08T00:00:00Z',
    payload: { transcriptId: 'obcn123' },
    source: { handle: 'minute://obcn123' },
  }
}

describe('validateEventsPublishInput — structure is fail-closed', () => {
  it('accepts a well-formed event', () => {
    const result = validateEventsPublishInput(validEvent())
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.value.signalType).toBe('feishu.meeting.occurred')
  })

  it('rejects unknown top-level fields', () => {
    expect(validateEventsPublishInput({ ...validEvent(), destination: 'x' }).valid).toBe(false)
  })

  it('rejects unknown source fields', () => {
    expect(validateEventsPublishInput({ ...validEvent(), source: { handle: 'h', extra: 1 } }).valid).toBe(false)
  })

  it('rejects non-record payload', () => {
    expect(validateEventsPublishInput({ ...validEvent(), payload: 'text' }).valid).toBe(false)
  })

  it('rejects empty or oversized bounded strings', () => {
    expect(validateEventsPublishInput({ ...validEvent(), eventId: '' }).valid).toBe(false)
    expect(validateEventsPublishInput({ ...validEvent(), signalType: 'x'.repeat(241) }).valid).toBe(false)
  })

  it('rejects non-record input and exposes value only when valid', () => {
    const rejected = validateEventsPublishInput('bad')
    expect(rejected.valid).toBe(false)
    expect('value' in rejected).toBe(false)
  })
})

describe('validateEventsPublishResult', () => {
  it('accepts a valid publication id and disposition', () => {
    const result = validateEventsPublishResult({ publicationId: 'pub-123', disposition: 'accepted' })
    expect(result.valid).toBe(true)
  })

  it('rejects unknown disposition and bad id shape', () => {
    expect(validateEventsPublishResult({ publicationId: 'pub-123', disposition: 'other' }).valid).toBe(false)
    expect(validateEventsPublishResult({ publicationId: 'BAD ID!', disposition: 'accepted' }).valid).toBe(false)
  })
})

describe('validateDeclaredEventsPublishInput — installed schema subset', () => {
  const declarations = [
    {
      type: 'feishu.meeting.occurred',
      schemaRef: '#/signals/feishu.meeting.occurred',
      epistemicStatus: 'observation' as const,
      privacyClass: 'content-adjacent' as const,
      sourceClass: 'remote-service' as const,
    },
  ]
  const schemas = {
    '#/signals/feishu.meeting.occurred': {
      type: 'object',
      required: ['payload', 'source'],
      properties: {
        payload: {
          type: 'object',
          required: ['transcriptId'],
          properties: { transcriptId: { type: 'string' } },
          additionalProperties: false,
        },
        source: { type: 'object', required: ['handle'] },
      },
    },
  }

  it('accepts a payload that satisfies the installed schema', () => {
    const result = validateDeclaredEventsPublishInput(declarations, schemas, validEvent() as never)
    expect(result.valid).toBe(true)
  })

  it('rejects a signal type the package does not declare', () => {
    const result = validateDeclaredEventsPublishInput(declarations, schemas, {
      ...validEvent(),
      signalType: 'other.type',
    } as never)
    expect(result.valid).toBe(false)
  })

  it('rejects when the declared schema is absent', () => {
    const result = validateDeclaredEventsPublishInput(declarations, {}, validEvent() as never)
    expect(result.valid).toBe(false)
  })

  it('rejects a payload violating schema constraints', () => {
    const result = validateDeclaredEventsPublishInput(declarations, schemas, {
      ...validEvent(),
      payload: { transcriptId: 'a', extra: true },
    } as never)
    expect(result.valid).toBe(false)
  })
})