/**
 * @flowforge/cats-guides — ConciergeConfigStore（F229 PR-A1）。
 *
 * Per-user 前台猫配置持久化。TTL=0（铁律 5 LL-048）。
 * 三件模式：port interface + KV 实现 + Memory 实现（缺省）。
 *
 * dutyCatProfileId 默认值解析（插件化：catRegistry 单例 → 注入 resolver）：
 * - 优先 'gemini35'（co-creator directive 2026-06-12：暹罗猫 Gemini 3.5 Flash）
 * - 不存在则取 roster 首个 ID
 * - roster 为空时 fallback 'sonnet'
 *
 * @module @flowforge/cats-guides/concierge/config-store
 */

import { CONCIERGE_CONFIG_DEFAULTS, type ConciergeConfig } from '../models.js';
import { ConciergeKeys } from './keys.js';
import type { ConciergeKeyValueStore } from './kv-store.js';

/** roster 解析注入（对齐 ctx.cats 注册表；缺省空 roster）。 */
export type RosterResolver = () => readonly string[];

/** 默认 dutyCatProfileId 解析（优先 gemini35 → roster[0] → sonnet）。 */
export function resolveDefaultDutyCatProfileId(roster: RosterResolver = () => []): string {
  const ids = roster();
  if (ids.includes('gemini35')) return 'gemini35';
  if (ids.length > 0) return ids[0] ?? 'sonnet';
  return 'sonnet';
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IConciergeConfigStore {
  /** 获取用户配置；不存在则返回 defaults（含 dutyCatProfileId 解析） */
  get(userId: string): Promise<ConciergeConfig>;
  /** 覆盖写入用户配置（TTL=0，持久化） */
  put(userId: string, config: ConciergeConfig): Promise<void>;
}

// ---------------------------------------------------------------------------
// KV-backed implementation（可注入 sqlite/redis 后端）
// ---------------------------------------------------------------------------

export class KvConciergeConfigStore implements IConciergeConfigStore {
  private readonly kv: ConciergeKeyValueStore;
  private readonly roster: RosterResolver;

  constructor(kv: ConciergeKeyValueStore, roster: RosterResolver = () => []) {
    this.kv = kv;
    this.roster = roster;
  }

  async get(userId: string): Promise<ConciergeConfig> {
    const raw = await this.kv.get(ConciergeKeys.config(userId));
    if (!raw) {
      return {
        ...CONCIERGE_CONFIG_DEFAULTS,
        dutyCatProfileId: resolveDefaultDutyCatProfileId(this.roster),
      };
    }
    const config = JSON.parse(raw) as ConciergeConfig;
    // FIX-3: validate stored dutyCatProfileId — stale/missing values should
    // re-resolve to the plan default (gemini35 → first available → sonnet).
    if (!config.dutyCatProfileId || !this.roster().includes(config.dutyCatProfileId)) {
      config.dutyCatProfileId = resolveDefaultDutyCatProfileId(this.roster);
    }
    return config;
  }

  async put(userId: string, config: ConciergeConfig): Promise<void> {
    // TTL=0 = 不设置 EXPIRE = 持久化（铁律 5 LL-048）
    await this.kv.set(ConciergeKeys.config(userId), JSON.stringify(config));
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation（仅用于单元测试 / stub，无 KV 注入时）
// ---------------------------------------------------------------------------

export class MemoryConciergeConfigStore implements IConciergeConfigStore {
  private readonly store = new Map<string, ConciergeConfig>();
  private readonly roster: RosterResolver;

  constructor(roster: RosterResolver = () => []) {
    this.roster = roster;
  }

  async get(userId: string): Promise<ConciergeConfig> {
    const entry = this.store.get(userId);
    if (!entry) {
      return {
        ...CONCIERGE_CONFIG_DEFAULTS,
        dutyCatProfileId: resolveDefaultDutyCatProfileId(this.roster),
      };
    }
    const config = { ...entry };
    // FIX-3: same validation as KV impl
    if (!config.dutyCatProfileId || !this.roster().includes(config.dutyCatProfileId)) {
      config.dutyCatProfileId = resolveDefaultDutyCatProfileId(this.roster);
    }
    return config;
  }

  async put(userId: string, config: ConciergeConfig): Promise<void> {
    this.store.set(userId, { ...config });
  }
}
