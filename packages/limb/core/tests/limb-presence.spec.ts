/**
 * LimbPresenceManager — T6.1 心跳在线状态契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbPresenceManager.ts` 语义）：
 * - mapProbeStateToLimbStatus 四态映射
 * - checkAll 超时节点标记 offline 并通知；fresh 节点保留
 * - start/stop 定时检查与 running 标志
 *
 * @module @flowforge/limb-core/tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LimbPresenceManager, mapProbeStateToLimbStatus } from '../src/limb-presence.js';
import { LimbRegistry } from '../src/limb-registry.js';
import type { LimbNodeStatus } from '../src/index.ts';
import { makeNode } from './helpers.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('mapProbeStateToLimbStatus', () => {
  it('四态映射：active→online / busy-silent→busy / idle-silent→degraded / dead→offline', () => {
    expect(mapProbeStateToLimbStatus('active')).toBe('online');
    expect(mapProbeStateToLimbStatus('busy-silent')).toBe('busy');
    expect(mapProbeStateToLimbStatus('idle-silent')).toBe('degraded');
    expect(mapProbeStateToLimbStatus('dead')).toBe('offline');
  });
});

describe('LimbPresenceManager', () => {
  it('checkAll 将超时节点标记 offline 并通知状态变更', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = new LimbRegistry();
    await registry.register(makeNode({ nodeId: 'a' }));
    await registry.register(makeNode({ nodeId: 'b' }));

    const presence = new LimbPresenceManager(registry, { timeoutMs: 45_000, checkIntervalMs: 15_000 });
    const changes: Array<{ nodeId: string; from: LimbNodeStatus; to: LimbNodeStatus }> = [];
    presence.onStatusChange((nodeId, from, to) => changes.push({ nodeId, from, to }));

    vi.setSystemTime(46_000); // a/b 均超时
    presence.checkAll();
    expect(registry.getNode('a')?.status).toBe('offline');
    expect(registry.getNode('b')?.status).toBe('offline');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({ nodeId: 'a', from: 'online', to: 'offline' });

    // 再次 checkAll：已 offline 的不重复通知
    presence.checkAll();
    expect(changes).toHaveLength(2);
    presence.stop();
  });

  it('fresh 心跳节点不被误判；recording 心跳后重置计时', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = new LimbRegistry();
    await registry.register(makeNode({ nodeId: 'a' }));

    const presence = new LimbPresenceManager(registry, { timeoutMs: 45_000, checkIntervalMs: 15_000 });
    const changes: string[] = [];
    presence.onStatusChange((nodeId) => changes.push(nodeId));

    vi.setSystemTime(30_000);
    registry.recordHeartbeat('a'); // 刷新心跳
    vi.setSystemTime(70_000); // 距上次心跳 40s < 45s
    presence.checkAll();
    expect(registry.getNode('a')?.status).toBe('online');
    expect(changes).toHaveLength(0);

    vi.setSystemTime(80_000); // 距上次心跳 50s > 45s
    presence.checkAll();
    expect(registry.getNode('a')?.status).toBe('offline');
    expect(changes).toEqual(['a']);
    presence.stop();
  });

  it('start 定时检查；stop 停止；running 标志翻转', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = new LimbRegistry();
    await registry.register(makeNode());

    const presence = new LimbPresenceManager(registry, { timeoutMs: 45_000, checkIntervalMs: 15_000 });
    expect(presence.running).toBe(false);

    presence.start();
    expect(presence.running).toBe(true);
    // 幂等 start
    presence.start();
    expect(presence.running).toBe(true);

    // 定时器到期自动检查：15s 间隔内推进到 60s，节点 45s 超时
    vi.setSystemTime(60_000);
    vi.advanceTimersByTime(15_000);
    expect(registry.getNode('camera-01')?.status).toBe('offline');

    presence.stop();
    expect(presence.running).toBe(false);
    presence.stop(); // 幂等
  });

  it('checkAll 在空注册表上安全运行', () => {
    const presence = new LimbPresenceManager(new LimbRegistry(), { timeoutMs: 1000, checkIntervalMs: 500 });
    expect(() => presence.checkAll()).not.toThrow();
  });
});
