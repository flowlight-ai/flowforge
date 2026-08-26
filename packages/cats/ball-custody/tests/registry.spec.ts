/**
 * F005 BallCustodyRegistry 测试 — Phase A 全 9 AC + 不变量。
 *
 * 覆盖：AC-A1 lease_id 格式 / AC-A2 双持球抛错 / AC-A3 过期懒清理后重 acquire /
 * AC-A4 空值与非法 TTL / AC-A5 release 后 None / AC-A6 renew 续约 /
 * AC-A7 过期查询返回 None / AC-A8 未知 lease 视为过期 / AC-A9 now_fn 快进。
 */

import { describe, expect, it } from 'vitest';
import { BallCustodyError } from '../src/models.js';
import { BallCustodyRegistry, DEFAULT_TTL_SECONDS } from '../src/registry.js';

/** 可控时钟：now_fn 注入（F005 INV-5 / AC-A9），快进无需 sleep。 */
function makeClock() {
  let now = 1_700_000_000_000;
  return {
    nowFn: () => now,
    advance(ms: number): void {
      now += ms;
    },
  };
}

describe('F005 AC-A1：acquire 返回 lease-{10hex}', () => {
  it('返回带 lease- 前缀 + 10 位 hex 的 lease_id', () => {
    const reg = new BallCustodyRegistry();
    const leaseId = reg.acquire('ball:thread:42', 'alice', 300);
    expect(leaseId).toMatch(/^lease-[0-9a-f]{10}$/);
  });

  it('连续 acquire 不同 ball 生成不同 lease_id', () => {
    const reg = new BallCustodyRegistry();
    const a = reg.acquire('ball:thread:1', 'alice', 300);
    const b = reg.acquire('ball:thread:2', 'bob', 300);
    expect(a).not.toBe(b);
  });
});

describe('F005 AC-A2：双持球防护', () => {
  it('同一 ball 未过期时二次 acquire 抛错且含 is already held by', () => {
    const reg = new BallCustodyRegistry();
    reg.acquire('ball:thread:42', 'alice', 300);
    expect(() => reg.acquire('ball:thread:42', 'bob', 300)).toThrowError(BallCustodyError);
    expect(() => reg.acquire('ball:thread:42', 'bob', 300)).toThrowError(/is already held by alice/);
  });

  it('冲突计数进 metrics（§2.6 lease_acquire_conflict_count）', () => {
    const reg = new BallCustodyRegistry();
    reg.acquire('ball:thread:42', 'alice', 300);
    expect(() => reg.acquire('ball:thread:42', 'bob', 300)).toThrow();
    expect(reg.metrics().acquireConflictCount).toBe(1);
  });
});

describe('F005 AC-A3：过期 lease 懒清理后允许新 owner', () => {
  it('TTL 过期后 acquire 成功且 metrics 记录 ttl 过期', () => {
    const clock = makeClock();
    const reg = new BallCustodyRegistry(clock.nowFn);
    reg.acquire('ball:thread:42', 'alice', 10); // 10s TTL
    clock.advance(10_001);
    const leaseId = reg.acquire('ball:thread:42', 'bob', 300);
    expect(leaseId).toMatch(/^lease-[0-9a-f]{10}$/);
    expect(reg.currentHolder('ball:thread:42')).toBe('bob');
    expect(reg.metrics().ttlExpiryCount).toBe(1);
  });
});

describe('F005 AC-A4：拒绝空值与非法 TTL', () => {
  const reg = new BallCustodyRegistry();
  it('空 ball_id 抛错', () => {
    expect(() => reg.acquire('', 'alice', 300)).toThrowError(/ball_id 不能为空/);
    expect(() => reg.acquire('   ', 'alice', 300)).toThrowError(/ball_id 不能为空/);
  });
  it('空 owner 抛错', () => {
    expect(() => reg.acquire('ball:thread:42', '', 300)).toThrowError(/owner 不能为空/);
  });
  it('ttl_seconds <= 0 抛错', () => {
    expect(() => reg.acquire('ball:thread:42', 'alice', 0)).toThrowError(/必须为正数/);
    expect(() => reg.acquire('ball:thread:42', 'alice', -5)).toThrowError(/必须为正数/);
    expect(() => reg.acquire('ball:thread:42', 'alice', Number.NaN)).toThrowError(/必须为正数/);
  });
});

describe('F005 AC-A5：release 后 current_holder 返回 None', () => {
  it('主动释放后球权显式归还（INV-3）', () => {
    const reg = new BallCustodyRegistry();
    const leaseId = reg.acquire('ball:thread:42', 'alice', 300);
    expect(reg.currentHolder('ball:thread:42')).toBe('alice');
    reg.release(leaseId);
    expect(reg.currentHolder('ball:thread:42')).toBeNull();
  });

  it('release 未知 lease_id 幂等静默', () => {
    const reg = new BallCustodyRegistry();
    expect(() => reg.release('lease-0000000000')).not.toThrow();
  });
});

