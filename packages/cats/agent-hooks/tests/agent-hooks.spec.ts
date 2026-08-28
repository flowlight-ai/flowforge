/**
 * C31 agent-hooks 包测试 — @flowforge/cats-agent-hooks。
 *
 * 覆盖：
 *  - ctx.plugin(CatsAgentHooks) → ctx.catsAgentHooks 挂载 + 服务方法
 *  - sync-targets：buildAgentHookTargets（4 目标）/ selectAgentHookTargets /
 *    canonicalJsonString / checkDrift（缺失/文本/JSON 语义）/ applySync
 *    （dryRun + 写入 + chmod）
 *  - claude-settings：claudeSettingsHealth 四态（missing/configured/stale/error）
 *    + syncClaudeSettings 保留用户 hooks
 *  - health：getAgentHookStatus / syncAgentHooks（mock AgentHookCapabilityProbes
 *    端口 + ownerAuthorized fail-closed）
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@flowforge/cordis';
import CatsAgentHooks, {
  CatsAgentHooksService,
  AGENT_HOOK_TARGET_NAMES,
  applySync,
  buildAgentHookTargets,
  canonicalJsonString,
  checkDrift,
  claudeSettingsHealth,
  getAgentHookStatus,
  renderCodexHooksJson,
  renderGeminiHooksJson,
  selectAgentHookTargets,
  syncAgentHooks,
  syncClaudeSettings,
  type AgentHookCapabilityProbes,
  type McpDriftLike,
  type SkillDriftContextLike,
  type SyncTarget,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withAgentHooks(): Promise<Context> {
  const ctx = new Context();
  const fiber = (await ctx.plugin(CatsAgentHooks)) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

const START_SCRIPT = `#!/usr/bin/env bash
# session-start-recall
echo "recall"
`;

const STOP_SCRIPT = `#!/usr/bin/env bash
# session-stop-check
echo "stop"
`;

/** 构造 projectRoot（含 user-level hook 模板源）与空 targetRoot。 */
async function makeRoots(): Promise<{ projectRoot: string; targetRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'ah-project-'));
  const hooksDir = join(projectRoot, '.claude', 'hooks', 'user-level');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(join(hooksDir, 'session-start-recall.sh'), START_SCRIPT, 'utf-8');
  await writeFile(join(hooksDir, 'session-stop-check.sh'), STOP_SCRIPT, 'utf-8');
  const targetRoot = await mkdtemp(join(tmpdir(), 'ah-target-'));
  return { projectRoot, targetRoot };
}

/** Mock AgentHookCapabilityProbes：默认无能力配置 / 无漂移。 */
function makeProbes(overrides: Partial<AgentHookCapabilityProbes> = {}): AgentHookCapabilityProbes {
  return {
    readCapabilitiesConfig: vi.fn((): unknown => null),
    checkMcpProject: vi.fn(async (): Promise<McpDriftLike> => ({ issues: [] })),
    syncMcpDrift: vi.fn(async (): Promise<void> => {}),
    computeSkillDrift: vi.fn(async (): Promise<SkillDriftContextLike | null> => null),
    syncDrift: vi.fn(async (): Promise<void> => {}),
    resolveStartupProjectRoot: vi.fn((): string => tmpdir()),
    ...overrides,
  };
}

describe('C31 CatsAgentHooksService — Cordis 服务生命周期', () => {
  it('mounts at ctx.catsAgentHooks after ctx.plugin(CatsAgentHooks)', async () => {
    const ctx = await withAgentHooks();
    expect(ctx.catsAgentHooks).toBeInstanceOf(CatsAgentHooksService);
  });

  it('服务方法：createSyncTargets / getStatus / sync', async () => {
    const ctx = await withAgentHooks();
    const svc = ctx.catsAgentHooks;
    const { projectRoot, targetRoot } = await makeRoots();
    const targets = svc.createSyncTargets({ projectRoot, targetRoot });
    expect(targets).toHaveLength(4);
    const probes = makeProbes();
    const status = await svc.getStatus({ projectRoot, targetRoot }, probes);
    expect(status.targets.length).toBeGreaterThanOrEqual(7);
    const synced = await svc.sync({ projectRoot, targetRoot }, probes);
    expect(typeof synced.status).toBe('string');
  });
});

