/**
 * @flowforge/infrastructure-redis-port — Redis 客户端端口契约（C33 Redis 持久化）。
 *
 * FlowForge 不绑定具体 Redis 驱动（仓库无 ioredis 依赖）：宿主注入满足本契约
 * 的客户端即可启用 Redis 后端；缺省走内存实现。与既有约定一致——
 * `cats/human-disposition` 出 Lua 常量、`cats/taste` 出 key 模式，
 * 宿主（Redis/KV）负责加载。
 *
 * 本契约是 ioredis 接口的最小子集（multi/pipeline + hash + zset + string +
 * eval），按各 store 实际调用收敛：
 *   - email/RedisPrTrackingStore：hset/hgetall/zadd/zrevrange/zrem/eval/expire/multi
 *   - grounding/RedisGroundingSampleStore：zadd/zcard/zremrangebyrank/
 *     zremrangebyscore/zrangebyscore/incr/get/expire/hget/hincrby
 *
 * @module @flowforge/infrastructure-redis-port
 */

/** Pipeline（multi）句柄：批量命令，exec() 返回结果数组。 */
export interface RedisPipeline {
  hset(key: string, values: Record<string, string>): void;
  hgetall(key: string): void;
  zadd(key: string, score: string, member: string): void;
  expire(key: string, seconds: number): void;
  del(key: string): void;
  /** 执行：返回 [err, result] 元组数组（ioredis 语义）。 */
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

/**
 * Redis 客户端端口（注入式）。
 * 所有方法均为 ioredis 同签名子集；实现方可以是真实 ioredis、
 * 内存仿真或任意 Redis 兼容客户端。
 */
export interface RedisLikeClient {
  // ── string ──
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;

  // ── hash ──
  hset(key: string, values: Record<string, string>): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hget(key: string, field: string): Promise<string | null>;
  hincrby(key: string, field: string, increment: number): Promise<number>;

  // ── sorted set ──
  zadd(key: string, score: string, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrangebyscore(key: string, min: string, max: string): Promise<string[]>;
  zremrangebyscore(key: string, min: string, max: string): Promise<number>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;

  // ── scripting ──
  /** EVAL script：numKeys + 后续 keys/argv（ioredis 语义）。 */
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;

  // ── pipeline ──
  multi(): RedisPipeline;
}
