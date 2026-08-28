/**
 * @flowforge/cats-guides — ConciergeTriagePlanStore（F229 Phase B）。
 *
 * TriagePlan 持久化。TTL=0（铁律 5 LL-048）。
 * 三件模式：port interface + KV 实现 + Memory 实现。
 *
 * 状态机：proposed → confirmed → dispatched → completed | failed
 *         proposed → cancelled
 *         failed → confirmed (retry)
 *
 * INV T1: 先落 proposed 再出确认卡
 * INV T2: 确认后才 dispatch
 * INV T3: failed 可手动重试（→ confirmed）
 *
 * 插件化改造：clowder Redis Lua CAS → KV 后端 read-modify-write 由注入端保证
 * 原子性（sqlite BEGIN IMMEDIATE 事务 / redis EVAL）；内存实现同步 CAS。
 *
 * @module @flowforge/cats-guides/concierge/triage-plan-store
 */

import type { TriagePlan, TriagePlanResult, TriagePlanStatus } from '../models.js';
import { ConciergeKeys } from './keys.js';
import type { ConciergeKeyValueStore } from './kv-store.js';
import { MemoryConciergeKeyValueStore } from './kv-store.js';

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConciergeTriagePlanStore {
  /** Create a new triage plan (status = 'proposed') */
  create(plan: TriagePlan): Promise<void>;
  /** Get plan by ID */
  get(planId: string): Promise<TriagePlan | null>;
  /** Update plan status (state transition) — sets timestamps for dispatched/completed */
  updateStatus(planId: string, status: TriagePlanStatus): Promise<void>;
  /**
   * CAS 状态转移：仅当当前状态 === expectedStatus 时原子更新为 newStatus。
   * 防并发 confirm 双 dispatch（cloud P1 fix）。
   */
  claimTransition(planId: string, expectedStatus: TriagePlanStatus, newStatus: TriagePlanStatus): Promise<boolean>;
  /** Set dispatch result on plan */
  setResult(planId: string, result: TriagePlanResult): Promise<void>;
  /** Persist user-selected relay target cats before dispatching an ambiguous plan */
  setTargetCats(planId: string, targetCats: string[]): Promise<void>;
  /** Link the plan to the assistant message that rendered its confirmation card */
  setConfirmationMessageId(planId: string, messageId: string): Promise<void>;
  /** List plans for a user (most recent first) */
  listByUser(userId: string): Promise<TriagePlan[]>;
}

// ---------------------------------------------------------------------------
// KV-backed implementation（可注入 sqlite/redis 后端）
// ---------------------------------------------------------------------------

export class KvConciergeTriagePlanStore implements IConciergeTriagePlanStore {
  private readonly kv: ConciergeKeyValueStore;

  constructor(kv: ConciergeKeyValueStore = new MemoryConciergeKeyValueStore()) {
    this.kv = kv;
  }

  async create(plan: TriagePlan): Promise<void> {
    // TTL=0 = persistent (铁律 5 LL-048)
    await this.kv.set(ConciergeKeys.triagePlan(plan.id), JSON.stringify(plan));
    await this.kv.addToSet(ConciergeKeys.triagePlanIndex(plan.userId), plan.id);
  }

  async get(planId: string): Promise<TriagePlan | null> {
    const raw = await this.kv.get(ConciergeKeys.triagePlan(planId));
    return raw ? (JSON.parse(raw) as TriagePlan) : null;
  }

