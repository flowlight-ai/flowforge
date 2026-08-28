/**
 * @flowforge/cats-plugin-inventory — C30 inventory 存储端口（P15）
 *
 * TS 移植：clowder-ai `domains/plugin/host-inventory/ports.ts`。
 */

import type { PluginGrantRecord, PluginInstanceRecord, PluginInventorySnapshot, PluginPackageRecord } from './types.js';

export interface PackageInventoryStore {
  get(packageDigest: string): PluginPackageRecord | undefined;
  list(): readonly PluginPackageRecord[];
  put(record: PluginPackageRecord): void;
}

export interface PluginInstanceStore {
  get(pluginInstanceId: string): PluginInstanceRecord | undefined;
  getCurrent(pluginId: string): PluginInstanceRecord | undefined;
  list(): readonly PluginInstanceRecord[];
  put(record: PluginInstanceRecord): void;
}

export interface GrantStore {
  get(pluginInstanceId: string): PluginGrantRecord | undefined;
  list(): readonly PluginGrantRecord[];
  put(record: PluginGrantRecord): void;
}

export interface PluginInventoryTransaction {
  readonly packages: PackageInventoryStore;
  readonly instances: PluginInstanceStore;
  readonly grants: GrantStore;
}

export interface PluginInventoryStore {
  snapshot(): Promise<PluginInventorySnapshot>;
  transaction<T>(work: (transaction: PluginInventoryTransaction) => Promise<T> | T): Promise<T>;
}
