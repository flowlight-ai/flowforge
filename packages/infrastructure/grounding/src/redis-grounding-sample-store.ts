/**
 * F167 Phase O PR-O5: Redis-backed Grounding Sample Store（C33 Redis 持久化）。
 *
 * 以 8 天 TTL 持久化 ClaimGroundingEvent 采样（operator 指令：TTL 必须超过
 * 每周 eval cron 周期，避免 TTL-vs-cron 竞态——采样在 eval 读取前过期）。
 *
 * Storage layout:
 * - `grounding:samples`            — Sorted Set（score=ts, member=JSON）
 * - `grounding:insufficient:{day}` — Hash（field=resolver:threadId, value=count）
 * - `grounding:verified:{day}`     — String（value=count）
 * - `grounding:stats:dropped`      — String（value=count）
 *
 * 采样规则与内存版一致（spec R2 + R3）：mismatch/wouldBlock 100% 保留；
 * insufficient 每 resolver×thread×day 上限 3；verified 1/N + 全局日上限。
 *
 * 插件化改造：clowder `RedisClient`（ioredis）→ 注入式 `RedisLikeClient` 端口。
 *
 * @module @flowforge/infrastructure-grounding/redis-grounding-sample-store
 */

import type { RedisLikeClient } from '@flowforge/infrastructure-redis-port';

import type { ClaimGroundingEvent } from './types.ts';

/** 8 days in seconds (operator: must exceed 7-day eval cron period). */
export const DEFAULT_TTL_SECONDS = 8 * 24 * 60 * 60; // 691200

/** 2 days TTL for daily counter hashes (only needed for cap enforcement). */
export const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60; // 172800

export const GROUNDING_REDIS_KEYS = {
  samples: 'grounding:samples',
  droppedCounter: 'grounding:stats:dropped',
  insufficientPrefix: 'grounding:insufficient:',
  verifiedPrefix: 'grounding:verified:',
} as const;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface RedisGroundingSampleStoreOptions {
  /** Maximum total events stored (oldest evicted on overflow). Default: 1000. */
  maxTotal?: number;
  /** Insufficient cap per resolver×thread×day. Default: 3. */
  insufficientCap?: number;
  /** Verified global daily cap. Default: 50. */
  verifiedDailyCap?: number;
  /** TTL in seconds for the samples sorted set. Default: 691200 (8 days). */
  ttlSeconds?: number;
  /** Injectable sampler for verified events (deterministic testing). */
  shouldSampleVerified?: () => boolean;
  /** Verified sampling rate (1 in N). Default: 20. */
  verifiedSampleRate?: number;
}

export class RedisGroundingSampleStore {
  private readonly redis: RedisLikeClient;
  private readonly maxTotal: number;
  private readonly insufficientCap: number;
  private readonly verifiedDailyCap: number;
  private readonly ttlSeconds: number;
  private readonly shouldSampleVerified: () => boolean;

  constructor(redis: RedisLikeClient, opts: RedisGroundingSampleStoreOptions = {}) {
    this.redis = redis;
    this.maxTotal = opts.maxTotal ?? 1000;
    this.insufficientCap = opts.insufficientCap ?? 3;
    this.verifiedDailyCap = opts.verifiedDailyCap ?? 50;
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const rate = opts.verifiedSampleRate ?? 20;
    this.shouldSampleVerified = opts.shouldSampleVerified ?? (() => Math.random() < 1 / rate);
  }

  /** 按采样规则记录到 Redis sorted set（score=timestamp）。 */
  async record(event: ClaimGroundingEvent, wouldBlock: boolean): Promise<void> {
    if (await this.shouldRecord(event, wouldBlock)) {
      await this.push(event);
    } else {
      await this.redis.incr(GROUNDING_REDIS_KEYS.droppedCounter);
      await this.redis.expire(GROUNDING_REDIS_KEYS.droppedCounter, this.ttlSeconds);
    }
  }

