/**
 * cats-bootcamp 测试 — C8（blocks + env-check + workspace-root + Service）。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import BootcampService, {
  BOOTCAMP_BLOCKS,
  catSelectionBlock,
  resolveBootcampWorkspaceRoot,
  resolveDefaultBootcampWorkspaceRoot,
  runEnvironmentCheck,
  taskSelectionBlock,
  type EnvCheckResult,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];

afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('BOOTCAMP_BLOCKS', () => {
  it('包含猫选择与任务选择两个块', () => {
    expect(Object.keys(BOOTCAMP_BLOCKS).sort()).toEqual(['bootcamp-cat-select', 'bootcamp-task-select']);
    expect(catSelectionBlock.options).toHaveLength(3);
    expect(catSelectionBlock.options[0]?.id).toBe('opus');
    expect(taskSelectionBlock.options).toHaveLength(16);
    // 分层校验
    const level1 = taskSelectionBlock.options.filter((option) => option.level === 1);
    const level3 = taskSelectionBlock.options.filter((option) => option.level === 3);
    expect(level1.length).toBeGreaterThan(0);
    expect(level3).toHaveLength(2);
  });
});

describe('runEnvironmentCheck', () => {
  const allOkResult: EnvCheckResult = {
    node: { ok: true, version: 'v22.0.0' },
    pnpm: { ok: true, version: '11.7.0' },
    git: { ok: true, version: 'git version 2.40.0' },
    claudeCli: { ok: true, version: '1.0.0' },
    codexCli: { ok: false },
    geminiCli: { ok: false },
    kimiCli: { ok: false },
    mcp: { ok: true, note: 'MCP server found: /x/mcp' },
    tts: { ok: false, recommended: 'Kokoro-82M (轻量推荐): mlx-community/Kokoro-82M-bf16' },
    asr: { ok: false },
    pencil: { ok: false, note: '需要 Antigravity IDE + Pencil 扩展' },
  };

  it('注入命令/端口探测与 mcp 路径', async () => {
    const execCommand = async (cmd: string) => {
      if (cmd === 'node --version') return { ok: true as const, version: 'v22.0.0' };
      if (cmd === 'pnpm --version') return { ok: true as const, version: '11.7.0' };
      if (cmd === 'git --version') return { ok: true as const, version: 'git version 2.40.0' };
      if (cmd === 'claude --version') return { ok: true as const, version: '1.0.0' };
      return { ok: false as const };
    };
    const result = await runEnvironmentCheck({
      execCommand,
      checkPort: async () => false,
      mcpServerPath: '/x/mcp',
      env: {}, // 避免继承 pnpm 运行环境的 npm_config_user_agent
    });
    expect(result.node).toEqual({ ok: true, version: 'v22.0.0' });
    expect(result.pnpm.version).toBe('11.7.0');
    expect(result.claudeCli.ok).toBe(true);
    expect(result.codexCli.ok).toBe(false);
    expect(result.mcp.ok).toBe(true);
    expect(result.tts.ok).toBe(false);
    expect(result.pencil.ok).toBe(false);
    expect(result).toEqual(allOkResult);
  });

  it('pnpm 从 npm_config_user_agent 识别', async () => {
    const result = await runEnvironmentCheck({
      execCommand: async () => ({ ok: false }),
      checkPort: async () => false,
      mcpServerPath: null,
      env: { npm_config_user_agent: 'pnpm/9.1.0 npm/? node/v22' },
    });
    expect(result.pnpm.ok).toBe(true);
    expect(result.pnpm.version).toBe('9.1.0');
  });
});

describe('resolveDefaultBootcampWorkspaceRoot', () => {
  it('CAT_CAFE_WORKSPACE_ROOT 优先；runtime 模式下不回落 cwd', () => {
    expect(
      resolveDefaultBootcampWorkspaceRoot({ CAT_CAFE_WORKSPACE_ROOT: ' /work ' }, '/cwd'),
    ).toBe('/work');
    expect(resolveDefaultBootcampWorkspaceRoot({ FF_BOOTCAMP_WORKSPACE_ROOT: '/ff-work' }, '/cwd')).toBe('/ff-work');
    expect(
      resolveDefaultBootcampWorkspaceRoot({ CAT_CAFE_RUNTIME_ROOT: '/runtime' }, '/cwd'),
    ).toBeNull();
    expect(resolveDefaultBootcampWorkspaceRoot({}, '/cwd')).toBe('/cwd');
  });
});

describe('resolveBootcampWorkspaceRoot', () => {
  it('配置 + 校验通过 → projectPath', async () => {
    const resolution = await resolveBootcampWorkspaceRoot({
      env: { CAT_CAFE_WORKSPACE_ROOT: '/work' },
      validateProjectPath: async (candidate) => (candidate === '/work' ? '/work' : null),
    });
    expect(resolution).toEqual({ ok: true, projectPath: '/work' });
  });

  it('runtime 模式未配置 → 拒绝；校验失败 → invalid', async () => {
    const runtime = await resolveBootcampWorkspaceRoot({
      env: { CAT_CAFE_RUNTIME_ROOT: '/runtime' },
    });
    expect(runtime.ok).toBe(false);

    const invalid = await resolveBootcampWorkspaceRoot({
      env: { CAT_CAFE_WORKSPACE_ROOT: '/bad' },
      validateProjectPath: async () => null,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toContain('invalid');
  });
});

describe('BootcampService（Cordis 插件）', () => {
  it('挂载 ctx.catsBootcamp + blocks + envCheck + workspaceRoot', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(BootcampService, {
      envCheckDeps: {
        execCommand: async () => ({ ok: true }),
        checkPort: async () => false,
        mcpServerPath: '/mcp',
      },
      workspaceRootOptions: { env: { CAT_CAFE_WORKSPACE_ROOT: '/work' }, validateProjectPath: async (c) => c },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.catsBootcamp;
    expect(svc).toBeDefined();
    expect(svc.getBlock('bootcamp-cat-select')?.interactiveType).toBe('card-grid');
    expect(svc.listBlocks()).toHaveLength(2);

    const check = await svc.envCheck();
    expect(check.node.ok).toBe(true);

    const root = await svc.workspaceRoot();
    expect(root.ok).toBe(true);
    if (root.ok) expect(root.projectPath).toBe('/work');
  });
});
