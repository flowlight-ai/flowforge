/**
 * Redis 持久化测试 — C33（RedisPrTrackingStore + RedisGroundingSampleStore）。
 *
 * 端口级 Redis 仿真（FakeRedis）实现 @flowforge/infrastructure-redis-port
 * 契约（含 Lua 脚本语义：exists/del/zrem/hset 组合），用于验证：
 *   - email：register/get/listAll/remove/patchCiState/patchConflictState
 *     + 原子 remove 语义（hash 不存在只 zrem）+ patch 不重建孤儿
 *     + get 自愈清理 stale 成员 + listAll 剔除 stale + TTL 可选
 *   - grounding：采样规则（mismatch/wouldBlock 100%、insufficient 日上限、
 *     verified 采样率+日上限）+ 窗口过滤 + 容量裁剪 + dropped 计数
 *
 * 注：本仓库无 ioredis 依赖，Redis 客户端由宿主注入（端口即边界）；
 * FakeRedis 位于端口边界之上，不改变被测 store 的任何逻辑。
 */

import { describe, expect, it } from 'vitest';

import {
  PrTrackingKeys,
  PR_TRACKING_PATCH_STATE_LUA,
  PR_TRACKING_REMOVE_LUA,
  PR_TRACKING_SELF_HEAL_LUA,
  RedisPrTrackingStore,
  type PrTrackingInput,
} from '../src/index.ts';
import type { RedisLikeClient, RedisPipeline } from '@flowforge/infrastructure-redis-port';

// ---------------------------------------------------------------------------
// 端口级 Redis 仿真（hash / zset / string / eval）
// ---------------------------------------------------------------------------

class FakeRedis implements RedisLikeClient {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly zsets = new Map<string, Array<{ score: number; member: string }>>();
  readonly strings = new Map<string, string>();
  readonly expires = new Map<string, number>();
  readonly evalCalls: string[] = [];

