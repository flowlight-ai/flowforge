/**
 * 端口级 Redis 仿真（FakeConnectorRedis）实现本包 `ConnectorRedisClient` 契约。
 *
 * 契约是 ioredis 的最小子集（multi/pipeline + hash/set/zset/string + eval）。
 * 本仿真位于端口边界之上，不改动被测 store 的任何逻辑；`eval` 仅实现了
 * ConnectorThreadBindingStore 的 BIND Lua 语义（SREM/HSET/SADD/ZADD 组合）。
 * 遵循测试铁律：端口桩（FakeRedis），非被测单元的 mock。
 */

import type { ConnectorRedisClient, ConnectorRedisPipeline } from '../../src/connector-redis-client';

interface ZMember {
  score: number;
  member: string;
}

type Op =
  | { method: 'hset'; key: string; values: Record<string, string> }
  | { method: 'hgetall'; key: string }
  | { method: 'zadd'; key: string; score: string; member: string }
  | { method: 'expire'; key: string; seconds: number }
  | { method: 'del'; key: string }
  | { method: 'srem'; key: string; members: string[] }
  | { method: 'zrem'; key: string; members: string[] }
  | { method: 'hdel'; key: string; fields: string[] };

class FakeConnectorRedisPipeline implements ConnectorRedisPipeline {
  private readonly ops: Op[] = [];
  constructor(private readonly owner: FakeConnectorRedis) {}

  hset(key: string, values: Record<string, string>): void {
    this.ops.push({ method: 'hset', key, values });
  }
  hgetall(key: string): void {
    this.ops.push({ method: 'hgetall', key });
  }
  zadd(key: string, score: string, member: string): void {
    this.ops.push({ method: 'zadd', key, score, member });
  }
  expire(key: string, seconds: number): void {
    this.ops.push({ method: 'expire', key, seconds });
  }
  del(key: string): void {
    this.ops.push({ method: 'del', key });
  }
  srem(key: string, ...members: string[]): void {
    this.ops.push({ method: 'srem', key, members });
  }
  zrem(key: string, ...members: string[]): void {
    this.ops.push({ method: 'zrem', key, members });
  }
  hdel(key: string, ...fields: string[]): void {
    this.ops.push({ method: 'hdel', key, fields });
  }
  async exec(): Promise<Array<[Error | null, unknown]> | null> {
    const results: Array<[Error | null, unknown]> = [];
    for (const op of this.ops) {
      try {
        results.push([null, await this.dispatch(op)]);
      } catch (err) {
        results.push([err as Error, null]);
      }
    }
    return results;
  }

  private async dispatch(op: Op): Promise<unknown> {
    const owner = this.owner;
    switch (op.method) {
      case 'hset':
        return await owner.hset(op.key, op.values);
      case 'hgetall':
        return await owner.hgetall(op.key);
      case 'del':
        return await owner.del(op.key);
      case 'srem':
        return await owner.srem(op.key, ...op.members);
      case 'zrem':
        return await owner.zrem(op.key, ...op.members);
      case 'hdel':
        return await owner.hdel(op.key, ...op.fields);
      case 'zadd':
        return await owner.zadd(op.key, op.score, op.member);
      case 'expire':
        return await owner.expire(op.key, op.seconds);
    }
  }
}

export class FakeConnectorRedis implements ConnectorRedisClient {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly sets = new Map<string, Set<string>>();
  readonly zsets = new Map<string, ZMember[]>();
  readonly strings = new Map<string, string>();

