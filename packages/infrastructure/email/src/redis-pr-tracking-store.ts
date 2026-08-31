/**
 * Redis-backed PR Tracking Store（C33 Redis 持久化）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/RedisPrTrackingStore.ts`：
 *   - 存储布局：Hash `pr-tracking:{repo}#{n}`（明细） + ZSet `pr-tracking:all`（索引，score=registeredAt）
 *   - 原子性：remove 与 patchCiState 走 Lua（避免孤儿重建 / zset 残留）
 *   - 自愈：get 命中空 hash 时按 exists 判定原子清理 zset 成员；
 *     listAll 剔除 stale 成员（hash 过期但 zset 残留）
 *   - TTL：默认持久（0）；>0 时启用过期
 *
 * 插件化改造：clowder `RedisClient`（ioredis 具体类型）→ 注入式
 * `RedisLikeClient` 端口（@flowforge/infrastructure-redis-port）。
 *
 * @module @flowforge/infrastructure-email/redis-pr-tracking-store
 */

import type { RedisLikeClient } from '@flowforge/infrastructure-redis-port';

import {
  PrTrackingKeys,
  type CiStateFields,
  type ConflictStateFields,
  type PrTrackingEntry,
  type PrTrackingInput,
} from './pr-tracking-store.ts';

/**
 * Lua: 原子 remove — 仅当 hash 仍存在时 del+zrem；否则只 zrem 孤儿成员。
 * 防止「hash 已过期但 zset 成员残留」与「并发 register 后被误删」。
 */
export const PR_TRACKING_REMOVE_LUA = `
local existed = redis.call("exists", KEYS[1])
if existed == 1 then
  redis.call("del", KEYS[1])
  redis.call("zrem", KEYS[2], ARGV[1])
  return 1
else
  redis.call("zrem", KEYS[2], ARGV[1])
  return 0
end
`.trim();

/** Lua: 原子 patchCiState — hash 不存在则不写（防止孤儿重建）。 */
export const PR_TRACKING_PATCH_STATE_LUA = `
if redis.call("exists", KEYS[1]) == 0 then return 0 end
for i = 1, #ARGV, 2 do
  redis.call("hset", KEYS[1], ARGV[i], ARGV[i + 1])
end
return 1
`.trim();

/** Lua: get 自愈 — hash 仍不存在才 zrem（避免与并发 register 竞态）。 */
export const PR_TRACKING_SELF_HEAL_LUA = `
if redis.call("exists",KEYS[1])==0 then return redis.call("zrem",KEYS[2],ARGV[1]) end return 0
`.trim();

/** 默认持久（0）；>0 启用 TTL 过期。 */
const DEFAULT_TTL_SECONDS = 0;

export interface RedisPrTrackingStoreOptions {
  redis: RedisLikeClient;
  /** TTL 秒；<=0 或不合法 → 持久。 */
  ttlSeconds?: number;
}

export class RedisPrTrackingStore {
  private readonly redis: RedisLikeClient;
  private readonly ttlSeconds: number | null;

  constructor(opts: RedisPrTrackingStoreOptions) {
    this.redis = opts.redis;
    const raw = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.ttlSeconds = !Number.isFinite(raw) || raw <= 0 ? null : Math.floor(raw);
  }

  async register(input: PrTrackingInput): Promise<PrTrackingEntry> {
    const entry: PrTrackingEntry = { ...input, registeredAt: Date.now() };
    const key = PrTrackingKeys.detail(input.repoFullName, input.prNumber);
    const allKey = PrTrackingKeys.all();
    const member = `${input.repoFullName}#${input.prNumber}`;

    const pipeline = this.redis.multi();
    pipeline.hset(key, this.serialize(entry));
    if (this.ttlSeconds !== null) {
      pipeline.expire(key, this.ttlSeconds);
    }
    pipeline.zadd(allKey, String(entry.registeredAt), member);
    await pipeline.exec();

    return entry;
  }

  async get(repoFullName: string, prNumber: number): Promise<PrTrackingEntry | null> {
    const key = PrTrackingKeys.detail(repoFullName, prNumber);
    const data = await this.redis.hgetall(key);
    if (!data || !data.repoFullName) {
      // Atomic self-heal: only zrem if hash is still absent (avoids racing with concurrent register)
      const member = `${repoFullName}#${prNumber}`;
      this.redis
        .eval(PR_TRACKING_SELF_HEAL_LUA, 2, key, PrTrackingKeys.all(), member)
        .catch(() => {});
      return null;
    }
    return this.hydrate(data);
  }

  async remove(repoFullName: string, prNumber: number): Promise<boolean> {
    const key = PrTrackingKeys.detail(repoFullName, prNumber);
    const member = `${repoFullName}#${prNumber}`;
    const result = await this.redis.eval(PR_TRACKING_REMOVE_LUA, 2, key, PrTrackingKeys.all(), member);
    return result === 1;
  }

