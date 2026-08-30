/**
 * commands 插件包测试 — C33（F142 Phase B）。
 *
 * 覆盖：CommandRegistry core/skill 聚合 + 冲突拒绝（精确名 + 子命令展开）+
 * surface 过滤 + has/get；manifest.yaml slashCommands 解析（合法/非法/缺失）；
 * Cordis 插件挂载 ctx.forgeCommands。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import type { SlashCommandDefinition } from '@flowforge/cats-shared';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeCommandsService, {
  CommandRegistry,
  parseManifestSlashCommands,
} from '../src/index.ts';

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-infra-cmd-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const CORE: SlashCommandDefinition[] = [
  {
    name: '/help',
    usage: '/help',
    description: '帮助',
    category: 'system',
    surface: 'both',
    source: 'core',
  },
  {
    name: '/config',
    usage: '/config set <key> <value>',
    description: '配置',
    category: 'system',
    surface: 'web',
    source: 'core',
    subcommands: ['set', 'get'],
  },
];

describe('CommandRegistry', () => {
  it('core 聚合 + skill 登记成功 + surface 过滤 + has/get', () => {
    const warns: string[] = [];
    const reg = new CommandRegistry(CORE);
    reg.registerSkillCommands(
      'code-review',
      [
        {
          name: '/review',
          usage: '/review',
          description: '代码审查',
          category: 'skill',
          surface: 'connector',
          source: 'skill',
        },
      ],
      { warn: (m) => warns.push(m) },
    );
    expect(warns.length).toBe(0);
    expect(reg.has('/review')).toBe(true);
    expect(reg.get('/review')?.skillId).toBe('code-review');
    expect(reg.listBySurface('web').map((c) => c.name)).toContain('/help');
    expect(reg.listBySurface('web').map((c) => c.name)).not.toContain('/review');
    expect(reg.listBySurface('connector').map((c) => c.name)).toContain('/review');
  });

  it('精确名冲突 → 拒绝（core 优先）', () => {
    const warns: string[] = [];
    const reg = new CommandRegistry(CORE);
    reg.registerSkillCommands(
      'evil',
      [{ name: '/help', usage: '/help', description: 'x', category: 'c', surface: 'both', source: 'skill' }],
      { warn: (m) => warns.push(m) },
    );
    expect(warns[0]).toContain('conflicts with core command');
    expect(reg.get('/help')?.source).toBe('core');
  });

  it('子命令展开形式与已有 flat 名冲突 → 拒绝整条', () => {
    const warns: string[] = [];
    const reg = new CommandRegistry([
      { name: '/config set', usage: '/config set', description: 'x', category: 'c', surface: 'both', source: 'core' },
    ]);
    reg.registerSkillCommands(
      'skill-a',
      [
        {
          name: '/config',
          usage: '/config',
          description: 'x',
          category: 'c',
          surface: 'both',
          source: 'skill',
          subcommands: ['set', 'get'],
        },
      ],
      { warn: (m) => warns.push(m) },
    );
    expect(warns.some((m) => m.includes('subcommand "/config set" conflicts'))).toBe(true);
    expect(reg.has('/config')).toBe(false);
  });
});

describe('parseManifestSlashCommands', () => {
  it('解析合法/非法/缺失 manifest', async () => {
    const dir = makeTempRoot();
    writeFileSync(
      join(dir, 'manifest.yaml'),
      `skills:
  code-review:
    description: 代码审查
    slashCommands:
      - name: /review
        usage: /review
        description: 触发审查
        category: skill
        surface: connector
      - name: bad
        usage: bad
        description: 非法（缺 surface）
        category: skill
  empty-skill:
    description: 无 slash 命令
`,
      'utf-8',
    );
    const result = await parseManifestSlashCommands(dir);
    expect(result.size).toBe(1);
    expect(result.has('code-review')).toBe(true);
    const cmds = result.get('code-review')!;
    expect(cmds.length).toBe(1);
    expect(cmds[0]?.name).toBe('/review');
  });

  it('manifest 缺失 → 空 Map', async () => {
    const dir = makeTempRoot();
    const result = await parseManifestSlashCommands(dir);
    expect(result.size).toBe(0);
  });
});

describe('ForgeCommandsService（Cordis 插件）', () => {
  it('挂载 ctx.forgeCommands + registerSkillCommands + listBySurface', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeCommandsService, {
      coreCommands: CORE,
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeCommands;
    expect(svc).toBeDefined();
    expect(svc.coreCommandCount).toBe(2);

    svc.registerSkillCommands('code-review', [
      {
        name: '/review',
        usage: '/review',
        description: '审查',
        category: 'skill',
        surface: 'connector',
        source: 'skill',
      },
    ]);
    expect(svc.has('/review')).toBe(true);
    expect(svc.listBySurface('connector').map((c) => c.name)).toContain('/review');
    expect(svc.getAll().length).toBe(3);
  });
});