  // ── string ──
  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }
  async incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }
  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }
  async del(key: string): Promise<number> {
    let existed = false;
    existed = this.hashes.delete(key) || existed;
    existed = this.strings.delete(key) || existed;
    existed = this.sets.delete(key) || existed;
    existed = this.zsets.delete(key) || existed;
    return existed ? 1 : 0;
  }
  async exists(key: string): Promise<number> {
    return this.hashes.has(key) || this.strings.has(key) || this.sets.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  // ── hash ──
  async hset(key: string, values: Record<string, string>): Promise<number> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    for (const [f, v] of Object.entries(values)) h.set(f, v);
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
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    const next = Number(h.get(field) ?? '0') + increment;
    h.set(field, String(next));
    return next;
  }
  async hdel(key: string, ...fields: string[]): Promise<number> {
    const h = this.hashes.get(key);
    if (!h) return 0;
    let removed = 0;
    for (const f of fields) {
      if (h.delete(f)) removed++;
    }
    if (h.size === 0) this.hashes.delete(key);
    return removed;
  }
  async hexists(key: string, field: string): Promise<number> {
    return this.hashes.get(key)?.has(field) ? 1 : 0;
  }

  // ── set ──
  async smembers(key: string): Promise<string[]> {
    const s = this.sets.get(key);
    return s ? [...s] : [];
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(m)) removed++;
    }
    return removed;
  }

  // ── sorted set ──
  async zadd(key: string, score: string, member: string): Promise<number> {
    let z = this.zsets.get(key);
    if (!z) {
      z = [];
      this.zsets.set(key, z);
    }
    const n = Number(score);
    const idx = z.findIndex((e) => e.member === member);
    if (idx >= 0) z[idx] = { score: n, member };
    else z.push({ score: n, member });
    z.sort((a, b) => a.score - b.score);
    return 1;
  }
  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.length ?? 0;
  }
  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    const before = z.length;
    const after = z.filter((e) => !members.includes(e.member));
    this.zsets.set(key, after);
    return before - after.length;
  }
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const z = this.zsets.get(key) ?? [];
    const desc = [...z].sort((a, b) => b.score - a.score);
    return desc.slice(start, stop < 0 ? undefined : stop + 1).map((e) => e.member);
  }
  async zrangebyscore(key: string, min: string, max: string): Promise<string[]> {
    const z = this.zsets.get(key) ?? [];
    const mn = Number(min);
    const mx = Number(max);
    return z.filter((e) => e.score >= mn && e.score <= mx).map((e) => e.member);
  }
  async zremrangebyscore(key: string, min: string, max: string): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    const before = z.length;
    const mn = Number(min);
    const mx = Number(max);
    const after = z.filter((e) => e.score < mn || e.score > mx);
    this.zsets.set(key, after);
    return before - after.length;
  }
  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    const before = z.length;
    const removedMembers = new Set(
      [...z].sort((a, b) => a.score - b.score).slice(start, stop < 0 ? undefined : stop + 1).map((e) => e.member),
    );
    const after = z.filter((e) => !removedMembers.has(e.member));
    this.zsets.set(key, after);
    return before - after.length;
  }

  // ── scripting ──
  async eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    // 仅实现 ConnectorThreadBindingStore 的 BIND Lua（含 SREM 清理旧索引）。
    if (script.includes('SREM')) {
      const keys = args.slice(0, numKeys).map(String);
      const [hashKey, newRevKey, newUserKey] = keys;
      const a0 = numKeys;
      const memberKey = String(args[a0]);
      const connectorId = String(args[a0 + 1]);
      const externalChatId = String(args[a0 + 2]);
      const threadId = String(args[a0 + 3]);
      const userId = String(args[a0 + 4]);
      const createdAt = String(args[a0 + 5]);
      const userPrefix = String(args[a0 + 6]);

      // 旧绑定反向索引清理
      const oldHash = this.hashes.get(hashKey);
      const oldThreadId = oldHash?.get('threadId');
      const oldUserId = oldHash?.get('userId');
      const oldConnectorId = oldHash?.get('connectorId');
      if (oldThreadId && oldThreadId !== threadId) {
        const oldRevKey = `connector-binding-rev:${oldThreadId}`;
        this.sets.get(oldRevKey)?.delete(memberKey);
      }
      if (oldUserId && oldConnectorId && (oldUserId !== userId || oldConnectorId !== connectorId)) {
        const oldUserKey = `${userPrefix}${oldConnectorId}:${oldUserId}`;
        this.zsets.set(oldUserKey, (this.zsets.get(oldUserKey) ?? []).filter((e) => e.member !== memberKey));
      }

      await this.hset(hashKey, { connectorId, externalChatId, threadId, userId, createdAt });
      let rev = this.sets.get(newRevKey);
      if (!rev) {
        rev = new Set();
        this.sets.set(newRevKey, rev);
      }
      rev.add(memberKey);
      await this.zadd(newUserKey, createdAt, memberKey);
      return 1;
    }
    return 1;
  }

  // ── pipeline ──
  multi(): ConnectorRedisPipeline {
    return new FakeConnectorRedisPipeline(this);
  }
}