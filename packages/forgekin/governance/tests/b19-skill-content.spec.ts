/**
 * B19 wave 1 — 技能内容资产迁移契约测试。
 *
 * 覆盖：4 个核心技能包（deep-research/expert-panel/cross-cat-handoff/debugging）
 * 的真实内容资产能被既有技能查询框架读取：
 *   - readSkillMeta 读 4 包 SKILL.md frontmatter（description/triggers 非空）
 *   - parseManifestSkillMeta 能解析 manifest.yaml 的 4 键路由
 *   - querySkill 对 4 包返回非空 detail
 * 全部真实读文件（packages/forgekin/governance/skills），无 Mock。
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseManifestSkillMeta, readSkillMeta } from '../src/skill-meta.ts';
import { querySkill } from '../src/skill-query.ts';

// vitest 从仓库根运行（process.cwd() = flowforge 仓库根）
const skillsSource = resolve(process.cwd(), 'packages/forgekin/governance/skills');
const projectRoot = process.cwd(); // 仓库根（querySkill 读 capabilities config）

const PKGS = ['deep-research', 'expert-panel', 'cross-cat-handoff', 'debugging'] as const;

describe('B19 wave1 skill content assets', () => {
  it('readSkillMeta returns non-empty description + triggers for 4 packages', async () => {
    for (const p of PKGS) {
      const meta = await readSkillMeta(resolve(skillsSource, p));
      expect(meta.description, `${p} description`).toBeTruthy();
      expect(meta.triggers?.length, `${p} triggers`).toBeGreaterThan(0);
    }
  });

  it('parseManifestSkillMeta resolves 4 routing keys', async () => {
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.size).toBeGreaterThanOrEqual(4);
    for (const p of PKGS) {
      expect(map.has(p), p).toBe(true);
      expect(map.get(p)?.category, `${p} category`).toBeTruthy();
    }
  });

  it('querySkill returns non-null detail for 4 packages', async () => {
    for (const p of PKGS) {
      const detail = await querySkill(projectRoot, p, skillsSource);
      expect(detail, p).not.toBeNull();
      expect(detail?.id, p).toBeTruthy();
    }
  });
});