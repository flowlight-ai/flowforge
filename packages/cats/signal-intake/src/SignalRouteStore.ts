/**
 * 信号路由存储：Host 配置的持久化（pluginId × signalType 唯一）。
 * 忠实移植 clowder-ai `domains/signal-intake/SignalRouteStore.ts`。
 * 路由记录类型 `SignalRouteRecord` 见 `contract/signals.ts`（本地契约）。
 *
 * @flowforge/cats-signal-intake
 */

import type { SignalRouteRecord } from './contract/signals.ts'

export interface SignalRouteStore {
  get(pluginId: string, signalType: string): Promise<SignalRouteRecord | null>
  put(record: SignalRouteRecord): Promise<void>
  putIfAbsent(record: SignalRouteRecord): Promise<boolean>
}

function identity(pluginId: string, signalType: string): string {
  return `${pluginId}\u0000${signalType}`
}

export class MemorySignalRouteStore implements SignalRouteStore {
  private readonly records = new Map<string, SignalRouteRecord>()

  async get(pluginId: string, signalType: string): Promise<SignalRouteRecord | null> {
    const record = this.records.get(identity(pluginId, signalType))
    return record ? structuredClone(record) : null
  }

  async put(record: SignalRouteRecord): Promise<void> {
    this.records.set(identity(record.pluginId, record.signalType), structuredClone(record))
  }

  async putIfAbsent(record: SignalRouteRecord): Promise<boolean> {
    const key = identity(record.pluginId, record.signalType)
    if (this.records.has(key)) return false
    this.records.set(key, structuredClone(record))
    return true
  }
}