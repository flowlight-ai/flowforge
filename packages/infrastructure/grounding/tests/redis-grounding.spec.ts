/**
 * RedisGroundingSampleStore 测试 — C33（PR-O5 Redis 采样持久化）。
 *
 * 复用端口级 FakeRedis（语义同 email 测试）；验证采样规则（mismatch/wouldBlock
 * 100%、insufficient 日上限、verified 采样率+日上限）+ 8 天 TTL + 窗口过滤
 * （P1 滚动窗口 + Cloud P2 读时清理）+ 容量裁剪 + dropped 计数 + 跨"重启"
 * 持久化（新 store 实例读同一 FakeRedis）。
 */

import { describe, expect, it } from 'vitest';

import {
  GROUNDING_REDIS_KEYS,
  RedisGroundingSampleStore,
  type ClaimGroundingEvent,
} from '../src/index.ts';
import type { RedisLikeClient, RedisPipeline } from '@flowforge/infrastructure-redis-port';

// ── 端口级 Redis 仿真（与 email 测试同构，就地保留避免跨包依赖测试文件）──

class FakeRedis implements RedisLikeClient {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly zsets = new Map<string, Array<{ score: number; member: string }>>();
  readonly strings = new Map<string, string>();
  readonly expires = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }
  async incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }
  async expire(key: string, seconds: number): Promise<number> {
    this.expires.set(key, seconds);
    return 1;
  }
  async del(key: string): Promise<number> {
    return (this.hashes.delete(key) || this.strings.delete(key) || this.zsets.delete(key)) ? 1 : 0;
  }
  async exists(key: string): Promise<number> {
    return this.hashes.has(key) || this.strings.has(key) || this.zsets.has(key) ? 1 : 0;
  }
  async hset(key: string, values: Record<string, string>): Promise<number> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    for (const [f, v] of Object.entries(values)) h.set(f, v);
    this.hashes.set(key, h);
    return Object.keys(values).length;
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(key);
    return h ? Object.fromEntries(h) : {};
  }
  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    const next = Number(h.get(field) ?? '0') + increment;
    h.set(field, String(next));
    this.hashes.set(key, h);
    return next;
  }
  async zadd(key: string, score: string, member: string): Promise<number> {
    const z = this.zsets.get(key) ?? [];
    const n = Number(score);
    const existing = z.findIndex((e) => e.member === member);
    if (existing >= 0) z[existing] = { score: n, member: n === 0 ? member : member };
    else z.push({ score: n, member });
    z.sort((a, b) => a.score - b.score);
    this.zsets.set(key, z);
    return 1;
  }
  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.length ?? 0;
  }
  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    const before = z.length;
    this.zsets.set(key, z.filter((e) => !members.includes(e.member)));
    return before - z.length;
  }
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const z = [...(this.zsets.get(key) ?? [])].sort((a, b) => b.score - a.score);
    const end = stop === -1 ? z.length : stop + 1;
    return z.slice(start, end).map((e) => e.member);
  }
  async zrangebyscore(key: string, min: string, max: string): Promise<string[]> {
    const z = this.zsets.get(key) ?? [];
    const lo = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
    const hi = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
    return z.filter((e) => e.score >= lo && e.score <= hi).map((e) => e.member);
  }
  async zremrangebyscore(key: string, min: string, max: string): Promise<number> {
    const z = this.zsets.get(key) ?? [];
    const lo = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
    const hi = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
    const kept = z.filter((e) => !(e.score >= lo && e.score <= hi));
    this.zsets.set(key, kept);
    return z.length - kept.length;
  }
  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const z = this.zsets.get(key) ?? [];
    const sorted = [...z].sort((a, b) => a.score - b.score);
    const removed = sorted.slice(start, stop + 1);
    this.zsets.set(key, z.filter((e) => !removed.includes(e)));
    return removed.length;
  }
  async eval(): Promise<unknown> {
    throw new Error('FakeRedis: eval not used by grounding store');
  }
  multi(): RedisPipeline {
    const ops: Array<() => Promise<unknown>> = [];
    const self = this;
    return {
      hset(key, values) {
        ops.push(() => self.hset(key, values));
      },
      hgetall(key) {
        ops.push(() => self.hgetall(key));
      },
      zadd(key, score, member) {
        ops.push(() => self.zadd(key, score, member));
      },
      expire(key, seconds) {
        ops.push(() => self.expire(key, seconds));
      },
      del(key) {
        ops.push(() => self.del(key));
      },
      async exec() {
        const out: Array<[Error | null, unknown]> = [];
        for (const op of ops) {
          try {
            out.push([null, await op()]);
          } catch (err) {
            out.push([err as Error, null]);
          }
        }
        return out;
      },
    };
  }
}

