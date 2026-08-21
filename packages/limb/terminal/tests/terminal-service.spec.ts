/**
 * LimbTerminalService — T6.5 Cordis 插件挂载与网关转发契约验证。
 *
 * 覆盖（对齐 limb-core limb-service.spec.ts 插件测试惯例）：
 * - `ctx.plugin(LimbTerminalService)` 挂载 ctx.limbTerminal
 * - 默认导出 Plugin 函数等价挂载
 * - gateway 方法逐项转发（ensureServer/createPane/listPanes/execInPane/…）
 * - spawnCli 返回 AsyncGenerator（deps 缺省走注入 gateway）
 * - createSpawnOverride / createCarrierSessionFactory 装配
 * - sessions 存储 + toTerminalSession（flowforge- socket 命名）
 * - agentPanes 列表 + readAgentSessions（jobsDir）
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@flowforge/cordis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LimbTerminalPlugin, { LimbTerminalService } from '../src/index.js';
import type { TerminalGatewayLike } from '../src/types.js';

function makeGateway(): TerminalGatewayLike {
  return {
    tmuxBin: '/fake/bin/tmux',
    socketName: vi.fn((id: string) => `flowforge-${id}`),
    ensureServer: vi.fn(async () => 'flowforge-wt-1'),
    createPane: vi.fn(async () => '%0'),
    createAgentPane: vi.fn(async () => '%0'),
    execInPane: vi.fn(async () => {}),
    setPaneReadOnly: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    capturePane: vi.fn(async () => 'pane content'),
    listPanes: vi.fn(async () => []),
    resizePane: vi.fn(async () => {}),
    killPane: vi.fn(async () => {}),
    destroyServer: vi.fn(async () => {}),
  };
}

describe('LimbTerminalService Cordis 插件挂载', () => {
  it('ctx.plugin(LimbTerminalService) 挂载 ctx.limbTerminal（注入 gateway）', async () => {
    const ctx = new Context();
    const gateway = makeGateway();
    const fiber = await ctx.plugin(LimbTerminalService, { gateway });

    expect(ctx.limbTerminal).toBeInstanceOf(LimbTerminalService);
    expect(ctx.limbTerminal.gateway).toBe(gateway);
    expect(ctx.limbTerminal.sessions).toBeDefined();
    expect(ctx.limbTerminal.agentPanes).toBeDefined();
    await fiber.dispose();
  });

  it('默认导出 Plugin 函数等价挂载', async () => {
    const ctx = new Context();
    const gateway = makeGateway();
    await LimbTerminalPlugin(ctx, { gateway });
    expect(ctx.limbTerminal).toBeInstanceOf(LimbTerminalService);
  });
});

describe('LimbTerminalService 网关转发', () => {
  let ctx: Context;
  let fiber: { dispose(): Promise<void> };
  let gateway: TerminalGatewayLike;

  beforeEach(async () => {
    ctx = new Context();
    gateway = makeGateway();
    fiber = await ctx.plugin(LimbTerminalService, { gateway });
  });

  afterEach(async () => {
    await fiber.dispose();
  });

  it('逐项转发 gateway 方法', async () => {
    await ctx.limbTerminal.ensureServer('wt-1');
    expect(gateway.ensureServer).toHaveBeenCalledWith('wt-1');

    await ctx.limbTerminal.createPane('wt-1', { cols: 100 });
    expect(gateway.createPane).toHaveBeenCalledWith('wt-1', { cols: 100 });

    await ctx.limbTerminal.createAgentPane('wt-1');
    expect(gateway.createAgentPane).toHaveBeenCalledWith('wt-1', undefined);

    await ctx.limbTerminal.listPanes('wt-1');
    expect(gateway.listPanes).toHaveBeenCalledWith('wt-1');

    await ctx.limbTerminal.execInPane('wt-1', '%0', 'echo hi');
    expect(gateway.execInPane).toHaveBeenCalledWith('wt-1', '%0', 'echo hi');

    await ctx.limbTerminal.sendKeys('wt-1', '%0', 'ls');
    expect(gateway.sendKeys).toHaveBeenCalledWith('wt-1', '%0', 'ls');

    await ctx.limbTerminal.capturePane('wt-1', '%0');
    expect(gateway.capturePane).toHaveBeenCalledWith('wt-1', '%0');

    await ctx.limbTerminal.resizePane('wt-1', '%0', 80, 24);
    expect(gateway.resizePane).toHaveBeenCalledWith('wt-1', '%0', 80, 24);

    await ctx.limbTerminal.setPaneReadOnly('wt-1', '%0', true);
    expect(gateway.setPaneReadOnly).toHaveBeenCalledWith('wt-1', '%0', true);

    await ctx.limbTerminal.killPane('wt-1', '%0');
    expect(gateway.killPane).toHaveBeenCalledWith('wt-1', '%0');

    await ctx.limbTerminal.destroyServer('wt-1');
    expect(gateway.destroyServer).toHaveBeenCalledWith('wt-1');
  });

  it('spawnCli 返回 AsyncGenerator，deps 缺省使用注入 gateway', () => {
    const gen = ctx.limbTerminal.spawnCli({ command: 'codex', args: [], worktreeId: 'wt-1', invocationId: 'inv-1' });
    expect(typeof gen.next).toBe('function');
  });

  it('spawnCli 支持 deps 部分覆盖（logger / gateway）', () => {
    const logger = { error: vi.fn() };
    const gen = ctx.limbTerminal.spawnCli(
      { command: 'codex', args: [], worktreeId: 'wt-1', invocationId: 'inv-1' },
      { logger },
    );
    expect(typeof gen.next).toBe('function');
  });

  it('createSpawnOverride / createCarrierSessionFactory 装配为函数', () => {
    const override = ctx.limbTerminal.createSpawnOverride('wt-1', 'inv-1', 'u-1');
    expect(typeof override).toBe('function');
    const factory = ctx.limbTerminal.createCarrierSessionFactory({ worktreeId: 'wt-1', userId: 'u-1' });
    expect(typeof factory).toBe('function');
  });

  it('createSession / toTerminalSession：flowforge- socket 命名 + 元数据', () => {
    const record = ctx.limbTerminal.createSession({ worktreeId: 'wt-1', paneId: '%0', userId: 'u-1' });
    expect(record.status).toBe('connected');

    const session = ctx.limbTerminal.toTerminalSession(record, '/bin/bash');
    expect(session.tmuxSocketName).toBe('flowforge-wt-1');
    expect(session.paneId).toBe('%0');
    expect(session.shell).toBe('/bin/bash');
    expect(session.cols).toBe(80);
    expect(session.rows).toBe(24);
    expect(session.id).toBe(record.id);
  });

  it('listAgentPanes：agent pane 注册后按 worktree+user 过滤', async () => {
    const gatewayForSpawn = makeGateway();
    const ctx2 = new Context();
    const fiber2 = await ctx2.plugin(LimbTerminalService, { gateway: gatewayForSpawn });
    ctx2.limbTerminal.agentPanes.register('inv-1', 'wt-1', '%0', 'u-1');
    ctx2.limbTerminal.agentPanes.register('inv-2', 'wt-1', '%1', 'u-2');

    expect(ctx2.limbTerminal.listAgentPanes('wt-1', 'u-1')).toHaveLength(1);
    expect(ctx2.limbTerminal.listAgentPanes('wt-1', 'u-1')[0]?.invocationId).toBe('inv-1');
    await fiber2.dispose();
  });

  it('readAgentSessions：jobsDir 聚合快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ff-terminal-jobs-svc-'));
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'abc123'), { recursive: true });
      await writeFile(
        join(dir, 'abc123', 'state.json'),
        JSON.stringify({ daemonShort: 'abc123', state: 'running', detail: 'working', cwd: '/work', createdAt: 't' }),
      );
      const sessions = await ctx.limbTerminal.readAgentSessions(dir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.daemonShortId).toBe('abc123');
      expect(sessions[0]?.state).toBe('running');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
