/**
 * ExternalAgentAdapter — T7.9 外部 Agent 适配器核心验证。
 *
 * 覆盖：
 * - DEFAULT_CONFIGS 六种 kind 完整性
 * - isAvailable 二进制探测（注入 resolver）
 * - invoke：argv 组装（[binary, ...extraArgs, --prompt, prompt]）、env 透传
 * - 未安装 / 超时 / 非零退出码 → ExternalAgentError
 * - defaultSpawn 真实验证（node 子进程）
 * - loadAdaptersFromConfig 覆盖合并 + 空回退
 *
 * @module @flowforge/forgekin-external-agents/tests
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDefaultAdapters,
  DEFAULT_CONFIGS,
  defaultSpawn,
  ExternalAgentAdapter,
  ExternalAgentError,
  ExternalAgentKind,
  findInPath,
  loadAdaptersFromConfig,
} from '../src/external-agent.js';

/** 记录 spawn 调用的假执行器 */
function fakeSpawn(records: { args: string[]; options: unknown }[]) {
  return async (args: string[], options: unknown): Promise<string> => {
    records.push({ args, options });
    return 'fake stdout';
  };
}

afterEach(() => {
  // 还原可能被污染的 PATH（findInPath 只读，无需还原）
});

describe('DEFAULT_CONFIGS 默认配置', () => {
  it('五种内置 kind 齐全（custom 不在默认集），binary 对齐 Python DEFAULT_CONFIGS', () => {
    expect(Object.keys(DEFAULT_CONFIGS)).toEqual([
      'claude_code', 'codex', 'gemini', 'opencode', 'trae',
    ]);
    expect(DEFAULT_CONFIGS[ExternalAgentKind.CLAUDE_CODE]!.binary).toBe('claude');
    expect(DEFAULT_CONFIGS[ExternalAgentKind.CODEX]!.binary).toBe('codex');
    expect(DEFAULT_CONFIGS[ExternalAgentKind.GEMINI]!.binary).toBe('gemini');
    expect(DEFAULT_CONFIGS[ExternalAgentKind.OPENCODE]!.binary).toBe('opencode');
    expect(DEFAULT_CONFIGS[ExternalAgentKind.TRAE]!.binary).toBe('trae');
    expect(DEFAULT_CONFIGS[ExternalAgentKind.CUSTOM]).toBeUndefined();
  });
});

describe('findInPath / isAvailable', () => {
  it('findInPath 找到 node 可执行文件（自身进程）', () => {
    const resolved = findInPath('node');
    expect(resolved).toBeTruthy();
  });

  it('findInPath 未找到 → null', () => {
    expect(findInPath('__definitely_not_a_binary_xyz__')).toBeNull();
  });

  it('isAvailable 委托 resolver（注入）', () => {
    const adapter = new ExternalAgentAdapter(DEFAULT_CONFIGS[ExternalAgentKind.CODEX]!, {
      resolveBinary: (binary) => (binary === 'codex' ? '/usr/bin/codex' : null),
    });
    expect(adapter.isAvailable()).toBe(true);
  });

  it('isAvailable 未安装 → false', () => {
    const adapter = new ExternalAgentAdapter({ kind: ExternalAgentKind.CODEX, binary: 'codex' }, {
      resolveBinary: () => null,
    });
    expect(adapter.isAvailable()).toBe(false);
  });
});