describe('C31 sync-targets — 目标构建与选择', () => {
  it('buildAgentHookTargets 产出 4 个规范目标', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const targets = buildAgentHookTargets({ projectRoot, targetRoot });
    expect(targets.map((t) => t.name)).toEqual([...AGENT_HOOK_TARGET_NAMES]);
    const [sessionStart, sessionStop, codex, gemini] = targets;
    expect(sessionStart?.executable).toBe(true);
    expect(sessionStart?.targetPath).toBe(join(targetRoot, '.claude', 'hooks', 'session-start-recall.sh'));
    expect(sessionStop?.executable).toBe(true);
    expect(codex?.contentKind).toBe('json');
    expect(codex?.targetPath).toBe(join(targetRoot, '.codex', 'hooks.json'));
    expect(gemini?.targetPath).toBe(join(targetRoot, '.gemini', 'hooks.json'));
    // render() 从 projectRoot 的 user-level hooks 读取模板
    expect(sessionStart?.render()).toContain('session-start-recall');
    expect(codex?.render()).toContain('SessionStart');
  });

  it('selectAgentHookTargets 只保留规范名称目标', async () => {
    const stray: SyncTarget = {
      name: 'stray',
      render: () => 'x',
      targetPath: '/tmp/x',
    };
    const { projectRoot, targetRoot } = await makeRoots();
    const selected = selectAgentHookTargets([...buildAgentHookTargets({ projectRoot, targetRoot }), stray]);
    expect(selected).toHaveLength(4);
    expect(selected.some((t) => t.name === 'stray')).toBe(false);
  });

  it('canonicalJsonString 键排序规范化；语义相等判不漂移', () => {
    expect(canonicalJsonString('{"b":1,"a":2}')).toBe(canonicalJsonString('{"a":2,"b":1}'));
    expect(canonicalJsonString('{"a":{"z":1,"y":2}}')).toBe(canonicalJsonString('{"a":{"y":2,"z":1}}'));
  });

  it('renderCodexHooksJson / renderGeminiHooksJson 包含 bash 命令', () => {
    const root = join(tmpdir(), 'some-target');
    for (const rendered of [renderCodexHooksJson(root), renderGeminiHooksJson(root)]) {
      const parsed = JSON.parse(rendered) as { hooks: Record<string, unknown> };
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(rendered).toContain('session-start-recall.sh');
      const sessionStart = (parsed.hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>)[0];
      expect(sessionStart?.hooks[0]?.command.startsWith('bash ')).toBe(true);
    }
  });
});

describe('C31 sync-targets — checkDrift / applySync', () => {
  it('目标缺失 → drifted + reason；内容一致 → 不漂移', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const [target] = buildAgentHookTargets({ projectRoot, targetRoot });
    const missing = checkDrift(target!);
    expect(missing.drifted).toBe(true);
    expect(missing.reason).toBe('target file does not exist');

    await mkdir(join(targetRoot, '.claude', 'hooks'), { recursive: true });
    await writeFile(target!.targetPath, target!.render(), 'utf-8');
    const synced = checkDrift(target!);
    expect(synced.drifted).toBe(false);
  });

  it('JSON 语义相等 → 不漂移；文本差异 → 漂移', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const codex = buildAgentHookTargets({ projectRoot, targetRoot })[2]!;
    await mkdir(join(targetRoot, '.codex'), { recursive: true });
    // 键顺序不同但语义相同 → 不漂移
    const reordered = JSON.stringify(JSON.parse(codex.render()), null, 2) + '\n';
    await writeFile(codex.targetPath, reordered, 'utf-8');
    expect(checkDrift(codex).drifted).toBe(false);

    // 内容真的变了 → 漂移
    await writeFile(codex.targetPath, JSON.stringify({ hooks: {} }), 'utf-8');
    expect(checkDrift(codex).drifted).toBe(true);
  });

  it('applySync：dryRun 不写盘；正式写入 + 可执行位', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const [target] = buildAgentHookTargets({ projectRoot, targetRoot });
    applySync(target!, true);
    expect(await readFile(target!.targetPath, 'utf-8').catch(() => '')).toBe('');

    applySync(target!, false);
    expect(await readFile(target!.targetPath, 'utf-8')).toBe(target!.render());
    const mode = statSync(target!.targetPath).mode;
    if (process.platform !== 'win32') {
      expect(mode & 0o111).not.toBe(0);
    }
  });
});

