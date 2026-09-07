import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod } from '../src/index.js';

const SAMPLE = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', description: 'The prompt to generate' },
    steps: { type: 'integer', description: 'Number of steps' },
    flag: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    meta: { type: 'object' },
    optional: { type: 'string', description: 'optional text' },
  },
};

describe('jsonSchemaToZod', () => {
  it('produces a zod v4 object schema', () => {
    const schema = jsonSchemaToZod(SAMPLE);
    expect(schema instanceof z.ZodType).toBe(true);
  });

  it('handles required vs optional fields', () => {
    const schema = jsonSchemaToZod(SAMPLE);
    expect(schema.safeParse({ prompt: 'hi', steps: 3 }).success).toBe(true);
    // missing required 'prompt' fails
    expect(schema.safeParse({ steps: 3 }).success).toBe(false);
    // optional key may be omitted
    expect(schema.safeParse({ prompt: 'hi', steps: 3, optional: undefined }).success).toBe(true);
    const parsed = schema.safeParse({ prompt: 'hi' });
    expect(parsed.success).toBe(true);
  });

  it('preserves describe() metadata (zod v4)', () => {
    const schema = jsonSchemaToZod(SAMPLE);
    expect(schema.shape.prompt.description).toBe('The prompt to generate');
    expect(schema.shape.steps.unwrap().description).toBe('Number of steps');
    expect(schema.shape.optional.unwrap().description).toBe('optional text');
  });

  it('supports arrays and unknown-object fields', () => {
    const schema = jsonSchemaToZod(SAMPLE);
    const ok = schema.safeParse({ prompt: 'p', tags: ['a', 'b'], meta: { any: true } });
    expect(ok.success).toBe(true);
  });

  it('returns an empty object schema when no properties are present', () => {
    const empty = jsonSchemaToZod({ type: 'object' });
    expect(empty.safeParse({}).success).toBe(true);
  });
});