  async updateStatus(planId: string, status: TriagePlanStatus): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.triagePlan(planId));
    if (!raw) return;
    const plan = JSON.parse(raw) as TriagePlan;
    plan.status = status;
    plan.updatedAt = Date.now();
    if (status === 'dispatched') plan.dispatchedAt = plan.updatedAt;
    if (status === 'completed') plan.completedAt = plan.updatedAt;
    await this.kv.set(ConciergeKeys.triagePlan(planId), JSON.stringify(plan));
  }

  /** CAS：仅当当前状态匹配 expectedStatus 时更新（防并发双 dispatch）。 */
  async claimTransition(
    planId: string,
    expectedStatus: TriagePlanStatus,
    newStatus: TriagePlanStatus,
  ): Promise<boolean> {
    const raw = await this.kv.get(ConciergeKeys.triagePlan(planId));
    if (!raw) return false;
    const plan = JSON.parse(raw) as TriagePlan;
    if (plan.status !== expectedStatus) return false;
    plan.status = newStatus;
    plan.updatedAt = Date.now();
    if (newStatus === 'dispatched') plan.dispatchedAt = plan.updatedAt;
    if (newStatus === 'completed') plan.completedAt = plan.updatedAt;
    await this.kv.set(ConciergeKeys.triagePlan(planId), JSON.stringify(plan));
    return true;
  }

  async setResult(planId: string, result: TriagePlanResult): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.triagePlan(planId));
    if (!raw) return;
    const plan = JSON.parse(raw) as TriagePlan;
    plan.result = result;
    plan.updatedAt = Date.now();
    await this.kv.set(ConciergeKeys.triagePlan(planId), JSON.stringify(plan));
  }

  async setTargetCats(planId: string, targetCats: string[]): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.triagePlan(planId));
    if (!raw) return;
    const plan = JSON.parse(raw) as TriagePlan;
    plan.target = { ...plan.target, targetCats };
    plan.updatedAt = Date.now();
    await this.kv.set(ConciergeKeys.triagePlan(planId), JSON.stringify(plan));
  }

  async setConfirmationMessageId(planId: string, messageId: string): Promise<void> {
    const raw = await this.kv.get(ConciergeKeys.triagePlan(planId));
    if (!raw) return;
    const plan = JSON.parse(raw) as TriagePlan;
    plan.confirmationMessageId = messageId;
    plan.updatedAt = Date.now();
    await this.kv.set(ConciergeKeys.triagePlan(planId), JSON.stringify(plan));
  }

  async listByUser(userId: string): Promise<TriagePlan[]> {
    const ids = await this.kv.setMembers(ConciergeKeys.triagePlanIndex(userId));
    if (ids.length === 0) return [];
    const results: TriagePlan[] = [];
    for (const id of ids) {
      const raw = await this.kv.get(ConciergeKeys.triagePlan(id));
      if (raw) results.push(JSON.parse(raw) as TriagePlan);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation（仅用于单元测试 / stub）
// ---------------------------------------------------------------------------

export class MemoryConciergeTriagePlanStore implements IConciergeTriagePlanStore {
  private readonly store = new Map<string, TriagePlan>();

  async create(plan: TriagePlan): Promise<void> {
    this.store.set(plan.id, { ...plan, target: { ...plan.target } });
  }

  async get(planId: string): Promise<TriagePlan | null> {
    const entry = this.store.get(planId);
    return entry ? { ...entry, target: { ...entry.target } } : null;
  }

  async updateStatus(planId: string, status: TriagePlanStatus): Promise<void> {
    const entry = this.store.get(planId);
    if (!entry) return;
    entry.status = status;
    entry.updatedAt = Date.now();
    if (status === 'dispatched') entry.dispatchedAt = entry.updatedAt;
    if (status === 'completed') entry.completedAt = entry.updatedAt;
    this.store.set(planId, { ...entry, target: { ...entry.target } });
  }

  async claimTransition(
    planId: string,
    expectedStatus: TriagePlanStatus,
    newStatus: TriagePlanStatus,
  ): Promise<boolean> {
    const entry = this.store.get(planId);
    if (!entry || entry.status !== expectedStatus) return false;
    entry.status = newStatus;
    entry.updatedAt = Date.now();
    if (newStatus === 'dispatched') entry.dispatchedAt = entry.updatedAt;
    if (newStatus === 'completed') entry.completedAt = entry.updatedAt;
    this.store.set(planId, { ...entry, target: { ...entry.target } });
    return true;
  }

  async setResult(planId: string, result: TriagePlanResult): Promise<void> {
    const entry = this.store.get(planId);
    if (!entry) return;
    entry.result = { ...result };
    entry.updatedAt = Date.now();
    this.store.set(planId, { ...entry, target: { ...entry.target } });
  }

  async setTargetCats(planId: string, targetCats: string[]): Promise<void> {
    const entry = this.store.get(planId);
    if (!entry) return;
    entry.target = { ...entry.target, targetCats };
    entry.updatedAt = Date.now();
    this.store.set(planId, { ...entry, target: { ...entry.target } });
  }

  async setConfirmationMessageId(planId: string, messageId: string): Promise<void> {
    const entry = this.store.get(planId);
    if (!entry) return;
    entry.confirmationMessageId = messageId;
    entry.updatedAt = Date.now();
    this.store.set(planId, { ...entry, target: { ...entry.target } });
  }

  async listByUser(userId: string): Promise<TriagePlan[]> {
    const results: TriagePlan[] = [];
    for (const entry of this.store.values()) {
      if (entry.userId === userId) results.push({ ...entry, target: { ...entry.target } });
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}