describe('invoke argv 组装与错误', () => {
  it('argv = [binary, ...extraArgs, --prompt, prompt]，env 透传，超时换算毫秒', async () => {
    const records: { args: string[]; options: unknown }[] = [];
    const adapter = new ExternalAgentAdapter({
      kind: ExternalAgentKind.CLAUDE_CODE,
      binary: 'claude',
      env: { ANTHROPIC_API_KEY: 'sk-xxx' },
      defaultTimeout: 60,
    }, {
      resolveBinary: () => '/usr/bin/claude',
      spawnFn: fakeSpawn(records),
    });
    const out = await adapter.invoke('写一个插件', {
      cwd: '/tmp/w',
      timeout: 30,
      extraArgs: ['--dangerously-skip-permissions'],
    });
    expect(out).toBe('fake stdout');
    expect(records).toHaveLength(1);
    expect(records[0]!.args).toEqual([
      'claude', '--dangerously-skip-permissions', '--prompt', '写一个插件',
    ]);
    expect(records[0]!.options).toEqual({
      cwd: '/tmp/w',
      env: { ANTHROPIC_API_KEY: 'sk-xxx' },
      timeoutMs: 30_000,
    });
  });

  it('无 extraArgs → argv = [binary, --prompt, prompt]；timeout 缺省用 defaultTimeout', async () => {
    const records: { args: string[]; options: unknown }[] = [];
    const adapter = new ExternalAgentAdapter({
      kind: ExternalAgentKind.TRAE,
      binary: 'trae',
      defaultTimeout: 120,
    }, {
      resolveBinary: () => '/usr/bin/trae',
      spawnFn: fakeSpawn(records),
    });
    await adapter.invoke('hi');
    expect(records[0]!.args).toEqual(['trae', '--prompt', 'hi']);
    expect((records[0]!.options as { timeoutMs: number }).timeoutMs).toBe(120_000);
  });

  it('二进制未安装 → ExternalAgentError（kind/binary 信息）', async () => {
    const adapter = new ExternalAgentAdapter(DEFAULT_CONFIGS[ExternalAgentKind.OPENCODE]!, {
      resolveBinary: () => null,
    });
    await expect(adapter.invoke('hi')).rejects.toThrow(ExternalAgentError);
    await expect(adapter.invoke('hi')).rejects.toThrow(/not found in PATH/);
  });

  it('执行器拒绝（超时/退出码）→ 原样透传 ExternalAgentError', async () => {
    const adapter = new ExternalAgentAdapter(DEFAULT_CONFIGS[ExternalAgentKind.CODEX]!, {
      resolveBinary: () => '/usr/bin/codex',
      spawnFn: async () => {
        throw new ExternalAgentError('External agent codex timed out after 60s');
      },
    });
    await expect(adapter.invoke('hi')).rejects.toThrow(/timed out/);
  });

  it('spawnFn 抛非 ExternalAgentError → 原样上抛', async () => {
    const adapter = new ExternalAgentAdapter(DEFAULT_CONFIGS[ExternalAgentKind.CODEX]!, {
      resolveBinary: () => '/usr/bin/codex',
      spawnFn: async () => {
        throw new Error('boom');
      },
    });
    await expect(adapter.invoke('hi')).rejects.toThrow('boom');
  });
});

describe('defaultSpawn 真实子进程', () => {
  it('成功：返回 stdout（node -e 输出）', async () => {
    const out = await defaultSpawn([process.execPath, '-e', 'console.log("hello-from-agent")'], {
      timeoutMs: 10_000,
    });
    expect(out).toContain('hello-from-agent');
  });

  it('非零退出码 → ExternalAgentError 含 stderr 前 200 字符', async () => {
    await expect(defaultSpawn(
      [process.execPath, '-e', 'console.error("bad input"); process.exit(3)'],
      { timeoutMs: 10_000 },
    )).rejects.toThrow(ExternalAgentError);
    await expect(defaultSpawn(
      [process.execPath, '-e', 'console.error("bad input"); process.exit(3)'],
      { timeoutMs: 10_000 },
    )).rejects.toThrow(/exited with 3: bad input/);
  });
});

describe('buildDefaultAdapters / loadAdaptersFromConfig', () => {
  it('buildDefaultAdapters 五种内置 kind 齐全', () => {
    const adapters = buildDefaultAdapters({ resolveBinary: () => null });
    expect(adapters.size).toBe(5);
    expect(adapters.get(ExternalAgentKind.CLAUDE_CODE)?.config.binary).toBe('claude');
  });

  it('配置无 external_agents 段或为空 → 回退默认', () => {
    expect(loadAdaptersFromConfig({}).size).toBe(5);
    expect(loadAdaptersFromConfig({ external_agents: {} }).size).toBe(5);
    expect(loadAdaptersFromConfig({ other: 1 }).get(ExternalAgentKind.CODEX)?.config.binary).toBe('codex');
  });

  it('覆盖合并：binary / description / default_timeout 替换，env 叠加', () => {
    const adapters = loadAdaptersFromConfig({
      external_agents: {
        claude_code: {
          binary: 'claude-pro',
          env: { ANTHROPIC_API_KEY: 'sk-1', EXTRA: 'x' },
        },
        codex: { default_timeout: 300 },
      },
    });
    const claude = adapters.get(ExternalAgentKind.CLAUDE_CODE)!;
    expect(claude.config.binary).toBe('claude-pro');
    expect(claude.config.env).toEqual({ ANTHROPIC_API_KEY: 'sk-1', EXTRA: 'x' });
    const codex = adapters.get(ExternalAgentKind.CODEX)!;
    expect(codex.config.defaultTimeout).toBe(300);
    expect(codex.config.binary).toBe('codex');
  });

  it('连字符键（claude-code）同样可覆盖', () => {
    const adapters = loadAdaptersFromConfig({
      external_agents: { 'claude-code': { binary: 'claude-hyphen' } },
    });
    expect(adapters.get(ExternalAgentKind.CLAUDE_CODE)?.config.binary).toBe('claude-hyphen');
  });
});
