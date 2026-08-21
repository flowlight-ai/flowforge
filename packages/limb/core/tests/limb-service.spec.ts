/**
 * LimbService — T6.1 Cordis 插件挂载与全链路契约验证。
 *
 * 覆盖（对齐 clowder-ai limb 域 → Cordis 插件化要求）：
 * - `ctx.plugin(LimbService)` 挂载 ctx.limb 六域句柄
 * - register → invoke（leased pipeline）→ action log 全链路
 * - pairing：createPairingRequest → approvePairing → findPairingByApiKey
 * - presence 生命周期：startPresence 启动、fiber dispose 自动停止
 * - 默认导出 Plugin 函数等价挂载
 *
 * @module @flowforge/limb-core/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import LimbPlugin, { LimbService } from '../src/index.ts';
import { makeNode } from './helpers.ts';

describe('LimbService Cordis 插件挂载', () => {
  it('ctx.plugin(LimbService) 挂载 ctx.limb 六域句柄', async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(LimbService);

    expect(ctx.limb).toBeInstanceOf(LimbService);
    expect(ctx.limb.registry).toBeDefined();
    expect(ctx.limb.leases).toBeDefined();
    expect(ctx.limb.accessPolicy).toBeDefined();
    expect(ctx.limb.actionLog).toBeDefined();
    expect(ctx.limb.pairing).toBeDefined();
    expect(ctx.limb.presence).toBeDefined();
    await fiber.dispose();
  });

  it('默认导出 Plugin 函数等价挂载 ctx.limb', async () => {
    const ctx = new Context();
    await LimbPlugin(ctx);
    expect(ctx.limb).toBeInstanceOf(LimbService);
  });
});

describe('LimbService 全链路', () => {
  it('register → invoke（leased 单次释放）→ action log 完整 provenance', async () => {
    const ctx = new Context();
    await ctx.plugin(LimbService);
    await ctx.limb.register(makeNode({ invokeResult: { success: true, artifactUri: 'file:///frame.png' } }));

    const result = await ctx.limb.invoke('camera-01', 'gpu.render', { frames: 2 }, { catId: 'cat_a', invocationId: 'inv-9' });
    expect(result.success).toBe(true);

    // 单次调用后租约释放，他猫可获取
    await expect(ctx.limb.invoke('camera-01', 'gpu.render', {}, { catId: 'cat_b' })).resolves.toMatchObject({
      success: true,
    });

    const actions = ctx.limb.getActionsByNode('camera-01');
    expect(actions).toHaveLength(2);
    expect(actions[0]?.status).toBe('completed');
    expect(actions[0]?.artifactUri).toBe('file:///frame.png');
    expect(actions[0]?.invocationId).toBe('inv-9');
  });

  it('pairing：创建请求 → 审批 → apiKey 认证查询', async () => {
    const ctx = new Context();
    await ctx.plugin(LimbService);

    const req = ctx.limb.createPairingRequest({
      nodeId: 'remote-01',
      displayName: 'Remote CLI',
      platform: 'linux-x64',
      endpointUrl: 'ws://remote:9000',
      capabilities: [{ cap: 'exec', commands: ['exec.run'], authLevel: 'leased' }],
    });
    expect(ctx.limb.listPendingPairings()).toHaveLength(1);
    expect(ctx.limb.findPairingByApiKey(req.apiKey)).toBeUndefined();

    const approved = await ctx.limb.approvePairing(req.requestId, 'user-1');
    expect(approved?.status).toBe('approved');
    expect(ctx.limb.listApprovedPairings()).toHaveLength(1);
    expect(ctx.limb.findPairingByApiKey(req.apiKey)?.nodeId).toBe('remote-01');
    expect(ctx.limb.pairing.findApprovedByNodeId('remote-01')).toBeDefined();
  });

  it('access policy + lease 通过服务句柄协同生效', async () => {
    const ctx = new Context();
    await ctx.plugin(LimbService);
    await ctx.limb.register(makeNode());

    ctx.limb.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'gpu_render', authLevel: 'gated' });
    expect(ctx.limb.checkPolicy('cat_a', 'camera-01', 'gpu_render')).toBe('gated');

    const denied = await ctx.limb.invoke('camera-01', 'gpu.render', {}, { catId: 'cat_a' });
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('requires approval');
  });
});

describe('LimbService presence 生命周期', () => {
  it('startPresence 启动定时检查；fiber dispose 自动停止', async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(LimbService);
    const presence = ctx.limb.presence;

    expect(presence.running).toBe(false);
    ctx.limb.startPresence();
    expect(presence.running).toBe(true);

    await fiber.dispose();
    expect(presence.running).toBe(false);
  });
});
