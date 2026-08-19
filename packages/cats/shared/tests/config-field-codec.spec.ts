import { describe, expect, it } from 'vitest';

// Will be created — expect import to fail until implementation exists
import { decodeFieldValue, encodeFieldValue } from '../src/types/config-field-codec.ts';
import type { ListConfigField, OperationConfigField, SelectConfigField } from '../src/types/config-field.ts';

describe('config-field-codec', () => {
  // ── input ──────────────────────────────────────────────────────────

  describe('input', () => {
    const field = { type: 'input', envName: 'X', label: 'X', required: true, sensitive: false } as const;

    it('round-trips a plain string', () => {
      const encoded = encodeFieldValue(field, 'hello')!;
      expect(encoded).toBe('hello');
      expect(decodeFieldValue(field, encoded)).toBe('hello');
    });

    it('encodes empty string as empty string', () => {
      expect(encodeFieldValue(field, '')).toBe('');
    });
  });

  // ── toggle ─────────────────────────────────────────────────────────

  describe('toggle', () => {
    const field = { type: 'toggle', envName: 'T', label: 'T', required: false } as const;

    it('encodes true as "true"', () => {
      expect(encodeFieldValue(field, true)).toBe('true');
    });

    it('encodes false as "false"', () => {
      expect(encodeFieldValue(field, false)).toBe('false');
    });

    it('decodes "true" to true', () => {
      expect(decodeFieldValue(field, 'true')).toBe(true);
    });

    it('decodes "false" to false', () => {
      expect(decodeFieldValue(field, 'false')).toBe(false);
    });

    it('decodes invalid string to false (graceful)', () => {
      expect(decodeFieldValue(field, 'yes')).toBe(false);
      expect(decodeFieldValue(field, '')).toBe(false);
      expect(decodeFieldValue(field, 'TRUE')).toBe(false);
    });
  });

  // ── select ─────────────────────────────────────────────────────────

  describe('select', () => {
    const field: SelectConfigField = {
      type: 'select',
      envName: 'S',
      label: 'S',
      required: true,
      options: [
        { value: 'webhook', label: 'Webhook' },
        { value: 'websocket', label: 'WebSocket' },
      ],
    };

    it('encodes a valid option value as-is', () => {
      expect(encodeFieldValue(field, 'webhook')).toBe('webhook');
    });

    it('decodes a valid option value', () => {
      expect(decodeFieldValue(field, 'websocket')).toBe('websocket');
    });

    it('decodes invalid option to undefined', () => {
      expect(decodeFieldValue(field, 'ftp')).toBe(undefined);
    });
  });

  // ── list ───────────────────────────────────────────────────────────

  describe('list', () => {
    const field = { type: 'list', envName: 'L', label: 'L', required: false } as const;

    it('encodes string array to JSON', () => {
      expect(encodeFieldValue(field, ['a', 'b'])).toBe('["a","b"]');
    });

    it('encodes empty array', () => {
      expect(encodeFieldValue(field, [])).toBe('[]');
    });

    it('decodes JSON string array', () => {
      expect(decodeFieldValue(field, '["x","y"]')).toEqual(['x', 'y']);
    });

    it('decodes invalid JSON to empty array (graceful)', () => {
      expect(decodeFieldValue(field, 'not-json')).toEqual([]);
    });

    it('decodes non-string-array JSON to empty array (graceful)', () => {
      expect(decodeFieldValue(field, '{"a":1}')).toEqual([]);
      expect(decodeFieldValue(field, '[1,2]')).toEqual([]);
    });
  });

  // ── operation (should not encode/decode) ───────────────────────────

  describe('operation', () => {
    const field: OperationConfigField = { type: 'operation', name: 'op', label: 'Op', required: false, actions: [] };

    it('encode returns undefined for operation', () => {
      expect(encodeFieldValue(field, 'anything')).toBe(undefined);
    });

    it('decode returns undefined for operation', () => {
      expect(decodeFieldValue(field, 'anything')).toBe(undefined);
    });
  });

  // ── YAML default encoding ──────────────────────────────────────────

  describe('encodeDefaultValue', () => {
    // Import the default encoder — converts YAML native values to stored strings
    // toggle: false → "false", list: [] → "[]", etc.

    it('toggle default false → "false"', () => {
      const field = { type: 'toggle', envName: 'T', label: 'T', required: false, default: false } as const;
      expect(encodeFieldValue(field, field.default)).toBe('false');
    });

    it('toggle default true → "true"', () => {
      const field = { type: 'toggle', envName: 'T', label: 'T', required: false, default: true } as const;
      expect(encodeFieldValue(field, field.default)).toBe('true');
    });

    it('list default [] → "[]"', () => {
      const field: ListConfigField = { type: 'list', envName: 'L', label: 'L', required: false, default: [] };
      expect(encodeFieldValue(field, field.default)).toBe('[]');
    });

    it('select default → string as-is', () => {
      const field: SelectConfigField = {
        type: 'select',
        envName: 'S',
        label: 'S',
        required: false,
        options: [{ value: 'a', label: 'A' }],
        default: 'a',
      };
      expect(encodeFieldValue(field, field.default)).toBe('a');
    });
  });
});
