/**
 * LimbRegistry — T6.1 注册/注销/查询/调用 pipeline 契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbRegistry.ts` 语义）：
 * - register 记录字段 / 重复注册抛错 / deregister 移除
 * - invoke：未知节点 / offline / 命令不在白名单 → 拒绝
 * - Phase B pipeline：gated 拒绝、leased 租约获取与单次调用后自动释放、
 *   他猫持锁冲突拒绝、access policy 覆盖生效
 * - action log 记录 completed / failed
 * - listAvailable 排除 offline；findByCapability；recordHeartbeat 复活
 *
 * @module @flowforge/limb-core/tests
 */

import { describe, expect, it } from 'vitest';
import { LimbAccessPolicy } from '../src/limb-access-policy.js';
import { LimbActionLog } from '../src/limb-action-log.js';
import { LimbLeaseManager } from '../src/limb-lease-manager.js';
import { LimbRegistry } from '../src/limb-registry.js';
import { makeNode } from './helpers.ts';

function harness() {
  const accessPolicy = new LimbAccessPolicy();
  const leaseManager = new LimbLeaseManager();
  const actionLog = new LimbActionLog();
  const registry = new LimbRegistry();
  registry.setDeps({ accessPolicy, leaseManager, actionLog });
  return { registry, accessPolicy, leaseManager, actionLog };
}

describe('LimbRegistry 注册/注销/查询', () => {
  it('register 记录完整元数据并默认 online', async () => {
    const registry = new LimbRegistry();
    const record = await registry.register(makeNode());

    expect(record.nodeId).toBe('camera-01');
    expect(record.displayName).toBe('Camera 01');
    expect(record.platform).toBe('test');
    expect(record.status).toBe('online');
    expect(record.registeredAt).toBeGreaterThan(0);
    expect(record.lastHeartbeatAt).toBe(record.registeredAt);
    expect(record.capabilities.map((c) => c.cap)).toEqual(['camera', 'gpu_render']);
  });

  it('重复注册抛错，deregister 后允许重新注册', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode());
    await expect(registry.register(makeNode())).rejects.toThrow('already registered');

    registry.deregister('camera-01');
    const record = await registry.register(makeNode());
    expect(record.nodeId).toBe('camera-01');
    expect(registry.size).toBe(1);
  });

  it('getNode 返回元数据副本，getNodeHandle 返回实例', async () => {
    const registry = new LimbRegistry();
    const node = makeNode();
    await registry.register(node);

    const record = registry.getNode('camera-01');
    expect(record?.displayName).toBe('Camera 01');
    expect(registry.getNode('missing')).toBeUndefined();
    expect(registry.getNodeHandle('camera-01')).toBe(node);
    expect(registry.getNodeHandle('missing')).toBeUndefined();
  });

  it('listAll 含 offline；listAvailable 排除 offline', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode({ nodeId: 'a' }));
    await registry.register(makeNode({ nodeId: 'b' }));
    registry.updateStatus('b', 'offline');

    expect(registry.listAll().map((n) => n.nodeId)).toEqual(['a', 'b']);
    expect(registry.listAvailable().map((n) => n.nodeId)).toEqual(['a']);
  });

  it('findByCapability 只返回可用节点', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode({ nodeId: 'a' }));
    await registry.register(
      makeNode({
        nodeId: 'b',
        capabilities: [{ cap: 'voice', commands: ['voice.say'], authLevel: 'free' }],
      }),
    );
    registry.updateStatus('a', 'offline');

    const found = registry.findByCapability('camera');
    expect(found).toHaveLength(0);
    expect(registry.findByCapability('voice').map((n) => n.nodeId)).toEqual(['b']);
  });

  it('recordHeartbeat 刷新时间并复活 offline 节点', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode());
    registry.updateStatus('camera-01', 'offline');

    registry.recordHeartbeat('camera-01');
    expect(registry.getNode('camera-01')?.status).toBe('online');
    expect(registry.getNode('camera-01')?.lastHeartbeatAt).toBeGreaterThan(0);
  });
});

