import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

// vitest 从仓库根运行（process.cwd() = flowforge 仓库根）
const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd();

const W3 = ['fresh-context-review', 'request-review', 'receive-review', 'receive-handoff-grounding'] as const;

describe('B19 wave3 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of W3) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1+wave2+wave3 routing keys (>=12)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(12);
    for (const p of W3) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave3 4 packages', async () => {
    for (const p of W3) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});