describe('C31 claude-settings — 四态健康', () => {
  it('settings.json 缺失 → missing', async () => {
    const { targetRoot } = await makeRoots();
    const result = claudeSettingsHealth(targetRoot);
    expect(result.status).toBe('missing');
    expect(result.drifted).toBe(true);
    expect(result.targetPath).toBe(join(targetRoot, '.claude', 'settings.json'));
  });

  it('managed 命令带 bash 前缀 → configured', async () => {
    const { targetRoot } = await makeRoots();
    const settingsPath = join(targetRoot, '.claude', 'settings.json');
    await mkdir(join(targetRoot, '.claude'), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: `bash "${join(targetRoot, '.claude', 'hooks', 'session-start-recall.sh').replace(/\\/g, '/')}"` }] },
            ],
            Stop: [
              { hooks: [{ type: 'command', command: `bash "${join(targetRoot, '.claude', 'hooks', 'session-stop-check.sh').replace(/\\/g, '/')}"` }] },
            ],
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
    const result = claudeSettingsHealth(targetRoot);
    expect(result.status).toBe('configured');
    expect(result.drifted).toBe(false);
  });

  it('managed 命令缺 bash 前缀 → stale', async () => {
    const { targetRoot } = await makeRoots();
    const settingsPath = join(targetRoot, '.claude', 'settings.json');
    await mkdir(join(targetRoot, '.claude'), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: join(targetRoot, '.claude', 'hooks', 'session-start-recall.sh') }] }],
          Stop: [{ hooks: [{ type: 'command', command: join(targetRoot, '.claude', 'hooks', 'session-stop-check.sh') }] }],
        },
      }),
      'utf-8',
    );
    const result = claudeSettingsHealth(targetRoot);
    expect(result.status).toBe('stale');
    expect(result.reason).toContain('bash prefix');
  });

  it('损坏 JSON → error', async () => {
    const { targetRoot } = await makeRoots();
    const settingsPath = join(targetRoot, '.claude', 'settings.json');
    await mkdir(join(targetRoot, '.claude'), { recursive: true });
    await writeFile(settingsPath, '{not json', 'utf-8');
    const result = claudeSettingsHealth(targetRoot);
    expect(result.status).toBe('error');
  });
});

describe('C31 claude-settings — syncClaudeSettings 保留用户 hooks', () => {
  it('无文件 → 创建含两个 managed 事件的 settings.json', async () => {
    const { targetRoot } = await makeRoots();
    await syncClaudeSettings(targetRoot);
    const settings = JSON.parse(await readFile(join(targetRoot, '.claude', 'settings.json'), 'utf-8')) as {
      hooks: Record<string, unknown>;
    };
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(claudeSettingsHealth(targetRoot).status).toBe('configured');
  });

  it('已有用户 hook → 保留；managed 陈旧条目 → 替换', async () => {
    const { targetRoot } = await makeRoots();
    const settingsPath = join(targetRoot, '.claude', 'settings.json');
    await mkdir(join(targetRoot, '.claude'), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'echo user-custom' }] },
            { hooks: [{ type: 'command', command: join(targetRoot, '.claude', 'hooks', 'session-start-recall.sh') }] },
          ],
        },
      }),
      'utf-8',
    );
    await syncClaudeSettings(targetRoot);
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }>; Stop?: unknown };
    };
    const commands = settings.hooks.SessionStart.flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(commands.some((c) => c.includes('echo user-custom'))).toBe(true);
    expect(commands.some((c) => c.includes('session-start-recall.sh') && c.startsWith('bash '))).toBe(true);
    expect(commands.some((c) => c.includes('session-start-recall.sh') && !c.startsWith('bash '))).toBe(false);
    expect(settings.hooks.Stop).toBeDefined();
  });
});

describe('C31 health — getAgentHookStatus 统一健康', () => {
  it('未初始化项目（无 capabilities.json）→ hooks 全 missing + skills/mcp configured', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const response = await getAgentHookStatus({ projectRoot, targetRoot }, makeProbes());
    const skills = response.targets.find((t) => t.name === 'skills');
    const mcp = response.targets.find((t) => t.name === 'mcp');
    expect(skills?.status).toBe('configured');
    expect(mcp?.status).toBe('configured');
    expect(response.status).toBe('missing'); // hook 文件缺失为最高严重度
  });

  it('MCP 漂移 → 整体 stale；孤儿过滤依赖全局配置有效', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    await mkdir(join(projectRoot, '.cat-cafe'), { recursive: true });
    await writeFile(join(projectRoot, '.cat-cafe', 'capabilities.json'), '{}', 'utf-8');
    const probes = makeProbes({
      readCapabilitiesConfig: vi.fn((): unknown => ({})),
      checkMcpProject: vi.fn(async (): Promise<McpDriftLike> => ({
        issues: [{ type: 'project-orphan' }, { type: 'project-orphan', pluginId: 'com.x' }, { type: 'missing' }],
      })),
    });
    const response = await getAgentHookStatus({ projectRoot, targetRoot }, probes);
    // 全局配置有效 → 仅过滤 plugin-owned orphan，剩 2 条可行动问题
    const mcp = response.targets.find((t) => t.name === 'mcp');
    expect(mcp?.status).toBe('stale');
    expect(mcp?.reason).toBe('2 drift issues');
    expect(response.status).toBe('stale');

    // 全局配置无效（null）→ 全部 orphan 过滤 → configured
    const probesNoGlobal = makeProbes({
      readCapabilitiesConfig: vi.fn((): unknown => null),
      checkMcpProject: vi.fn(async (): Promise<McpDriftLike> => ({
        issues: [{ type: 'project-orphan' }, { type: 'project-orphan' }],
      })),
    });
    const noGlobal = await getAgentHookStatus({ projectRoot, targetRoot }, probesNoGlobal);
    expect(noGlobal.targets.find((t) => t.name === 'mcp')?.status).toBe('configured');
  });

  it('Codex 目录不存在 → codex-hooks unsupported', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const response = await getAgentHookStatus({ projectRoot, targetRoot }, makeProbes());
    const codex = response.targets.find((t) => t.name === 'codex-hooks');
    expect(codex?.status).toBe('unsupported');
  });
});