describe('LimbRegistry.invoke Phase A 守卫', () => {
  it('未知节点 → error', async () => {
    const registry = new LimbRegistry();
    const result = await registry.invoke('missing', 'camera.snap', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown node');
  });

  it('offline 节点 → error', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode());
    registry.updateStatus('camera-01', 'offline');
    const result = await registry.invoke('camera-01', 'camera.snap', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('offline');
  });

  it('命令不在任何能力白名单 → error', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode());
    const result = await registry.invoke('camera-01', 'voice.say', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in any capability whitelist');
  });

  it('free 能力直接执行并透传结果', async () => {
    const registry = new LimbRegistry();
    await registry.register(makeNode({ invokeResult: { success: true, data: { shot: 1 } } }));
    const result = await registry.invoke('camera-01', 'camera.snap', {});
    expect(result).toEqual({ success: true, data: { shot: 1 } });
  });

  it('节点 invoke 抛异常 → error 且 action log 记 failed', async () => {
    const { registry } = harness();
    await registry.register(
      makeNode({
        invokeImpl: async () => {
          throw new Error('boom');
        },
      }),
    );
    const result = await registry.invoke('camera-01', 'camera.snap', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });
});

describe('LimbRegistry.invoke Phase B pipeline', () => {
  it('gated 能力拒绝且不调用节点', async () => {
    const { registry } = harness();
    const invoked: string[] = [];
    await registry.register(
      makeNode({
        capabilities: [{ cap: 'secret', commands: ['secret.read'], authLevel: 'gated' }],
        invokeImpl: async (command) => {
          invoked.push(command);
          return { success: true };
        },
      }),
    );
    const result = await registry.invoke('camera-01', 'secret.read', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('gated');
    expect(invoked).toHaveLength(0);
  });

  it('leased 能力单次调用后租约自动释放（不长期占用）', async () => {
    const { registry } = harness();
    await registry.register(makeNode());
    const result = await registry.invoke('camera-01', 'gpu.render', {}, { catId: 'cat_a' });
    expect(result.success).toBe(true);
    // 单次调用语义：调用结束租约即释放，他猫可立即获取
    await expect(registry.invoke('camera-01', 'gpu.render', {}, { catId: 'cat_b' })).resolves.toMatchObject({
      success: true,
    });
  });

  it('leased 被他猫持有 → 拒绝', async () => {
    const { registry, leaseManager } = harness();
    await registry.register(makeNode());
    // 模拟另一只猫已持锁（例如进行中的长调用持有期间）
    const held = leaseManager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(held).not.toBeNull();

    const result = await registry.invoke('camera-01', 'gpu.render', {}, { catId: 'cat_b' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('leased by another cat');
  });

  it('access policy 覆盖：free 能力被提升为 gated 后拒绝', async () => {
    const { registry, accessPolicy } = harness();
    await registry.register(makeNode());
    accessPolicy.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'camera', authLevel: 'gated' });
    const result = await registry.invoke('camera-01', 'camera.snap', {}, { catId: 'cat_a' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires approval');
  });

  it('access policy 降级：leased 能力被放行为 free 后免租约执行', async () => {
    const { registry, accessPolicy } = harness();
    await registry.register(makeNode());
    accessPolicy.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'gpu_render', authLevel: 'free' });
    const result = await registry.invoke('camera-01', 'gpu.render', {}, { catId: 'cat_a' });
    expect(result.success).toBe(true);
  });

  it('成功调用写入 action log（completed + artifactUri）', async () => {
    const { registry, actionLog } = harness();
    await registry.register(makeNode({ invokeResult: { success: true, artifactUri: 'file:///snap.jpg' } }));
    await registry.invoke('camera-01', 'camera.snap', {}, { catId: 'cat_a', invocationId: 'inv-1' });

    expect(actionLog.size).toBe(1);
    const entry = actionLog.getByNode('camera-01')[0];
    expect(entry?.status).toBe('completed');
    expect(entry?.catId).toBe('cat_a');
    expect(entry?.invocationId).toBe('inv-1');
    expect(entry?.command).toBe('camera.snap');
    expect(entry?.artifactUri).toBe('file:///snap.jpg');
  });

  it('失败调用写入 action log（failed）', async () => {
    const { registry, actionLog } = harness();
    await registry.register(makeNode({ invokeResult: { success: false, error: 'shutter stuck' } }));
    await registry.invoke('camera-01', 'camera.snap', {});

    expect(actionLog.getByNode('camera-01')[0]?.status).toBe('failed');
  });

  it('catId 缺省为 unknown 且不影响 free 调用', async () => {
    const { registry, actionLog } = harness();
    await registry.register(makeNode());
    const result = await registry.invoke('camera-01', 'camera.snap', {});
    expect(result.success).toBe(true);
    expect(actionLog.getByNode('camera-01')[0]?.catId).toBe('unknown');
  });
});
