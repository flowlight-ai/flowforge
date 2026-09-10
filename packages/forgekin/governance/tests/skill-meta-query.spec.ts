/**
 * skill-meta / skill-query 测试 — B8 缺口补建（clowder-ai `api/src/skills/skill-meta.ts`
 * 与 `skill-query.ts` 的 TS 重写）。
 *
 * 覆盖：SKILL.md frontmatter 解析（显式 triggers + 兼容内嵌中英触发词）、
 * manifest.yaml 解析、MCP 依赖状态解析、listSkills / querySkill 组合（
 * 配置态 × 元数据 × 幂等 / 不存在返回 null）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readSkillMeta,
  parseManifestSkillMeta,
  resolveSkillMcpStatuses,
  listSkills,
  querySkill,
  type SkillMeta,
} from '../src/index.ts';

let tempDirs: string[] = [];
let projectRoot = '';
let skillsSource = '';

function tmpdirs(root: string) {
  tempDirs.push(root);
  return root;
}

beforeEach(() => {
  projectRoot = tmpdirs(mkdtempSync(join(tmpdir(), 'ff-gov-skill-')));
  skillsSource = join(projectRoot, 'cat-cafe-skills');
  mkdirSync(skillsSource, { recursive: true });
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function writeSkill(name: string, content: string) {
  const dir = join(skillsSource, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
}

// ────────────────────────── readSkillMeta ──────────────────────────

describe('readSkillMeta', () => {
  it('parses explicit frontmatter triggers + cleans trigger suffix from description', async () => {
    tmpdirs(skillsSource);
    writeSkill('tdd', `---\ndescription: Run tests on demand. Triggers on "test", "suite"\ntriggers:\n  - test\n  - suite\n---\nbody\n`);
    const meta = await readSkillMeta(join(skillsSource, 'tdd'));
    expect(meta.description).toBe('Run tests on demand');
    expect(meta.triggers).toEqual(['test', 'suite']);
  });

  it('extracts embedded English trigger list when no explicit triggers', async () => {
    tmpdirs(skillsSource);
    writeSkill('review', `---\ndescription: Triggers on "review", "reread", "verify"\n---\nbody\n`);
    const meta = await readSkillMeta(join(skillsSource, 'review'));
    expect(meta.triggers).toEqual(['review', 'reread', 'verify']);
  });

  it('extracts embedded Chinese trigger list when no explicit triggers', async () => {
    tmpdirs(skillsSource);
    writeSkill('wc', `---\ndescription: 触发词："错误"、"改一下"\n---\nbody\n`);
    const meta = await readSkillMeta(join(skillsSource, 'wc'));
    expect(meta.triggers).toEqual(['错误', '改一下']);
  });

  it('returns {} on missing file / missing frontmatter / empty description', async () => {
    tmpdirs(skillsSource);
    expect(await readSkillMeta(join(skillsSource, 'nope'))).toEqual({});
    writeSkill('plain', '# no frontmatter\nbody\n');
    expect(await readSkillMeta(join(skillsSource, 'plain'))).toEqual({});
    writeSkill('empty', `---\ndescription: ""\n---\nbody\n`);
    expect(await readSkillMeta(join(skillsSource, 'empty'))).toEqual({});
    writeSkill('none', `---\ncategory: util\n---\nbody\n`);
    expect(await readSkillMeta(join(skillsSource, 'none'))).toEqual({});
  });
});

// ────────────────────────── parseManifestSkillMeta ──────────────────────────

describe('parseManifestSkillMeta', () => {
  it('parses manifest.yaml skills with category/description/triggers/requires_mcp', async () => {
    tmpdirs(skillsSource);
    writeFileSync(
      join(skillsSource, 'manifest.yaml'),
      `skills:\n  tdd:\n    category: quality\n    description: TDD workflow\n    requires_mcp:\n      - python-exec\n  review:\n    category: quality\n    triggers:\n      - review\n`,
    );
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.get('tdd')).toMatchObject({ category: 'quality', description: 'TDD workflow', requiresMcp: ['python-exec'] });
    expect(map.get('review')).toMatchObject({ category: 'quality', triggers: ['review'] });
    expect(map.has('missing')).toBe(false);
  });

  it('returns empty map on missing / invalid manifest', async () => {
    tmpdirs(skillsSource);
    expect((await parseManifestSkillMeta(skillsSource)).size).toBe(0);
    writeFileSync(join(skillsSource, 'manifest.yaml'), 'not: [valid\n');
    expect((await parseManifestSkillMeta(skillsSource)).size).toBe(0);
  });

  it('skips entries with no meaningful data', async () => {
    tmpdirs(skillsSource);
    writeFileSync(join(skillsSource, 'manifest.yaml'), 'skills:\n  ghost:\n    category: ""\n');
    const map = await parseManifestSkillMeta(skillsSource);
    expect(map.has('ghost')).toBe(false);
  });
});

// ────────────────────────── resolveSkillMcpStatuses ──────────────────────────

describe('resolveSkillMcpStatuses', () => {
  it('classifies declared requires_mcp dependencies from capabilities config', async () => {
    tmpdirs(projectRoot);
    const capDir = join(projectRoot, '.cat-cafe');
    mkdirSync(capDir, { recursive: true });
    writeFileSync(
      join(capDir, 'capabilities.json'),
      JSON.stringify({
        version: 2,
        capabilities: [
          {
            id: 'python-exec',
            type: 'mcp',
            enabled: true,
            source: 'cat-cafe',
            mcpServer: { command: 'python', transport: 'stdio', resolver: 'resolve-python' },
          },
        ],
      }),
    );
    const meta = new Map<string, SkillMeta>([
      ['tdd', { requiresMcp: ['python-exec'] }],
      ['solo', { requiresMcp: ['ghost-mcp'] }],
    ]);
    const statuses = await resolveSkillMcpStatuses(projectRoot, meta);
    // python-exec 声明但无注册 resolver → unresolved（幂等、不抛）
    expect(statuses.get('python-exec')?.status).toBe('unresolved');
    // 未声明 MCP → missing
    expect(statuses.get('ghost-mcp')?.status).toBe('missing');
  });

  it('returns empty map when nothing requires mcp', async () => {
    tmpdirs(projectRoot);
    expect((await resolveSkillMcpStatuses(projectRoot, new Map())).size).toBe(0);
  });
});

// ────────────────────────── listSkills / querySkill ──────────────────────────

describe('listSkills / querySkill', () => {
  it('lists only cat-cafe skills honoring enable + mount state', async () => {
    tmpdirs(projectRoot);
    const capDir = join(projectRoot, '.cat-cafe');
    mkdirSync(capDir, { recursive: true });
    writeFileSync(
      join(capDir, 'capabilities.json'),
      JSON.stringify({
        version: 2,
        capabilities: [
          { id: 'tdd', type: 'skill', source: 'cat-cafe', enabled: true, mountPaths: ['claude'] },
          { id: 'glc', type: 'skill', source: 'cat-cafe', globalEnabled: false, mounted: false },
          { id: 'mysql', type: 'mcp', source: 'cat-cafe', enabled: true },
        ],
      }),
    );
    const skills = await listSkills(projectRoot);
    expect(skills.map((s) => s.id)).toEqual(['tdd', 'glc']);
    expect(skills[0]!.enabled).toBe(true);
    expect(skills[1]!.enabled).toBe(false);
    expect(skills[0]!.mountPaths).toEqual(['claude']);
  });

  it('querySkill combines config + SKILL.md + manifest metadata', async () => {
    tmpdirs(projectRoot);
    const capDir = join(projectRoot, '.cat-cafe');
    mkdirSync(capDir, { recursive: true });
    writeFileSync(
      join(capDir, 'capabilities.json'),
      JSON.stringify({
        version: 2,
        capabilities: [
          { id: 'tdd', type: 'skill', source: 'cat-cafe', enabled: true, mountPaths: ['claude'] },
        ],
      }),
    );
    writeFileSync(
      join(skillsSource, 'manifest.yaml'),
      `skills:\n  tdd:\n    category: quality\n    description: TDD workflow\n`,
    );
    writeSkill('tdd', `---\ndescription: fallback desc\n---\nbody\n`);

    const detail = await querySkill(projectRoot, 'tdd', skillsSource);
    expect(detail?.id).toBe('tdd');
    expect(detail?.enabled).toBe(true);
    expect(detail?.category).toBe('quality');
    expect(detail?.description).toBe('TDD workflow'); // manifest 优先于 SKILL.md
  });

  it('querySkill returns null when skill not in config or source', async () => {
    tmpdirs(projectRoot);
    expect(await querySkill(projectRoot, 'ghost', skillsSource)).toBeNull();
  });
});