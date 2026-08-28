/**
 * @flowforge/cats-guides — ConciergeConfirmationStore（F229 PR-A3b）。
 *
 * PendingConfirmation 持久化。TTL=0（铁律 5 LL-048）。
 * 三件模式：port interface + KV 实现 + Memory 实现。
 *
 * 状态机：rendered → confirmed | cancelled
 * INV C3: 确认/取消状态持久化，刷新后保持
 *
 * @module @flowforge/cats-guides/concierge/confirmation-store
 */

import type { ConfirmationStatus, PendingConfirmation } from '../models.js';
import { ConciergeKeys } from './keys.js';
import type { ConciergeKeyValueStore } from './kv-store.js';
import { MemoryConciergeKeyValueStore } from './kv-store.js';

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConciergeConfirmationStore {
  /** Create a new confirmation record (status = 'rendered') */
  create(confirmation: PendingConfirmation): Promise<void>;
  /** Get confirmation by ID */
  get(confirmationId: string): Promise<PendingConfirmation | null>;
  /** Update confirmation status (rendered → confirmed | cancelled) */
  updateStatus(confirmationId: string, status: ConfirmationStatus): Promise<void>;
  /** List confirmations for a user (most recent first) */
  listByUser(userId: string): Promise<PendingConfirmation[]>;
}

// ---------------------------------------------------------------------------
// KV-backed implementation（可注入 sqlite/redis 后端）
// ---------------------------------------------------------------------------

export class KvConciergeConfirmationStore implements IConciergeConfirmationStore {
  private readonly kv: ConciergeKeyValueStore;

  constructor(kv: ConciergeKeyValueStore = new MemoryConciergeKeyValueStore()) {
    this.kv = kv;
  }

  async create(confirmation: PendingConfirmation): Promise<void> {
    // TTL=0 = persistent (铁律 5 LL-048)
    await this.kv.set(ConciergeKeys.confirmation(confirmation.id), JSON.stringify(confirmation));
    await this.kv.addToSet(ConciergeKeys.confirmationIndex(confirmation.userId), confirmation.id);
  }

  async get(confirmationId: string): Promise<PendingConfirmation | null> {
    const raw = await this.kv.get(ConciergeKeys.confirmation(confirmationId));
    return raw ? (JSON.parse(raw) as PendingConfirmation) : null;
  }

  async updateStatus(confirmationId: string, status: ConfirmationStatus): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.confirmation(confirmationId));
    if (!raw) return;
    const confirmation = JSON.parse(raw) as PendingConfirmation;
    confirmation.status = status;
    confirmation.updatedAt = Date.now();
    await this.kv.set(ConciergeKeys.confirmation(confirmationId), JSON.stringify(confirmation));
  }

  async listByUser(userId: string): Promise<PendingConfirmation[]> {
    const ids = await this.kv.setMembers(ConciergeKeys.confirmationIndex(userId));
    if (ids.length === 0) return [];
    const results: PendingConfirmation[] = [];
    for (const id of ids) {
      const raw = await this.kv.get(ConciergeKeys.confirmation(id));
      if (raw) results.push(JSON.parse(raw) as PendingConfirmation);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation（仅用于单元测试 / stub）
// ---------------------------------------------------------------------------

export class MemoryConciergeConfirmationStore implements IConciergeConfirmationStore {
  private readonly store = new Map<string, PendingConfirmation>();

  async create(confirmation: PendingConfirmation): Promise<void> {
    this.store.set(confirmation.id, { ...confirmation });
  }

  async get(confirmationId: string): Promise<PendingConfirmation | null> {
    const entry = this.store.get(confirmationId);
    return entry ? { ...entry } : null;
  }

  async updateStatus(confirmationId: string, status: ConfirmationStatus): Promise<void> {
    const entry = this.store.get(confirmationId);
    if (!entry) return;
    entry.status = status;
    entry.updatedAt = Date.now();
    this.store.set(confirmationId, { ...entry });
  }

  async listByUser(userId: string): Promise<PendingConfirmation[]> {
    const results: PendingConfirmation[] = [];
    for (const entry of this.store.values()) {
      if (entry.userId === userId) results.push({ ...entry });
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}
