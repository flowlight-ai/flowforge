/**
 * Redis 信号路由 store：scalar route 记录的 get/put/putIfAbsent。
 * 忠实移植 clowder-ai `domains/signal-intake/RedisSignalRouteStore.ts`，
 * 经本地 `SignalIntakeRedisClient` seam（见 `redis/seam.ts`）。
 *
 * @flowforge/cats-signal-intake — redis/RedisSignalRouteStore
 */

import { digestCanonical } from '../canonical-json.ts'
import type { SignalRouteRecord } from '../contract/signals.ts'
import { SignalIntakeKeys } from '../signal-intake-keys.ts'
import type { SignalRouteStore } from '../SignalRouteStore.ts'
import type { SignalIntakeRedisClient } from './seam.ts'

function key(pluginId: string, signalType: string): string {
  return SignalIntakeKeys.route(digestCanonical({ pluginId, signalType }))
}

function parse(raw: string): SignalRouteRecord {
  const value = JSON.parse(raw) as SignalRouteRecord
  if (
    !value ||
    typeof value.routeId !== 'string' ||
    typeof value.pluginId !== 'string' ||
    typeof value.signalType !== 'string' ||
    !Number.isSafeInteger(value.generation)
  ) {
    throw new Error('signal route record is corrupt')
  }
  return value
}

export class RedisSignalRouteStore implements SignalRouteStore {
  constructor(private readonly redis: SignalIntakeRedisClient) {}

  async get(pluginId: string, signalType: string): Promise<SignalRouteRecord | null> {
    const raw = await this.redis.get(key(pluginId, signalType))
    return raw ? parse(raw) : null
  }

  async put(record: SignalRouteRecord): Promise<void> {
    await this.redis.set(key(record.pluginId, record.signalType), JSON.stringify(record))
  }

  async putIfAbsent(record: SignalRouteRecord): Promise<boolean> {
    const result = await this.redis.set(key(record.pluginId, record.signalType), JSON.stringify(record), { NX: true })
    return result === 'OK'
  }
}