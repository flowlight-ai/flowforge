/**
 * @flowforge/cats-guides — ConciergeKeyValueStore（F229 插件化持久层 seam）。
 *
 * clowder 原版直接依赖 RedisClient（get/set(NX)/eval CAS-DEL/SADD/SMEMBERS）。
 * 插件化改造：裁剪为 concierge 实际使用的最小 KV 接口 + 索引操作，
 * 宿主可注入 sqlite/redis 实现；缺省 `MemoryConciergeKeyValueStore`
 * （单实例幂等，跨实例不持久，对齐 clowder InMemory fallback 语义）。
 *
 * TTL=0（不设过期，持久化 — 铁律 5 LL-048）。
 *
 * @module @flowforge/cats-guides/concierge/kv-store
 */

/** 最小 KV + 集合接口（Redis String + Set 子集，CAS 语义保留）。 */
export interface ConciergeKeyValueStore {
  /** GET — 缺失返回 null。 */
  get(key: string): Promise<string | null>;
  /** SET（非 NX）— 覆盖写，TTL=0。 */
  set(key: string, value: string): Promise<void>;
  /** SET NX — 原子；key 已存在返回 false（claim 语义）。 */
  setNx(key: string, value: string): Promise<boolean>;
  /** CAS-DEL — 仅当当前值 === expected 时删除；返回是否删除。 */
  deleteIf(key: string, expected: string): Promise<boolean>;
  /** SADD — 加入集合；返回是否新增。 */
  addToSet(setKey: string, member: string): Promise<boolean>;
  /** SMEMBERS — 集合全部成员。 */
  setMembers(setKey: string): Promise<string[]>;
}

/** 内存实现（测试 / 无持久后端时缺省）。 */
export class MemoryConciergeKeyValueStore implements ConciergeKeyValueStore {
  private readonly kv = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }

  async setNx(key: string, value: string): Promise<boolean> {
    if (this.kv.has(key)) return false;
    this.kv.set(key, value);
    return true;
  }

  async deleteIf(key: string, expected: string): Promise<boolean> {
    if (this.kv.get(key) !== expected) return false;
    this.kv.delete(key);
    return true;
  }

  async addToSet(setKey: string, member: string): Promise<boolean> {
    let set = this.sets.get(setKey);
    if (!set) {
      set = new Set();
      this.sets.set(setKey, set);
    }
    if (set.has(member)) return false;
    set.add(member);
    return true;
  }

  async setMembers(setKey: string): Promise<string[]> {
    return [...(this.sets.get(setKey) ?? [])];
  }
}
