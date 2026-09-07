/**
 * Local injected KV + logger ports for the connectors framework.
 *
 * Q6 (injected KV) mandates the host injects a Redis client that satisfies
 * `@flowforge/infrastructure-redis-port`'s `RedisLikeClient`. The clowder
 * stores additionally need `smembers` / `srem` / `hdel` / `hexists`, which the
 * shared redis-port contract intentionally omits. Rather than extending the
 * shared contract, we define a LOCAL minimal `ConnectorRedisClient` here that
 * widens `RedisLikeClient` with exactly those methods, and type every Redis
 * store variant in this package against it.
 *
 * The Memory store variants are the primary, fully-tested implementations.
 *
 * @module connectors-internal
 */

import type { RedisLikeClient, RedisPipeline } from '@flowforge/infrastructure-redis-port';

/**
 * Local minimal Redis pipeline for connector stores — widens the shared
 * `RedisPipeline` with the set/hash members the connector stores batched-call
 * (`srem` / `zrem` / `hdel`).
 */
export interface ConnectorRedisPipeline extends RedisPipeline {
  /** Queue an SREM (remove from set). */
  srem(key: string, ...members: string[]): void;
  /** Queue a ZREM (remove from sorted set). */
  zrem(key: string, ...members: string[]): void;
  /** Queue an HDEL (remove hash field). */
  hdel(key: string, ...fields: string[]): void;
}

/**
 * Local minimal Redis client for connector stores — widens the shared
 * `RedisLikeClient` with the set operations the connector stores require.
 * Hosts inject an implementation (real ioredis, an in-memory double, or any
 * Redis-compatible client).
 */
export interface ConnectorRedisClient extends RedisLikeClient {
  /** Retrieve all members of a SET (ioredis `smembers`). */
  smembers(key: string): Promise<string[]>;
  /** Remove members from a SET (ioredis `srem`). */
  srem(key: string, ...members: string[]): Promise<number>;
  /** Remove one or more fields from a HASH (ioredis `hdel`). */
  hdel(key: string, ...fields: string[]): Promise<number>;
  /** Check whether a HASH field exists (ioredis `hexists`). */
  hexists(key: string, field: string): Promise<number>;
  /** Start a pipeline with set/hash support. */
  multi(): ConnectorRedisPipeline;
}

/**
 * Minimal logger adapted out of `fastify`'s `FastifyBaseLogger`.
 * Hosts inject a logger; no fastify dependency is introduced.
 */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** No-op logger for tests and embedded fallback contexts. */
export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};