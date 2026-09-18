import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * Structural contract test for the externalised world-engine prompts.
 *
 * Iron law 5 / P16: prompts must live in YAML, never hard-coded. The legacy
 * module shipped `config/prompts.yaml` but had **no loader** (nothing imported
 * it), so this wave migrates the asset and locks its structure rather than
 * inventing a runtime reader (design D4).
 */
const assetPath = resolve(__dirname, '../assets/prompts.yaml');

const EXPECTED_PROMPTS = [
  'canon_sync_review',
  'canon_conflict_resolution',
  'role_mask_validation',
  'role_mask_scene_entry',
  'world_driver_tick',
  'world_driver_canon_proposal',
  'coordinator_scene_decision',
  'health_check',
] as const;

describe('assets/prompts.yaml', () => {
  const raw = readFileSync(assetPath, 'utf8');

  it('is parser-readable UTF-8 YAML without a BOM', () => {
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(raw.includes('\r\n')).toBe(false);
    expect(() => parseYaml(raw)).not.toThrow();
  });

  const parsed = parseYaml(raw) as {
    world_engine_prompts?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };

  it('carries all eight world-engine prompts as non-empty text', () => {
    const prompts = parsed.world_engine_prompts;
    expect(prompts).toBeDefined();
    expect(Object.keys(prompts ?? {})).toEqual([...EXPECTED_PROMPTS]);
    for (const key of EXPECTED_PROMPTS) {
      const value = prompts?.[key];
      expect(typeof value, key).toBe('string');
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('documents meta with version, engine and rules', () => {
    expect(parsed.meta?.['version']).toBe('1.0.0');
    expect(String(parsed.meta?.['engine'])).toContain('world_engine');
    expect(String(parsed.meta?.['spec_ref'])).toContain('F093');
    const rules = parsed.meta?.['rules'];
    expect(Array.isArray(rules)).toBe(true);
    expect((rules as unknown[]).length).toBeGreaterThan(0);
  });

  it('keeps the canon-review prompt aligned with the CL-010 gate', () => {
    const prompt = String(parsed.world_engine_prompts?.['canon_sync_review'] ?? '');
    expect(prompt).toContain('{turn_content}');
    expect(prompt).toContain('should_canon');
  });
});
