import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd();

const W10 = [
  'rich-messaging',
  'convention-graph-discovery',
  'concept-demo-design',
  'open-source-teardown',
  'opensource-ops',
  'agent-product-promo-director',
  'bootcamp-guide',
  'hyperfocus-brake',
  'vision-rescue',
] as const;

describe('B19 wave10 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 9 packages', async () => {
    for (const p of W10) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1..wave10 routing keys (>=29)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(29);
    for (const p of W10) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave10 9 packages', async () => {
    for (const p of W10) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});