// ── helpers ─────────────────────────────────────────────────

function event(verdict: ClaimGroundingEvent['verdict'], ts = Date.now(), resolver = 'r1', threadId = 't1'): ClaimGroundingEvent {
  return {
    invocationId: 'i', catId: 'c', threadId, claimType: 'wait', sourceKind: 'self',
    sourceRef: { kind: 'messageId', value: 'm' }, resolver, resolverSourceTier: 'T1',
    cacheHit: false, verdict, actionFamily: 'wait', actionRisk: 'hold_ball', tool: 'hold_ball', ts,
    resolverCallsRemaining: 0,
  };
}

// ── 测试 ─────────────────────────────────────────────────────

describe('RedisGroundingSampleStore', () => {
  it('mismatch/wouldBlock 100% 保留；insufficient 日上限；verified 采样+日上限；dropped 计数', async () => {
    const redis = new FakeRedis();
    const store = new RedisGroundingSampleStore(redis, {
      maxTotal: 100,
      insufficientCap: 2,
      verifiedDailyCap: 1,
      shouldSampleVerified: () => true,
    });

    const base = Date.now();
    await store.record(event('mismatch', base), false); // keep
    await store.record(event('verified', base + 1), true); // wouldBlock → keep
    await store.record(event('insufficient', base + 2), false); // keep (1/2)
    await store.record(event('insufficient', base + 3), false); // keep (2/2)
    await store.record(event('insufficient', base + 4), false); // 超上限 → drop
    await store.record(event('verified', base + 5), false); // 采样命中 → keep
    await store.record(event('verified', base + 6), false); // 日上限 → drop

    const stats = await store.getStats();
    expect(stats.stored).toBe(5);
    expect(stats.dropped).toBe(2);
    // dropped 计数已持久化
    expect(await redis.get(GROUNDING_REDIS_KEYS.droppedCounter)).toBe('2');
    // samples 集合设了 8 天 TTL
    expect(redis.expires.get(GROUNDING_REDIS_KEYS.samples)).toBe(8 * 24 * 60 * 60);
  });

  it('窗口过滤（P1）：滚动窗口内读取，窗口外采样不可见且读时清理（Cloud P2）', async () => {
    const redis = new FakeRedis();
    const store = new RedisGroundingSampleStore(redis, { ttlSeconds: 60, shouldSampleVerified: () => true });
    const now = Date.now();
    await store.record(event('mismatch', now), false); // fresh
    await store.record(event('mismatch', now - 120_000), false); // 窗口外（2 分钟前）

    const samples = await store.getSamples();
    expect(samples.length).toBe(1);
    expect(samples[0]!.ts).toBe(now);
    // 读时清理后 zcard 准确
    expect(await redis.zcard(GROUNDING_REDIS_KEYS.samples)).toBe(1);
  });

  it('容量裁剪：超 maxTotal 淘汰最旧（最低 score）', async () => {
    const redis = new FakeRedis();
    const store = new RedisGroundingSampleStore(redis, { maxTotal: 2, shouldSampleVerified: () => true });
    const now = Date.now();
    await store.record(event('mismatch', now), false);
    await store.record(event('mismatch', now + 1), false);
    await store.record(event('mismatch', now + 2), false);

    const samples = await store.getSamples();
    expect(samples.length).toBe(2);
    expect(samples[0]!.ts).toBe(now + 1);
  });

  it('跨"重启"持久化：新 store 实例读同一 Redis 仍可见', async () => {
    const redis = new FakeRedis();
    const store1 = new RedisGroundingSampleStore(redis, { shouldSampleVerified: () => true });
    await store1.record(event('mismatch', Date.now()), false);

    const store2 = new RedisGroundingSampleStore(redis, { shouldSampleVerified: () => true });
    const samples = await store2.getSamples();
    expect(samples.length).toBe(1);
    expect(samples[0]!.verdict).toBe('mismatch');
  });

  it('insufficient 上限按 resolver×thread×day 分别计数', async () => {
    const redis = new FakeRedis();
    const store = new RedisGroundingSampleStore(redis, { insufficientCap: 1, shouldSampleVerified: () => true });
    const now = Date.now();
    await store.record(event('insufficient', now, 'r1', 't1'), false); // keep
    await store.record(event('insufficient', now, 'r1', 't1'), false); // drop（同 key 超限）
    await store.record(event('insufficient', now, 'r2', 't1'), false); // keep（不同 resolver）
    await store.record(event('insufficient', now, 'r1', 't2'), false); // keep（不同 thread）

    const stats = await store.getStats();
    expect(stats.stored).toBe(3);
    expect(stats.dropped).toBe(1);
  });
});
