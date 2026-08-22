/**
 * trae-bridge-service — T7.26 Trae 文件桥接域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeTraeBridge 挂载 / chat 文件协议往返 / 协议层门面 /
 * init 健康检查 / snapshot / operator 生命周期门面。
 *
 * 测试注入：临时目录 + 确定性 uuidFn + sleepFn 无等待。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { makeTraeBridgeConfig } from '../src/config.js';
import Plugin, { TraeBridgeService, type TraeBridgeServiceOptions } from '../src/index.js';
import { makeBridgeRequestContext } from '../src/models.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const tmpDirs: string[] = [];
let sharedDir: string;

beforeEach(() => {
  sharedDir = mkdtempSync(path.join(os.tmpdir(), 'trae-bridge-svc-'));
  tmpDirs.push(sharedDir);
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function baseOptions(extra: TraeBridgeServiceOptions = {}): TraeBridgeServiceOptions {
  return {
    bridgeConfig: makeTraeBridgeConfig({ shared_dir: sharedDir, poll_interval_seconds: 0.01 }),
    sleepFn: async () => {},
    logger: silentLogger,
    ...extra,
  };
}

/** 预写响应文件模拟 operator 回写（配合确定性 uuidFn 首轮命中） */
function prewriteResponse(rid: string, content: string): void {
  writeFileSync(
    path.join(sharedDir, 'responses', `response_${rid}.json`),
    JSON.stringify({ request_id: rid, content, status: 'completed', model: 'trae' }),
    'utf-8',
  );
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeTraeBridge', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, baseOptions());
    expect(ctx.forgeTraeBridge).toBeInstanceOf(TraeBridgeService);
    expect(ctx.forgeTraeBridge.operator).toBeNull();
  });

  it('enableOperator=true 时创建 operator 实例', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, baseOptions({ enableOperator: true, operatorOptions: { env: {} } }));
    expect(ctx.forgeTraeBridge.operator).not.toBeNull();
  });
});

describe('chat 文件协议往返（F045 §2.1）', () => {
  it('writeRequest → 预写响应 → pollResponse 全链路', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, baseOptions({ uuidFn: () => 'rid-svc' }));
    const svc = ctx.forgeTraeBridge;
    prewriteResponse('rid-svc', '服务层回答');

    const result = await svc.chat([{ role: 'user', content: '你好' }]);
    expect(result['content']).toBe('服务层回答');
    expect(result['provider']).toBe('trae');
    expect(svc.getStatus().completed_total).toBe(1);
  });

  it('writeRequest / listPendingRequests / writeCancel 门面', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, baseOptions());
    const svc = ctx.forgeTraeBridge;

    const rid = await svc.writeRequest(
      [{ role: 'user', content: 'q' }],
      makeBridgeRequestContext({ forgekin_id: 'forgemind:wenxin' }),
    );
    expect(svc.listPendingRequests()).toHaveLength(1);
    expect(svc.getStatus().pending_count).toBe(1);

    await svc.writeCancel(rid, '手动取消');
    await expect(svc.pollResponse(rid)).rejects.toThrow(/取消/);
  });
});

describe('init / healthCheck / snapshot', () => {
  it('health_check_on_init=true 时 init 执行目录健康检查', async () => {
    const ctx = new Context();
    await ctx.plugin(
      Plugin,
      baseOptions({
        bridgeConfig: makeTraeBridgeConfig({
          shared_dir: sharedDir,
          health_check_on_init: true,
        }),
      }),
    );
    expect(await ctx.forgeTraeBridge.init()).toBe(true);
    expect(await ctx.forgeTraeBridge.healthCheck()).toBe(true);
  });

  it('health_check_on_init=false 时 init 直接返回 true', async () => {
    const ctx = new Context();
    await ctx.plugin(
      Plugin,
      baseOptions({
        bridgeConfig: makeTraeBridgeConfig({
          shared_dir: sharedDir,
          health_check_on_init: false,
        }),
      }),
    );
    expect(await ctx.forgeTraeBridge.init()).toBe(true);
  });

  it('snapshot 返回桥接状态总览', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, baseOptions());
    const snap = ctx.forgeTraeBridge.snapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.pendingRequests).toBe(0);
    expect(snap.operatorRunning).toBe(false);
    expect(snap.operatorStats).toBeNull();
    expect(snap.status.pending_count).toBe(0);
  });
});

describe('operator 生命周期门面', () => {
  it('未启用 operator 时 startOperator 返回 false / stopOperator 空操作', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, baseOptions());
    expect(await ctx.forgeTraeBridge.startOperator()).toBe(false);
    await ctx.forgeTraeBridge.stopOperator(); // 不抛错
  });

  it('enableOperator 时 start/stop 正常 + snapshot 反映运行状态', async () => {
    let polls = 0;
    const ctx = new Context();
    await ctx.plugin(
      Plugin,
      baseOptions({
        enableOperator: true,
        operatorOptions: {
          env: {},
          pollInterval: 0.001,
          sleepFn: async () => {
            // 宏任务延迟保证启动断言窗口内循环仍在运行；3 轮后软停止。
            // 注意：不能 await（会等待自身轮询循环退出而死锁），fire-and-forget
            polls += 1;
            await new Promise((resolve) => setTimeout(resolve, 2));
            if (polls >= 3) {
              void ctx.forgeTraeBridge.stopOperator();
            }
          },
          fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }),
        },
      }),
    );
    const svc = ctx.forgeTraeBridge;
    expect(await svc.startOperator()).toBe(true);
    expect(svc.operator?.isRunning).toBe(true);
    // sleepFn 触发软停止；等待循环退出
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && (svc.operator?.isRunning ?? false)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await svc.stopOperator();
    expect(svc.operator?.isRunning).toBe(false);
    const snap = svc.snapshot();
    expect(snap.operatorRunning).toBe(false);
    expect(snap.operatorStats).not.toBeNull();
  });
});
