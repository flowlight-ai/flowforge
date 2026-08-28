/**
 * @flowforge/cats-guides — ConciergeRelayStore（F229 PR-A3b）。
 *
 * RelayReceipt 持久化。TTL=0（铁律 5 LL-048）。
 * 三件模式：port interface + KV 实现 + Memory 实现。
 *
 * 状态机：draft → confirmed → dispatched | dispatch_failed
 * INV R1: 先落记录再投递（store.write 先于 crossPost）
 * INV R4: 旁路禁令——仅 relay 端点写 relay 记录
 *
 * @module @flowforge/cats-guides/concierge/relay-store
 */

import type { RelayReceipt, RelayReceiptStatus } from '../models.js';
import { ConciergeKeys } from './keys.js';
import type { ConciergeKeyValueStore } from './kv-store.js';
import { MemoryConciergeKeyValueStore } from './kv-store.js';

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConciergeRelayStore {
  /** Create a new relay receipt (status = 'confirmed', ready for dispatch) */
  create(receipt: RelayReceipt): Promise<void>;
  /** Get receipt by ID */
  get(receiptId: string): Promise<RelayReceipt | null>;
  /** Update receipt status (state transition) */
  updateStatus(receiptId: string, status: RelayReceiptStatus): Promise<void>;
  /** List all receipts for a user (most recent first) */
  listByUser(userId: string): Promise<RelayReceipt[]>;
}

// ---------------------------------------------------------------------------
// KV-backed implementation（可注入 sqlite/redis 后端）
// ---------------------------------------------------------------------------

export class KvConciergeRelayStore implements IConciergeRelayStore {
  private readonly kv: ConciergeKeyValueStore;

  constructor(kv: ConciergeKeyValueStore = new MemoryConciergeKeyValueStore()) {
    this.kv = kv;
  }

  async create(receipt: RelayReceipt): Promise<void> {
    // TTL=0 = persistent (铁律 5 LL-048)
    await this.kv.set(ConciergeKeys.relay(receipt.id), JSON.stringify(receipt));
    await this.kv.addToSet(ConciergeKeys.relayIndex(receipt.userId), receipt.id);
  }

  async get(receiptId: string): Promise<RelayReceipt | null> {
    const raw = await this.kv.get(ConciergeKeys.relay(receiptId));
    return raw ? (JSON.parse(raw) as RelayReceipt) : null;
  }

  async updateStatus(receiptId: string, status: RelayReceiptStatus): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.relay(receiptId));
    if (!raw) return;
    const receipt = JSON.parse(raw) as RelayReceipt;
    receipt.status = status;
    receipt.updatedAt = Date.now();
    await this.kv.set(ConciergeKeys.relay(receiptId), JSON.stringify(receipt));
  }

  async listByUser(userId: string): Promise<RelayReceipt[]> {
    const ids = await this.kv.setMembers(ConciergeKeys.relayIndex(userId));
    if (ids.length === 0) return [];
    const results: RelayReceipt[] = [];
    for (const id of ids) {
      const raw = await this.kv.get(ConciergeKeys.relay(id));
      if (raw) results.push(JSON.parse(raw) as RelayReceipt);
    }
    // Most recent first
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation（仅用于单元测试 / stub）
// ---------------------------------------------------------------------------

export class MemoryConciergeRelayStore implements IConciergeRelayStore {
  private readonly store = new Map<string, RelayReceipt>();

  async create(receipt: RelayReceipt): Promise<void> {
    this.store.set(receipt.id, { ...receipt });
  }

  async get(receiptId: string): Promise<RelayReceipt | null> {
    const entry = this.store.get(receiptId);
    return entry ? { ...entry } : null;
  }

  async updateStatus(receiptId: string, status: RelayReceiptStatus): Promise<void> {
    const entry = this.store.get(receiptId);
    if (!entry) return;
    entry.status = status;
    entry.updatedAt = Date.now();
    this.store.set(receiptId, { ...entry });
  }

  async listByUser(userId: string): Promise<RelayReceipt[]> {
    const results: RelayReceipt[] = [];
    for (const entry of this.store.values()) {
      if (entry.userId === userId) results.push({ ...entry });
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}
