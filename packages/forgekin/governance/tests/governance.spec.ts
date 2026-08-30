/**
 * governance 插件包测试 — C34b（F070 可移植治理包）。
 *
 * 覆盖：托管块生成 / checksum 幂等 / GovernanceRegistry 登记与健康 /
 * preflight 三态闸门 / mission-pack 构建与渲染 / 执行摘要捕获 /
 * skill 名校验与 mount 路径级联 / 项目枚举 / Cordis 插件挂载 +
 * bootstrapProject 端到端（dryRun → 正式 → preflight ready）。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeGovernanceService, {
  GOVERNANCE_PACK_VERSION,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  GovernanceRegistry,
  buildMissionPack,
  captureExecutionDigest,
  checkGovernancePreflight,
  computePackChecksum,
  formatMissionPackPrompt,
  getGovernanceManagedBlock,
  getMethodologyTemplates,
  isValidSkillName,
  listAllProjectPaths,
  pathsEqual,
  resolveEffectiveSkillMountPaths,
  validateSkillName,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// 临时目录 / fiber 清理
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-governance-'));
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

// ---------------------------------------------------------------------------
// 纯函数：governance-pack
// ---------------------------------------------------------------------------

describe('governance-pack', () => {
  it('托管块包含起止标记 + 版本 + provider', () => {
    const block = getGovernanceManagedBlock('claude', 'external');
    expect(block.startsWith(MANAGED_BLOCK_START)).toBe(true);
    expect(block.endsWith(MANAGED_BLOCK_END)).toBe(true);
    expect(block).toContain(`Pack version: ${GOVERNANCE_PACK_VERSION} | Provider: claude`);
    expect(block).toContain('No self-review');
  });

  it('checksum 稳定且随 context 变化', () => {
    const a = computePackChecksum('external');
    const b = computePackChecksum('external');
    const self = computePackChecksum('self');
    expect(a).toBe(b);
    expect(a).not.toBe(self);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// GovernanceRegistry
// ---------------------------------------------------------------------------

describe('GovernanceRegistry', () => {
  it('register → get/listAll + checkHealth 三态', async () => {
    const hub = makeTempRoot();
    const registry = new GovernanceRegistry(hub);
    const projectA = join(hub, 'projects', 'a');
    mkdirSync(projectA, { recursive: true });

    // never-synced
    const before = await registry.checkHealth(projectA);
    expect(before.status).toBe('never-synced');

    // 登记（confirmed）
    await registry.register(projectA, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'abc123',
      syncedAt: 1_000,
      confirmedByUser: true,
    });
    const entry = await registry.get(projectA);
    expect(entry?.packVersion).toBe(GOVERNANCE_PACK_VERSION);
    expect(entry?.confirmedByUser).toBe(true);

    const healthy = await registry.checkHealth(projectA);
    expect(healthy.status).toBe('healthy');

    // stale：登记版本落后当前包版本
    await registry.register(projectA, {
      packVersion: '0.0.1',
      checksum: 'abc123',
      syncedAt: 2_000,
      confirmedByUser: true,
    });
    const stale = await registry.checkHealth(projectA, GOVERNANCE_PACK_VERSION);
    expect(stale.status).toBe('stale');

    const all = await registry.listAll();
    expect(all.length).toBe(1);
    expect(all[0]?.projectPath).toBe(projectA);
  });

  it('win32 路径大小写不敏感比较', () => {
    const platform = process.platform === 'win32' ? process.platform : 'win32';
    expect(pathsEqual('C:\\A\\B', 'c:\\a\\b', platform)).toBe(true);
    expect(pathsEqual('/a/b', '/a/b', 'linux')).toBe(true);
    expect(pathsEqual('/a/b', '/a/c', 'linux')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// preflight 三态闸门
// ---------------------------------------------------------------------------

describe('checkGovernancePreflight', () => {
  it('hub 自身 → ready', async () => {
    const hub = makeTempRoot();
    const result = await checkGovernancePreflight(hub, hub);
    expect(result.ready).toBe(true);
  });

  it('未登记项目 → needsBootstrap（可行动提示）', async () => {
    const hub = makeTempRoot();
    const project = makeTempRoot();
    const result = await checkGovernancePreflight(project, hub);
    expect(result.ready).toBe(false);
    expect(result.needsBootstrap).toBe(true);
    expect(result.bootstrapCommand).toContain('forgeGovernance.bootstrap');
  });

  it('已登记未确认 → needsConfirmation；确认 + 托管块存在 → ready', async () => {
    const hub = makeTempRoot();
    const project = makeTempRoot();

    await new GovernanceRegistry(hub).register(project, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'abc',
      syncedAt: 1,
      confirmedByUser: false,
    });
    const unconfirmed = await checkGovernancePreflight(project, hub);
    expect(unconfirmed.ready).toBe(false);
    expect(unconfirmed.needsConfirmation).toBe(true);

    // 确认 + 写入托管块
    await new GovernanceRegistry(hub).register(project, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'abc',
      syncedAt: 2,
      confirmedByUser: true,
    });
    const block = getGovernanceManagedBlock('claude', 'external');
    writeFileSync(join(project, 'CLAUDE.md'), `# Instructions\n\n${block}\n`, 'utf-8');
    const ready = await checkGovernancePreflight(project, hub, 'anthropic');
    expect(ready.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mission-pack / execution-digest
// ---------------------------------------------------------------------------

describe('mission-pack', () => {
  it('无具体任务内容（仅 phase）→ null', () => {
    expect(buildMissionPack({ phase: 'dev' })).toBeNull();
    expect(buildMissionPack({})).toBeNull();
  });

  it('title/backlogItemId 构建任务包 + 默认渲染含 mission/workItem', () => {
    const pack = buildMissionPack({ title: '重构配置加载', backlogItemId: 'BK-42', phase: 'dev' });
    expect(pack).not.toBeNull();
    expect(pack!.mission).toBe('重构配置加载');
    expect(pack!.workItem).toBe('BK-42');
    expect(pack!.phase).toBe('dev');

    const prompt = formatMissionPackPrompt(pack!);
    expect(prompt).toContain('重构配置加载');
    expect(prompt).toContain('BK-42');
  });

  it('注入式 renderer 替换默认渲染', () => {
    const pack = buildMissionPack({ title: '任务A' })!;
    const custom = formatMissionPackPrompt(pack, (vars) => `[${vars.MISSION}]`);
    expect(custom).toBe('[任务A]');
  });
});

describe('captureExecutionDigest', () => {
  const captureCtx = { projectPath: '/p', threadId: 't1', catId: 'cat-a', userId: 'u1' };
  const missionPack = {
    mission: 'm',
    workItem: 'w',
    phase: 'dev',
    doneWhen: ['测试通过', '文档更新'],
    links: [],
  };

  it('完成 → completed + doneWhen 全 met', () => {
    const digest = captureExecutionDigest(missionPack, { summary: 'done', filesChanged: ['a.ts'], blocked: false, hadError: false }, captureCtx);
    expect(digest.status).toBe('completed');
    expect(digest.doneWhenResults.every((d) => d.met)).toBe(true);
  });

  it('阻塞 → blocked；出错 → partial', () => {
    expect(captureExecutionDigest(missionPack, { summary: 's', filesChanged: [], blocked: true, hadError: false }, captureCtx).status).toBe('blocked');
    expect(captureExecutionDigest(missionPack, { summary: 's', filesChanged: [], blocked: false, hadError: true }, captureCtx).status).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// skill-sync / methodology-templates
// ---------------------------------------------------------------------------

describe('skill-sync 纯工具', () => {
  it('技能名校验：合法/非法', () => {
    expect(isValidSkillName('code-review')).toBe(true);
    expect(isValidSkillName('a')).toBe(true);
    expect(isValidSkillName('Bad-Name')).toBe(false);
    expect(isValidSkillName('../escape')).toBe(false);
    expect(() => validateSkillName('BAD NAME')).toThrow(/Invalid skill name/);
  });

  it('mount 路径级联：project > global > undefined', () => {
    expect(resolveEffectiveSkillMountPaths(['a'], ['b'])).toEqual(['a']);
    expect(resolveEffectiveSkillMountPaths(undefined, ['b'])).toEqual(['b']);
    expect(resolveEffectiveSkillMountPaths(undefined, undefined)).toBeUndefined();
  });
});

describe('methodology-templates', () => {
  it('6 个模板 + 日期占位已填充', () => {
    const templates = getMethodologyTemplates();
    expect(templates.length).toBe(6);
    const paths = templates.map((t) => t.relativePath);
    expect(paths).toContain('BACKLOG.md');
    expect(paths).toContain('docs/SOP.md');
    expect(paths).toContain('docs/features/TEMPLATE.md');
    const feature = templates.find((t) => t.relativePath === 'docs/features/TEMPLATE.md');
    expect(feature?.content).not.toContain('{{DATE}}');
    expect(feature?.content).toContain('## Acceptance Criteria');
  });
});

// ---------------------------------------------------------------------------
// list-all-projects
// ---------------------------------------------------------------------------

describe('listAllProjectPaths', () => {
  it('登记项 + 嵌套 .cat-cafe 扫描，排除 hub 自身', async () => {
    const hub = makeTempRoot();
    // 注册表内项目
    const registered = makeTempRoot();
    await new GovernanceRegistry(hub).register(registered, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'x',
      syncedAt: 1,
      confirmedByUser: true,
    });
    // 嵌套 thread-derived 项目
    const nested = join(hub, 'packages', 'api');
    mkdirSync(join(nested, '.cat-cafe'), { recursive: true });
    writeFileSync(join(nested, '.cat-cafe', 'capabilities.json'), '{}', 'utf-8');
    // 无 capabilities.json 的 .cat-cafe 不算
    const orphan = join(hub, 'misc');
    mkdirSync(join(orphan, '.cat-cafe'), { recursive: true });

    const projects = await listAllProjectPaths(hub);
    expect(projects.map((p) => p.toLowerCase())).toContain(registered.toLowerCase());
    expect(projects.map((p) => p.toLowerCase())).toContain(nested.toLowerCase());
    expect(projects.map((p) => p.toLowerCase())).not.toContain(orphan.toLowerCase());
    expect(projects.map((p) => p.toLowerCase())).not.toContain(hub.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Cordis 插件 + bootstrapProject 端到端
// ---------------------------------------------------------------------------

describe('ForgeGovernanceService（Cordis 插件）', () => {
  it('挂载 ctx.forgeGovernance + bootstrap dryRun → 正式 → preflight ready', async () => {
    const hub = makeTempRoot();
    // hub 内准备 skills 源（两个技能）
    mkdirSync(join(hub, 'cat-cafe-skills', 'code-review'), { recursive: true });
    writeFileSync(join(hub, 'cat-cafe-skills', 'code-review', 'SKILL.md'), '# code-review', 'utf-8');
    mkdirSync(join(hub, 'cat-cafe-skills', 'doc-writer'), { recursive: true });
    writeFileSync(join(hub, 'cat-cafe-skills', 'doc-writer', 'SKILL.md'), '# doc-writer', 'utf-8');

    const project = makeTempRoot();
    // 项目已有 AGENTS.md 内容，托管块应追加而非覆盖
    writeFileSync(join(project, 'AGENTS.md'), '# Existing\n', 'utf-8');

    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeGovernanceService, { hubRoot: hub })) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);

    const svc = ctx.forgeGovernance;
    expect(svc).toBeDefined();
    expect(svc.hubRoot).toBe(hub);

    // 1) dryRun：只产出报告，不落盘
    const dry = await svc.bootstrapProject(project, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.packVersion).toBe(GOVERNANCE_PACK_VERSION);
    const created = dry.actions.filter((a) => a.action === 'created');
    expect(created.length).toBeGreaterThan(0);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(false);

    // 2) 正式 bootstrap：托管块 + 方法论骨架 + skillsSync + 注册表
    const report = await svc.bootstrapProject(project, { dryRun: false });
    expect(report.actions.length).toBeGreaterThan(0);

    const claude = readFileSync(join(project, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain(MANAGED_BLOCK_START);
    expect(claude).toContain(MANAGED_BLOCK_END);
    const agents = readFileSync(join(project, 'AGENTS.md'), 'utf-8');
    expect(agents.startsWith('# Existing')).toBe(true);
    expect(agents).toContain(MANAGED_BLOCK_START);

    // 方法论骨架
    expect(existsSync(join(project, 'BACKLOG.md'))).toBe(true);
    expect(existsSync(join(project, 'docs', 'SOP.md'))).toBe(true);

    // skillsSync 已写入项目 capabilities.json
    const capPath = join(project, '.cat-cafe', 'capabilities.json');
    expect(existsSync(capPath)).toBe(true);
    const caps = JSON.parse(readFileSync(capPath, 'utf-8')) as { skillsSync?: { sourceManifestHash: string }; skillsMigrated?: number };
    expect(caps.skillsSync?.sourceManifestHash).toBeTruthy();

    // 3) preflight：bootstrap 登记后 → ready
    const pre = await svc.preflight(project, 'anthropic');
    expect(pre.ready).toBe(true);

    // 4) 注册表健康检查
    const health = await svc.registry.checkHealth(project);
    expect(health.status).toBe('healthy');
  });

  it('mount 规则生效：defaultMountRules 控制挂载点 + per-skill symlink', async () => {
    const hub = makeTempRoot();
    mkdirSync(join(hub, 'cat-cafe-skills', 'code-review'), { recursive: true });
    writeFileSync(join(hub, 'cat-cafe-skills', 'code-review', 'SKILL.md'), '# code-review', 'utf-8');

    const project = makeTempRoot();

    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeGovernanceService, {
      hubRoot: hub,
      deps: {
        // 注入式 mount 规则：只启用 claude 挂载点（F228 v2 条目格式）
        readMountRules: async (root) => {
          if (root === project) {
            return {
              version: 1,
              mountPoints: {
                claude: { enabled: true, path: '.claude/skills' },
                codex: { enabled: false, path: '.codex/skills' },
                gemini: { enabled: false, path: '.gemini/skills' },
                kimi: { enabled: false, path: '.kimi/skills' },
              },
              customPaths: [],
            };
          }
          return {
            version: 1,
            mountPoints: {
              claude: { enabled: true, path: '.claude/skills' },
              codex: { enabled: true, path: '.codex/skills' },
              gemini: { enabled: true, path: '.gemini/skills' },
              kimi: { enabled: true, path: '.kimi/skills' },
            },
            customPaths: [],
          };
        },
      },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    await ctx.forgeGovernance.bootstrapProject(project, { dryRun: false });

    // claude 挂载点存在 per-skill symlink
    const linkPath = join(project, '.claude', 'skills', 'code-review');
    expect(existsSync(linkPath)).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    // codex 挂载点被禁用 → 目录不存在
    expect(existsSync(join(project, '.codex', 'skills', 'code-review'))).toBe(false);
    // symlink 指向 hub skills 源（junction 在 win32 也可 readlink）
    expect(readlinkSync(linkPath)).toBeTruthy();
  });

  it('服务方法：listProjects / missionPack / captureDigest / methodologyTemplates', async () => {
    const hub = makeTempRoot();
    const nested = join(hub, 'workspace', 'app');
    mkdirSync(join(nested, '.cat-cafe'), { recursive: true });
    writeFileSync(join(nested, '.cat-cafe', 'capabilities.json'), '{}', 'utf-8');

    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeGovernanceService, { hubRoot: hub })) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);

    const svc = ctx.forgeGovernance;
    const projects = await svc.listProjects();
    expect(projects.map((p) => p.toLowerCase())).toContain(nested.toLowerCase());

    const pack = svc.missionPack({ title: '任务', backlogItemId: 'BK-1' });
    expect(pack).not.toBeNull();
    expect(svc.formatMissionPrompt(pack!)).toContain('任务');

    const digest = svc.captureDigest(
      pack!,
      { summary: '完成', filesChanged: [], blocked: false, hadError: false },
      { projectPath: nested, threadId: 't', catId: 'c', userId: 'u' },
    );
    expect(digest.status).toBe('completed');

    expect(svc.methodologyTemplates().length).toBe(6);
  });
});