  async patchCiState(repoFullName: string, prNumber: number, ciFields: CiStateFields): Promise<void> {
    const updates: Record<string, string> = {};
    if (ciFields.headSha !== undefined) updates.headSha = ciFields.headSha;
    if (ciFields.lastCiFingerprint !== undefined) updates.lastCiFingerprint = ciFields.lastCiFingerprint;
    if (ciFields.lastCiBucket !== undefined) updates.lastCiBucket = ciFields.lastCiBucket;
    if (ciFields.lastCiNotifiedAt !== undefined) updates.lastCiNotifiedAt = String(ciFields.lastCiNotifiedAt);
    if (ciFields.ciTrackingEnabled !== undefined) updates.ciTrackingEnabled = String(ciFields.ciTrackingEnabled);
    if (Object.keys(updates).length === 0) return;
    await this.applyPatch(repoFullName, prNumber, updates);
  }

  async patchConflictState(
    repoFullName: string,
    prNumber: number,
    conflictFields: ConflictStateFields,
  ): Promise<void> {
    const updates: Record<string, string> = {};
    if (conflictFields.lastConflictFingerprint !== undefined)
      updates.lastConflictFingerprint = conflictFields.lastConflictFingerprint;
    if (conflictFields.lastConflictNotifiedAt !== undefined)
      updates.lastConflictNotifiedAt = String(conflictFields.lastConflictNotifiedAt);
    if (conflictFields.mergeState !== undefined) updates.mergeState = conflictFields.mergeState;
    if (Object.keys(updates).length === 0) return;
    await this.applyPatch(repoFullName, prNumber, updates);
  }

  private async applyPatch(repoFullName: string, prNumber: number, updates: Record<string, string>): Promise<void> {
    const key = PrTrackingKeys.detail(repoFullName, prNumber);
    const argv = Object.entries(updates).flat();
    await this.redis.eval(PR_TRACKING_PATCH_STATE_LUA, 1, key, ...argv);
  }

  async listAll(): Promise<PrTrackingEntry[]> {
    const members = await this.redis.zrevrange(PrTrackingKeys.all(), 0, -1);
    if (members.length === 0) return [];

    const pipeline = this.redis.multi();
    for (const member of members) {
      const [repo, prStr] = splitMember(member);
      if (repo && prStr) {
        pipeline.hgetall(PrTrackingKeys.detail(repo, Number.parseInt(prStr, 10)));
      }
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const entries: PrTrackingEntry[] = [];
    const staleMembers: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;
      const [err, data] = result;
      if (err || !data || typeof data !== 'object') continue;
      const d = data as Record<string, string>;
      if (!d.repoFullName) {
        // Hash expired but sorted set member remains — stale
        const member = members[i];
        if (member) staleMembers.push(member);
        continue;
      }
      entries.push(this.hydrate(d));
    }

    // Best-effort self-healing: remove stale sorted set members
    if (staleMembers.length > 0) {
      this.redis.zrem(PrTrackingKeys.all(), ...staleMembers).catch(() => {});
    }

    return entries;
  }

  private serialize(entry: PrTrackingEntry): Record<string, string> {
    return {
      repoFullName: entry.repoFullName,
      prNumber: String(entry.prNumber),
      catId: entry.catId,
      threadId: entry.threadId,
      userId: entry.userId,
      registeredAt: String(entry.registeredAt),
    };
  }

  private hydrate(data: Record<string, string>): PrTrackingEntry {
    return {
      repoFullName: data.repoFullName!,
      prNumber: Number.parseInt(data.prNumber ?? '0', 10),
      catId: data.catId ?? '',
      threadId: data.threadId ?? '',
      userId: data.userId ?? '',
      registeredAt: Number.parseInt(data.registeredAt ?? '0', 10),
      ...(data.headSha ? { headSha: data.headSha } : {}),
      ...(data.lastCiFingerprint ? { lastCiFingerprint: data.lastCiFingerprint } : {}),
      ...(data.lastCiBucket ? { lastCiBucket: data.lastCiBucket } : {}),
      ...(data.lastCiNotifiedAt ? { lastCiNotifiedAt: Number.parseInt(data.lastCiNotifiedAt, 10) } : {}),
      ...(data.ciTrackingEnabled !== undefined ? { ciTrackingEnabled: data.ciTrackingEnabled === 'true' } : {}),
      ...(data.lastConflictFingerprint ? { lastConflictFingerprint: data.lastConflictFingerprint } : {}),
      ...(data.lastConflictNotifiedAt
        ? { lastConflictNotifiedAt: Number.parseInt(data.lastConflictNotifiedAt, 10) }
        : {}),
      ...(data.mergeState ? { mergeState: data.mergeState } : {}),
    };
  }
}

function splitMember(member: string): [string | undefined, string | undefined] {
  const lastHash = member.lastIndexOf('#');
  if (lastHash <= 0) return [undefined, undefined];
  return [member.slice(0, lastHash), member.slice(lastHash + 1)];
}
