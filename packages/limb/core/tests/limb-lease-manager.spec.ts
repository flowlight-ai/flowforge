/**
 * LimbLeaseManager — T6.1 独占租约契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbLeaseManager.ts` 语义）：
 * - acquire 新建租约（TTL 默认 60s）/ 同猫幂等 / 他猫冲突返回 null
 * - 过期租约被新 acquire 替换（猫 crash 不永久锁四肢）
 * - renew 续期 + renewCount；release；isLeased
 * - expireAll 清理过期；releaseAllByCat 猫 crash 恢复
 *
 * @module @flowforge/limb-core/tests
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LimbLeaseManager } from '../src/limb-lease-manager.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('LimbLeaseManager', () => {
  it('acquire 创建租约并带 TTL 与初始字段', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const manager = new LimbLeaseManager({ defaultTtlMs: 60_000 });

    const lease = manager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(lease).not.toBeNull();
    expect(lease?.leaseId).toBeTruthy();
    expect(lease?.catId).toBe('cat_a');
    expect(lease?.nodeId).toBe('camera-01');
    expect(lease?.capability).toBe('gpu_render');
    expect(lease?.acquiredAt).toBe(1_000_000);
    expect(lease?.expiresAt).toBe(1_060_000);
    expect(lease?.renewCount).toBe(0);
  });

  it('同猫重复 acquire 幂等返回同一租约', () => {
    const manager = new LimbLeaseManager();
    const first = manager.acquire('cat_a', 'camera-01', 'gpu_render');
    const second = manager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(second?.leaseId).toBe(first?.leaseId);
    expect(manager.size).toBe(1);
  });

  it('他猫 acquire 同能力返回 null', () => {
    const manager = new LimbLeaseManager();
    manager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(manager.acquire('cat_b', 'camera-01', 'gpu_render')).toBeNull();
    // 不同能力不受影响
    expect(manager.acquire('cat_b', 'camera-01', 'camera')).not.toBeNull();
  });

  it('过期租约被新 acquire 替换（不永久锁四肢）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const manager = new LimbLeaseManager({ defaultTtlMs: 100 });
    manager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(manager.acquire('cat_b', 'camera-01', 'gpu_render')).toBeNull();

    vi.setSystemTime(101);
    const lease = manager.acquire('cat_b', 'camera-01', 'gpu_render');
    expect(lease?.catId).toBe('cat_b');
    expect(manager.size).toBe(1);
  });

  it('renew 延长 TTL 并递增 renewCount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const manager = new LimbLeaseManager({ defaultTtlMs: 100 });
    const lease = manager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(lease).not.toBeNull();

    vi.setSystemTime(50);
    expect(manager.renew(lease!.leaseId)).toBe(true);
    expect(lease?.expiresAt).toBe(150);
    expect(lease?.renewCount).toBe(1);

    expect(manager.renew('missing')).toBe(false);
  });

  it('release 移除租约；isLeased 未过期返回租约、过期返回 null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const manager = new LimbLeaseManager({ defaultTtlMs: 100 });
    const lease = manager.acquire('cat_a', 'camera-01', 'gpu_render');

    expect(manager.isLeased('camera-01', 'gpu_render')?.leaseId).toBe(lease?.leaseId);
    vi.setSystemTime(101);
    expect(manager.isLeased('camera-01', 'gpu_render')).toBeNull();

    // 过期后再 acquire 会新建租约（旧租约已移除）
    const fresh = manager.acquire('cat_a', 'camera-01', 'gpu_render');
    expect(fresh?.leaseId).not.toBe(lease?.leaseId);
    manager.release(fresh!.leaseId);
    expect(manager.size).toBe(0);
  });

  it('expireAll 只清理过期租约并返回 leaseId 列表', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const manager = new LimbLeaseManager({ defaultTtlMs: 100 });
    const l1 = manager.acquire('cat_a', 'n1', 'cap');
    const l2 = manager.acquire('cat_b', 'n2', 'cap');

    vi.setSystemTime(50);
    manager.renew(l1!.leaseId); // l1 续期到 150，l2 仍是 100
    vi.setSystemTime(149);

    const expired = manager.expireAll();
    expect(expired).toEqual([l2?.leaseId]);
    expect(manager.size).toBe(1);
  });

  it('releaseAllByCat 释放该猫全部租约（猫 crash 恢复）', () => {
    const manager = new LimbLeaseManager();
    const a1 = manager.acquire('cat_a', 'n1', 'cap');
    manager.acquire('cat_b', 'n2', 'cap');
    const a3 = manager.acquire('cat_a', 'n3', 'cap');

    const released = manager.releaseAllByCat('cat_a');
    expect(released.sort()).toEqual([a1?.leaseId, a3?.leaseId].sort());
    expect(manager.size).toBe(1);
  });

  it('不同能力/节点互不干扰', () => {
    const manager = new LimbLeaseManager();
    manager.acquire('cat_a', 'n1', 'cap1');
    expect(manager.acquire('cat_b', 'n1', 'cap2')).not.toBeNull();
    expect(manager.acquire('cat_b', 'n2', 'cap1')).not.toBeNull();
    expect(manager.size).toBe(3);
  });
});