  /** 观察窗口内采样，按 timestamp 升序。 */
  async getSamples(): Promise<ClaimGroundingEvent[]> {
    // P1 fix: 按时间窗口过滤而非仅依赖 key TTL —— TTL 每次写入刷新，
    // 连续写入会让老采样无限存活。score = event.ts（epoch ms），
    // 故用 (now - ttlSeconds*1000) 作为滚动窗口下界。
    const windowStart = Date.now() - this.ttlSeconds * 1000;
    // Cloud P2 fix: 读时清理 stale，保证 zcard/容量准确（否则老 score
    // 不可见却仍计入 zcard，挤压 maxTotal FIFO 淘汰）。
    await this.redis.zremrangebyscore(GROUNDING_REDIS_KEYS.samples, '-inf', String(windowStart - 1));
    const raw = await this.redis.zrangebyscore(GROUNDING_REDIS_KEYS.samples, String(windowStart), '+inf');
    return raw.map((s) => JSON.parse(s) as ClaimGroundingEvent);
  }

  async getStats(): Promise<{ stored: number; dropped: number }> {
    const [stored, droppedStr] = await Promise.all([
      this.redis.zcard(GROUNDING_REDIS_KEYS.samples),
      this.redis.get(GROUNDING_REDIS_KEYS.droppedCounter),
    ]);
    return { stored, dropped: Number(droppedStr) || 0 };
  }

  private async shouldRecord(event: ClaimGroundingEvent, wouldBlock: boolean): Promise<boolean> {
    // Rule 1: mismatch or wouldBlock → always keep (100%)
    if (event.verdict === 'mismatch' || wouldBlock) return true;
    // Rule 2: insufficient → cap per resolver×thread×day
    if (event.verdict === 'insufficient') return this.checkInsufficientCap(event);
    // Rule 3: verified → 1/N rate + daily cap
    if (event.verdict === 'verified') return this.checkVerifiedSampling(event);
    return true;
  }

  private async checkInsufficientCap(event: ClaimGroundingEvent): Promise<boolean> {
    const day = dayKey(event.ts);
    const hashKey = `${GROUNDING_REDIS_KEYS.insufficientPrefix}${day}`;
    const field = `${event.resolver}:${event.threadId}`;

    // Note: HGET→check→HINCRBY 非原子。并发下上限可能被超出 1-2 条，
    // 记为 P3：这些上限是采样启发式（非安全边界），并发极低
    // （cat 触发回调 ~1-5 events/min），轻微超出不影响 eval 模式分析。
    const current = await this.redis.hget(hashKey, field);
    const count = Number(current) || 0;
    if (count >= this.insufficientCap) return false;

    await this.redis.hincrby(hashKey, field, 1);
    await this.redis.expire(hashKey, COUNTER_TTL_SECONDS);
    return true;
  }

  private async checkVerifiedSampling(event: ClaimGroundingEvent): Promise<boolean> {
    const day = dayKey(event.ts);
    const countKey = `${GROUNDING_REDIS_KEYS.verifiedPrefix}${day}`;

    // 先查日上限，再查概率采样
    const current = await this.redis.get(countKey);
    const dayCount = Number(current) || 0;
    if (dayCount >= this.verifiedDailyCap) return false;
    if (!this.shouldSampleVerified()) return false;

    await this.redis.incr(countKey);
    await this.redis.expire(countKey, COUNTER_TTL_SECONDS);
    return true;
  }

  private async push(event: ClaimGroundingEvent): Promise<void> {
    const member = JSON.stringify(event);
    await this.redis.zadd(GROUNDING_REDIS_KEYS.samples, String(event.ts), member);
    // 刷新 sorted set TTL
    await this.redis.expire(GROUNDING_REDIS_KEYS.samples, this.ttlSeconds);

    // 超容量裁剪（移除最旧 = 最低 score）
    const count = await this.redis.zcard(GROUNDING_REDIS_KEYS.samples);
    if (count > this.maxTotal) {
      await this.redis.zremrangebyrank(GROUNDING_REDIS_KEYS.samples, 0, count - this.maxTotal - 1);
    }
  }
}
