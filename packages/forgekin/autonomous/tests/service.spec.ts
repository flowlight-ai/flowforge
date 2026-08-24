/**
 * service — T7.19 F052 自主运行域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeAutonomous 挂载 / registerForgekin / scanOnce /
 * start-stop-waitStopped 生命周期 / getStatus。
 *
 * @module @flowforge/forgekin-autonomous/tests
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { SwarmCoordinator } from '@flowforge/forgekin-swarm';
import Plugin, { AutonomousDaemon, AutonomousService } from '../src/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'autonomous-service-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const testOptions = () => ({
  projectRoot: root,
  sleepFn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  config: { scan_interval_seconds: 0.005, consumer_interval_seconds: 0.001 },
  scannerConfig: { sourceDirName: 'src', coreModules: [] },
});

/** 测试用协调器（no-op 归档 + 让步睡眠） */
function testCoordinator(): SwarmCoordinator {
  return new SwarmCoordinator({
    archiveFn: () => {},
    sleepFn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  });
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeAutonomous', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      ...testOptions(),
      coordinator: testCoordinator(),
    });
    expect(ctx.forgeAutonomous).toBeInstanceOf(AutonomousService);
    expect(ctx.forgeAutonomous.daemon).toBeInstanceOf(AutonomousDaemon);
    expect(ctx.forgeAutonomous.runPromise).toBeNull();
  });
});

describe('门面', () => {
  it('registerForgekin 后 getStatus 反映注册表', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, testOptions());
    ctx.forgeAutonomous.registerForgekin('forgemind:wenxin', {
      chat: async () => ({ content: 'ok' }),
    });
    const status = ctx.forgeAutonomous.getStatus();
    expect(status['registered_forgekins']).toEqual(['forgemind:wenxin']);
    expect(status['running']).toBe(false);
    expect(status['total_tasks']).toBe(0);
  });

  it('scanOnce 发现缺失文档任务', async () => {
    write('src/empty.py', 'x = 1\n');
    const ctx = new Context();
    await ctx.plugin(Plugin, testOptions());
    const tasks = ctx.forgeAutonomous.scanOnce();
    expect(tasks.map((t) => t.title)).toContain('补充缺失文档: docs/spec.md');
    expect(tasks.map((t) => t.title)).toContain('补充缺失文档: docs/arch.md');
  });

  it('start → stop → waitStopped 生命周期', async () => {
    write('src/empty.py', 'x = 1\n');
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      ...testOptions(),
      coordinator: testCoordinator(),
    });
    ctx.forgeAutonomous.start();
    expect(ctx.forgeAutonomous.runPromise).not.toBeNull();
    ctx.forgeAutonomous.start(); // 重复启动无副作用
    ctx.forgeAutonomous.stop();
    await ctx.forgeAutonomous.waitStopped();
    expect(ctx.forgeAutonomous.runPromise).toBeNull();
    expect(ctx.forgeAutonomous.getStatus()['running']).toBe(false);
  });

  it('getActivityLog / getCompletedOutputs 倒序返回', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, testOptions());
    ctx.forgeAutonomous.daemon.logActivity('test_event', '测试事件');
    const log = ctx.forgeAutonomous.getActivityLog();
    expect(log[0]?.event_type).toBe('test_event');
    expect(ctx.forgeAutonomous.getCompletedOutputs()).toEqual([]);
  });
});
