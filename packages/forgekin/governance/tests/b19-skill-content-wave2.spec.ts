/**
 * B19 wave 2 — 技能内容资产二波迁移契约测试。
 *
 * 覆盖：工程流程域 4 个核心技能包（tdd / writing-plans / quality-gate / merge-gate）
 * 的真实内容资产能被既有技能查询框架读取：
 *   - readSkillMeta 读 4 包 SKILL.md frontmatter（description/triggers 非空）
 *   - parseManifestSkillMeta 能解析 manifest.yaml 的 wave1+wave2 合计路由（≥8 键）
 *   - querySkill 对 wave 2 4 包返回非空 detail
 * 全部真实读文件（packages/forgekin/governance/skills），无 Mock。
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

// vitest 从仓库根运行（process.cwd() = flowforge 仓库根）
const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd(); // 仓库根（querySkill 读 capabilities config）

const W2 = ['tdd', 'writing-plans', 'quality-gate', 'merge-gate'] as const;

describe('B19 wave2 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of W2) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves wave1+wave2 routing keys (>=8)', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(8);
    for (const p of W2) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for wave2 4 packages', async () => {
    for (const p of W2) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});