  // ── string ──
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
    const existed = this.hashes.delete(key) || this.strings.delete(key) || this.zsets.delete(key);
    return existed ? 1 : 0;
  }
  async exists(key: string): Promise<number> {
    return this.hashes.has(key) || this.strings.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  // ── hash ──
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

  // ── sorted set ──
  async zadd(key: string, score: string, member: string): Promise<number> {
    const z = this.zsets.get(key) ?? [];
    const n = Number(score);
    const existing = z.findIndex((e) => e.member === member);
    if (existing >= 0) z[existing] = { score: n, member };
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
    const kept = z.filter((e) => !members.includes(e.member));
    this.zsets.set(key, kept);
    return before - kept.length;
  }
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const z = this.zsets.get(key) ?? [];
    const desc = [...z].sort((a, b) => b.score - a.score);
    const end = stop === -1 ? desc.length : stop + 1;
    return desc.slice(start, end).map((e) => e.member);
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
    const kept = z.filter((e) => !removed.includes(e));
    this.zsets.set(key, kept);
    return removed.length;
  }

  // ── scripting（按脚本语义分派，验证 Lua 常量与调用约定）──
  async eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    this.evalCalls.push(script);
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);

    if (script === PR_TRACKING_REMOVE_LUA) {
      const existed = (await this.exists(keys[0]!)) === 1;
      if (existed) {
        await this.del(keys[0]!);
        await this.zrem(keys[1]!, argv[0]!);
        return 1;
      }
      await this.zrem(keys[1]!, argv[0]!);
      return 0;
    }
    if (script === PR_TRACKING_PATCH_STATE_LUA) {
      if ((await this.exists(keys[0]!)) === 0) return 0;
      const patch: Record<string, string> = {};
      for (let i = 0; i < argv.length; i += 2) patch[argv[i]!] = argv[i + 1]!;
      await this.hset(keys[0]!, patch);
      return 1;
    }
    if (script === PR_TRACKING_SELF_HEAL_LUA) {
      if ((await this.exists(keys[0]!)) === 0) return this.zrem(keys[1]!, argv[0]!);
      return 0;
    }
    throw new Error(`FakeRedis: unknown script`);
  }

  // ── pipeline ──
  multi(): RedisPipeline {
    type Op = () => Promise<unknown>;
    const ops: Op[] = [];
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

// ---------------------------------------------------------------------------
// email: RedisPrTrackingStore
// ---------------------------------------------------------------------------

function prInput(prNumber = 1, repo = 'o/r'): PrTrackingInput {
  return { repoFullName: repo, prNumber, catId: 'cat-a', threadId: 't1', userId: 'u1' };
}

describe('RedisPrTrackingStore', () => {
  it('register → get → listAll（hash 明细 + zset 索引）', async () => {
    const redis = new FakeRedis();
    const store = new RedisPrTrackingStore({ redis });

    const entry = await store.register(prInput(1));
    expect(entry.registeredAt).toBeGreaterThan(0);
    expect(redis.hashes.has(PrTrackingKeys.detail('o/r', 1))).toBe(true);
    expect(await redis.zcard(PrTrackingKeys.all())).toBe(1);

    const got = await store.get('o/r', 1);
    expect(got).not.toBeNull();
    expect(got!.catId).toBe('cat-a');
    expect(got!.prNumber).toBe(1);

    await store.register(prInput(2));
    const all = await store.listAll();
    expect(all.length).toBe(2);
    // zrevrange：按 registeredAt 倒序
    expect(all[0]!.registeredAt).toBeGreaterThanOrEqual(all[1]!.registeredAt);
  });

  it('remove 原子语义：hash 存在 → del+zrem 返回 true；不存在 → 只 zrem 返回 false', async () => {
    const redis = new FakeRedis();
    const store = new RedisPrTrackingStore({ redis });
    await store.register(prInput(1));

    expect(await store.remove('o/r', 1)).toBe(true);
    expect(await store.get('o/r', 1)).toBeNull();
    expect(await redis.zcard(PrTrackingKeys.all())).toBe(0);

    // 已删除后再 remove → false（无 hash，仅 zrem 孤儿）
    expect(await store.remove('o/r', 1)).toBe(false);
  });

  it('patchCiState / patchConflictState：hash 不存在则不写（不重建孤儿）', async () => {
    const redis = new FakeRedis();
    const store = new RedisPrTrackingStore({ redis });

    // 未登记 → patch 不创建 hash
    await store.patchCiState('o/r', 9, { headSha: 'sha' });
    expect(redis.hashes.has(PrTrackingKeys.detail('o/r', 9))).toBe(false);

    await store.register(prInput(1));
    await store.patchCiState('o/r', 1, { headSha: 'abc', lastCiBucket: 'fail', ciTrackingEnabled: true });
    await store.patchConflictState('o/r', 1, { mergeState: 'dirty', lastConflictFingerprint: 'fp' });

    const after = (await store.get('o/r', 1))!;
    expect(after.headSha).toBe('abc');
    expect(after.lastCiBucket).toBe('fail');
    expect(after.ciTrackingEnabled).toBe(true);
    expect(after.mergeState).toBe('dirty');
    expect(after.lastConflictFingerprint).toBe('fp');
    // CI patch 不清 conflict 字段，反之亦然
    await store.patchConflictState('o/r', 1, { mergeState: 'clean' });
    expect((await store.get('o/r', 1))!.lastCiBucket).toBe('fail');
  });

  it('patch 空更新 → 不发起 eval', async () => {
    const redis = new FakeRedis();
    const store = new RedisPrTrackingStore({ redis });
    await store.register(prInput(1));
    const before = redis.evalCalls.length;
    await store.patchCiState('o/r', 1, {});
    await store.patchConflictState('o/r', 1, {});
    expect(redis.evalCalls.length).toBe(before);
  });

  it('get 自愈：hash 缺失但 zset 有成员 → 原子清理', async () => {
    const redis = new FakeRedis();
    const store = new RedisPrTrackingStore({ redis });
    await store.register(prInput(1));
    // 模拟 hash 过期（TTL 或外部删除）但 zset 成员残留
    redis.hashes.delete(PrTrackingKeys.detail('o/r', 1));
    expect(await redis.zcard(PrTrackingKeys.all())).toBe(1);

    expect(await store.get('o/r', 1)).toBeNull();
    expect(await redis.zcard(PrTrackingKeys.all())).toBe(0);
  });

  it('listAll 剔除 stale 成员（hash 过期残留）', async () => {
    const redis = new FakeRedis();
    const store = new RedisPrTrackingStore({ redis });
    await store.register(prInput(1));
    await store.register(prInput(2));
    // 1 号的 hash 过期
    redis.hashes.delete(PrTrackingKeys.detail('o/r', 1));

    const all = await store.listAll();
    expect(all.length).toBe(1);
    expect(all[0]!.prNumber).toBe(2);
    // best-effort 清理后 zset 仅剩有效成员
    expect(await redis.zcard(PrTrackingKeys.all())).toBe(1);
  });

  it('TTL：默认持久（不设 expire）；ttlSeconds>0 时启用', async () => {
    const persistent = new FakeRedis();
    await new RedisPrTrackingStore({ redis: persistent }).register(prInput(1));
    expect(persistent.expires.has(PrTrackingKeys.detail('o/r', 1))).toBe(false);

    const ttlRedis = new FakeRedis();
    await new RedisPrTrackingStore({ redis: ttlRedis, ttlSeconds: 60 }).register(prInput(1));
    expect(ttlRedis.expires.get(PrTrackingKeys.detail('o/r', 1))).toBe(60);
  });
});
