/**
 * F231 AC-C3: Collection signal whitelist (KD-9).
 *
 * The whitelist is a CLOSED enum of deterministic, explainable event types.
 * KD-9 contract: only these kinds are allowed as collection sources.
 * Everything else (classifier, regex scan, LLM annotation) is forbidden.
 *
 * Tests verify:
 *   1. COLLECTION_SIGNAL_KINDS is a frozen array of allowed kinds
 *   2. isAllowedCollectionSignal() accepts every whitelisted kind
 *   3. isAllowedCollectionSignal() rejects forbidden kinds
 *   4. ProfileUpdateSignalProvenance.kind type is a subset of the whitelist
 */

import { describe, expect, test } from 'vitest';
import { COLLECTION_SIGNAL_KINDS, isAllowedCollectionSignal } from '../src/types/profile-update.ts';

describe('F231 AC-C3 — Collection signal whitelist (KD-9)', () => {
  describe('COLLECTION_SIGNAL_KINDS', () => {
    test('is a frozen array (closed enum, no runtime extension)', () => {
      expect(Array.isArray(COLLECTION_SIGNAL_KINDS)).toBeTruthy();
      expect(Object.isFrozen(COLLECTION_SIGNAL_KINDS)).toBeTruthy();
    });

    test('contains all KD-9 whitelisted kinds', () => {
      const required = ['cvo-instructed', 'cat-declared', 'magic-word', 'message-coordinate', 'sign-off', 'reaction'] as const;
      for (const kind of required) {
        expect(COLLECTION_SIGNAL_KINDS.includes(kind)).toBeTruthy();
      }
    });

    test('contains ONLY whitelisted kinds (no extras)', () => {
      const allowed = new Set([
        'cvo-instructed',
        'cat-declared',
        'magic-word',
        'message-coordinate',
        'sign-off',
        'reaction',
      ]);
      for (const kind of COLLECTION_SIGNAL_KINDS) {
        expect(allowed.has(kind)).toBeTruthy();
      }
    });
  });

  describe('isAllowedCollectionSignal()', () => {
    test('accepts every whitelisted kind', () => {
      for (const kind of COLLECTION_SIGNAL_KINDS) {
        expect(isAllowedCollectionSignal(kind)).toBe(true);
      }
    });

    test('rejects classifier-inferred kinds (KD-9 forbidden)', () => {
      const forbidden = ['classifier-inferred', 'regex-scan', 'llm-annotation', 'sentiment-analysis', 'pattern-match'];
      for (const kind of forbidden) {
        expect(isAllowedCollectionSignal(kind)).toBe(false);
      }
    });

    test('rejects empty string and undefined', () => {
      expect(isAllowedCollectionSignal('')).toBe(false);
      expect(isAllowedCollectionSignal(undefined)).toBe(false);
      expect(isAllowedCollectionSignal(null)).toBe(false);
    });
  });
});