describe('F005 AC-A6：renew 续约', () => {
  it('expires_at 更新为 now + DEFAULT_TTL_SECONDS', () => {
    const clock = makeClock();
    const reg = new BallCustodyRegistry(clock.nowFn);
    const leaseId = reg.acquire('ball:thread:42', 'alice', 10);
    clock.advance(9_000); // 未过期但临近
    reg.renew(leaseId);
    expect(reg.isExpired(leaseId)).toBe(false);
    clock.advance((DEFAULT_TTL_SECONDS - 1) * 1000); // 快进到接近新 expiry
    expect(reg.isExpired(leaseId)).toBe(false);
    clock.advance(2_000);
    expect(reg.isExpired(leaseId)).toBe(true);
    expect(reg.metrics().renewCount).toBe(1);
  });

  it('renew 未知 lease_id 抛错', () => {
    const reg = new BallCustodyRegistry();
    expect(() => reg.renew('lease-0000000000')).toThrowError(BallCustodyError);
    expect(() => reg.renew('lease-0000000000')).toThrowError(/unknown lease_id/);
  });

  it('过期 lease 可续约（持球者回归）；被他人 acquire 后旧 lease 已被懒清理删除', () => {
    const clock = makeClock();
    const reg = new BallCustodyRegistry(clock.nowFn);
    const leaseId = reg.acquire('ball:thread:42', 'alice', 10);
    clock.advance(10_001); // 过期
    reg.acquire('ball:thread:42', 'bob', 300); // bob 抢走（懒清理删除 alice 旧 lease）
    // 旧 lease 已被懒清理 → renew 视为未知
    expect(() => reg.renew(leaseId)).toThrowError(/unknown lease_id/);
    expect(reg.currentHolder('ball:thread:42')).toBe('bob');
    // 无竞争时过期续约成功（持球者回归，renew 允许过期续约）
    const reg2 = new BallCustodyRegistry(clock.nowFn);
    const l2 = reg2.acquire('ball:thread:7', 'alice', 10);
    clock.advance(10_001);
    reg2.renew(l2);
    expect(reg2.isExpired(l2)).toBe(false);
  });
});

describe('F005 AC-A7：current_holder 对过期 lease 返回 None', () => {
  it('过期后查询返回 None（不主动清理，仅查询）', () => {
    const clock = makeClock();
    const reg = new BallCustodyRegistry(clock.nowFn);
    reg.acquire('ball:thread:42', 'alice', 10);
    clock.advance(10_001);
    expect(reg.currentHolder('ball:thread:42')).toBeNull();
    // 但此时 TTL 过期已懒清理（current_holder 调用），metrics 计数
    expect(reg.metrics().ttlExpiryCount).toBe(1);
  });
});

describe('F005 AC-A8：is_expired 对未知 lease 返回 True', () => {
  it('未知 lease_id 视为过期（INV-6，调用方可安全 evict）', () => {
    const reg = new BallCustodyRegistry();
    expect(reg.isExpired('lease-deadbeef00')).toBe(true);
  });
});

describe('F005 AC-A9：now_fn 注入确定性快进', () => {
  it('快进时间无需 sleep 即可触发 TTL 过期（FM-3 缓解）', () => {
    const clock = makeClock();
    const reg = new BallCustodyRegistry(clock.nowFn);
    reg.acquire('ball:thread:42', 'alice', 1);
    expect(reg.currentHolder('ball:thread:42')).toBe('alice');
    clock.advance(1_001); // 1s TTL 过期
    expect(reg.currentHolder('ball:thread:42')).toBeNull();
  });
});

describe('F005 监控指标（§2.6）', () => {
  it('metrics 汇总冲突 / 过期 / 续约 / 活跃数', () => {
    const clock = makeClock();
    const reg = new BallCustodyRegistry(clock.nowFn);
    reg.acquire('ball:thread:1', 'alice', 300);
    reg.acquire('ball:thread:2', 'bob', 10);
    reg.acquire('ball:thread:3', 'carol', 300);
    reg.release(reg.acquire('ball:thread:4', 'dave', 300));
    expect(reg.metrics().activeLeaseCount).toBe(3);
    clock.advance(10_001); // thread:2 过期
    expect(reg.currentHolder('ball:thread:2')).toBeNull();
    const m = reg.metrics();
    expect(m.activeLeaseCount).toBe(2);
    expect(m.ttlExpiryCount).toBe(1);
    expect(m.acquireConflictCount).toBe(0);
    expect(m.renewCount).toBe(0);
  });
});
