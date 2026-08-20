import { describe, expect, it } from 'vitest';

/**
 * F227 PR-1 Task 1 — terminal EventMemory schema (10 fields) guard tests.
 *
 * Source of truth: docs/discussions/2026-06-06-f227-design-gate.md
 *   "新增 EventMemory typed model，使用终态 10 字段：
 *    type, trigger, cat, threadId, messageId, timestamp, summary,
 *    cognitiveTransition, relatedHarness, confidence."
 * cognitiveTransition / relatedHarness are nullable but the KEY must exist
 * (terminal 10-field shape — writers must explicitly say "no transition" = null,
 * not forget the field).
 */

const TRIGGERS = ['human_brake', 'cat_brake', 'cat_shout', 'flywheel_selffix', 'lesson_settle'];
const TRANSITIONS = [
  'user_brake',
  'self_brake',
  'coordinate_correction',
  'capability_gap',
  'scope_correction',
  'aha',
  'repeated_need',
  'harness_internalized',
  'lesson_crystallized',
];
const CONFIDENCES = ['high', 'mid', 'low'];

/** A fully-valid 10-field record. */
function validRecord() {
  return {
    type: 'scaffold',
    trigger: 'human_brake',
    cat: 'cat-opus',
    threadId: 'thread_abc123',
    messageId: 'msg_xyz789',
    timestamp: 1717650000000,
    summary: '脚手架',
    cognitiveTransition: 'user_brake',
    relatedHarness: null,
    confidence: 'high',
  };
}

describe('F227: EventMemory types', () => {
  describe('generateEventId', () => {
    it('generates ID with evt_ prefix', async () => {
      const { generateEventId } = await import('../src/types/event-memory.ts');
      const id = generateEventId();
      expect(id.startsWith('evt_')).toBeTruthy();
    });

    it('generates unique IDs', async () => {
      const { generateEventId } = await import('../src/types/event-memory.ts');
      expect(generateEventId()).not.toBe(generateEventId());
    });
  });

  describe('isEventMemoryRecord — accepts', () => {
    it('accepts a fully-valid record', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord(validRecord())).toBe(true);
    });

    it('accepts every trigger enum value', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      for (const trigger of TRIGGERS) {
        expect(isEventMemoryRecord({ ...validRecord(), trigger })).toBe(true);
      }
    });

    it('accepts every confidence enum value', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      for (const confidence of CONFIDENCES) {
        expect(isEventMemoryRecord({ ...validRecord(), confidence })).toBe(true);
      }
    });

    it('accepts every cognitiveTransition enum value', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      for (const cognitiveTransition of TRANSITIONS) {
        expect(isEventMemoryRecord({ ...validRecord(), cognitiveTransition })).toBe(true);
      }
    });

    it('accepts null cognitiveTransition', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), cognitiveTransition: null })).toBe(true);
    });

    it('accepts relatedHarness as string array', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), relatedHarness: ['commit:abc', 'skill:tdd'] })).toBe(true);
    });
  });

  describe('isEventMemoryRecord — rejects non-objects', () => {
    it('rejects null / undefined / primitives / array', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      for (const bad of [null, undefined, 'x', 42, true, []]) {
        expect(isEventMemoryRecord(bad)).toBe(false);
      }
    });
  });

  describe('isEventMemoryRecord — rejects missing fields', () => {
    const ALL_FIELDS = [
      'type',
      'trigger',
      'cat',
      'threadId',
      'messageId',
      'timestamp',
      'summary',
      'cognitiveTransition',
      'relatedHarness',
      'confidence',
    ];
    for (const field of ALL_FIELDS) {
      it(`rejects record missing "${field}" key`, async () => {
        const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
        const bad: Record<string, unknown> = validRecord();
        delete bad[field];
        expect(isEventMemoryRecord(bad)).toBe(false);
      });
    }
  });

  describe('isEventMemoryRecord — rejects wrong types & bad enums', () => {
    it('rejects invalid trigger enum', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), trigger: 'bogus' })).toBe(false);
    });

    it('rejects invalid confidence enum', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), confidence: 'sky-high' })).toBe(false);
    });

    it('rejects invalid cognitiveTransition enum', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), cognitiveTransition: 'enlightenment' })).toBe(false);
    });

    it('rejects non-string type', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), type: 123 })).toBe(false);
    });

    it('rejects non-number timestamp', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), timestamp: '123' })).toBe(false);
    });

    it('rejects relatedHarness with non-string elements', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), relatedHarness: [1, 2] })).toBe(false);
    });

    it('rejects relatedHarness that is neither null nor array', async () => {
      const { isEventMemoryRecord } = await import('../src/types/event-memory.ts');
      expect(isEventMemoryRecord({ ...validRecord(), relatedHarness: 'commit:abc' })).toBe(false);
    });
  });
});