describe('C31 health — syncAgentHooks 同步 + ownerAuthorized fail-closed', () => {
  it('同步后 hook 文件 / codex JSON / settings.json 全部落地且 configured', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const response = await syncAgentHooks({ projectRoot, targetRoot }, makeProbes());
    expect(await readFile(join(targetRoot, '.claude', 'hooks', 'session-start-recall.sh'), 'utf-8')).toBe(START_SCRIPT);
    expect(await readFile(join(targetRoot, '.codex', 'hooks.json'), 'utf-8')).toBe(
      renderCodexHooksJson(targetRoot),
    );
    expect(claudeSettingsHealth(targetRoot).status).toBe('configured');
    expect(response.targets.find((t) => t.name === 'codex-hooks')?.status).toBe('configured');
    expect(response.status).toBe('configured');
  });

  it('ownerAuthorized 缺失/false → 不读能力配置、不调用能力同步', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    const probes = makeProbes();
    await syncAgentHooks({ projectRoot, targetRoot }, probes);
    const readCapabilitiesConfig = probes.readCapabilitiesConfig as ReturnType<typeof vi.fn>;
    const syncMcpDrift = probes.syncMcpDrift as ReturnType<typeof vi.fn>;
    const syncDrift = probes.syncDrift as ReturnType<typeof vi.fn>;
    expect(readCapabilitiesConfig).not.toHaveBeenCalled();
    expect(syncMcpDrift).not.toHaveBeenCalled();
    expect(syncDrift).not.toHaveBeenCalled();
  });

  it('ownerAuthorized=true + MCP 漂移 → syncMcpDrift 以 keep-project 调用', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    await mkdir(join(projectRoot, '.cat-cafe'), { recursive: true });
    await writeFile(join(projectRoot, '.cat-cafe', 'capabilities.json'), '{}', 'utf-8');
    const probes = makeProbes({
      readCapabilitiesConfig: vi.fn((): unknown => ({})),
      checkMcpProject: vi.fn(async (): Promise<McpDriftLike> => ({
        issues: [{ type: 'missing' }],
      })),
    });
    await syncAgentHooks({ projectRoot, targetRoot, ownerAuthorized: true }, probes);
    const syncMcpDrift = probes.syncMcpDrift as ReturnType<typeof vi.fn>;
    expect(syncMcpDrift).toHaveBeenCalledTimes(1);
    const args = syncMcpDrift.mock.calls[0] ?? [];
    expect(args[4]).toBe('keep-project');
  });

  it('ownerAuthorized=true + 技能漂移 → syncDrift 以 keep-project 调用', async () => {
    const { projectRoot, targetRoot } = await makeRoots();
    await mkdir(join(projectRoot, '.cat-cafe'), { recursive: true });
    await writeFile(join(projectRoot, '.cat-cafe', 'capabilities.json'), '{}', 'utf-8');
    const drift = { newSkills: ['s1'], stale: [], conflicts: [] };
    const probes = makeProbes({
      readCapabilitiesConfig: vi.fn((): unknown => ({})),
      computeSkillDrift: vi.fn(async (): Promise<SkillDriftContextLike | null> => ({
        drift,
        effectiveRoot: projectRoot,
        skillsSource: join(projectRoot, 'cat-cafe-skills'),
        mountRules: {},
        syncOpts: {},
      })),
      checkMcpProject: vi.fn(async (): Promise<McpDriftLike> => ({ issues: [] })),
    });
    await syncAgentHooks({ projectRoot, targetRoot, ownerAuthorized: true }, probes);
    const syncDrift = probes.syncDrift as ReturnType<typeof vi.fn>;
    expect(syncDrift).toHaveBeenCalledTimes(1);
    const args = syncDrift.mock.calls[0] ?? [];
    expect(args[5]).toBe('keep-project');
  });
});
