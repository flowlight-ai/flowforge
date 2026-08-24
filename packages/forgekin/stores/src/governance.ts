/**
 * @flowforge/forgekin-stores — F39 记忆治理三要素。
 *
 * TS 重写自 `core/memory_federation/governance.py`（roleagent.md §4.4）：
 *   1. 权威等级（Authority Level）：基于来源 + 验证状态
 *   2. 消费加权（Consumption Weighting）：基于消费信号（不是自评）
 *   3. 衰减策略（Decay Strategy）：基于时间的指数衰减
 *
 * 关键设计（移植自 Python 原版注释）：
 *   - 用行为信号（consumption_count）而非自评
 *   - 衰减是幂等的（重复调用 apply_decay 不产生累积误差，基于 last_accessed 计算）
 *   - 治理参数全部从 GovernanceConfig 注入（铁律 5，对应 config/memory_federation.yaml）
 *   - 所有方法纯函数式（基于 entry + config，无副作用）
 */

import { MemoryEntry } from './collection.js';

/** 治理配置（对应 config/memory_federation.yaml，由调用方注入；铁律 5）。 */
export interface GovernanceConfig {
  /** 基础权威分（0.0-1.0，未验证来源的起点）。缺省 0.5。 */
  authority_base?: number;
  /** 来源可信度加成（如 verified_source +0.2）。缺省 0.2。 */
  authority_source_boost?: number;
  /** 可信来源列表（享受加成）。缺省空。 */
  verified_sources?: string[];
  /** 衰减半衰期（天）— 30 天表示 30 天未访问则权威减半。缺省 30。 */
  decay_half_life_days?: number;
  /** 衰减下限（0.0-1.0）— 避免归零，保留可恢复性。缺省 0.1。 */
  decay_min_score?: number;
}

/** 归一化基准：consumption_count=100 时权重=1.0（log(101) ≈ 4.6）。 */
const CONSUMPTION_SATURATION = 101;

/**
 * 记忆治理 — 三要素计算（roleagent.md §4.4：用行为信号而非自评）。
 *
 * 所有方法纯函数式（基于 entry + config），无副作用。
 */
export class MemoryGovernance {
  private readonly authorityBase: number;
  private readonly authorityBoost: number;
  private readonly verifiedSources: ReadonlySet<string>;
  private readonly halfLifeDays: number;
  private readonly minScore: number;

  constructor(config: GovernanceConfig = {}) {
    this.authorityBase = clamp(config.authority_base ?? 0.5, 0, 1);
    this.authorityBoost = clamp(config.authority_source_boost ?? 0.2, 0, 1);
    this.verifiedSources = new Set(config.verified_sources ?? []);
    this.halfLifeDays = config.decay_half_life_days ?? 30;
    this.minScore = clamp(config.decay_min_score ?? 0.1, 0, 1);
  }

  /**
   * 要素 1：计算权威等级。
   *
   * 权威 = 基础分 + 来源加成（如果来源在可信列表中），上限 1.0：
   *   - 未验证来源：authority_base（0.5）
   *   - 可信来源：authority_base + authority_source_boost（0.7）
   */
  async compute_authority(entry: MemoryEntry): Promise<number> {
    let authority = this.authorityBase;
    if (this.verifiedSources.has(entry.source)) {
      authority += this.authorityBoost;
    }
    return Math.min(1.0, authority);
  }

  /**
   * 要素 2：计算消费权重（归一化到 0.0-1.0）。
   *
   * 权重 = log(1 + consumption_count) / log(1 + 100)
   * roleagent.md §4.4：消费次数越高，权重越高。
   * 归一化基准 log(101) ≈ 4.6，对应 consumption_count=100 时权重=1.0。
   */
  async compute_weight(entry: MemoryEntry): Promise<number> {
    const raw = Math.log(1 + entry.consumption_count);
    return Math.min(1.0, raw / Math.log(CONSUMPTION_SATURATION));
  }

  /**
   * 要素 3：应用时间衰减策略。
   *
   * 基于半衰期的指数衰减：
   *   decayed = max(decay_min_score, authority × 0.5 ^ (elapsed / half_life))
   *
   * 幂等性：基于 last_accessed 计算，重复调用结果一致（不累积误差）。
   * 返回新的 MemoryEntry（不修改原对象），authority_level 已更新。
   */
  async apply_decay(entry: MemoryEntry): Promise<MemoryEntry> {
    const lastAccessed = parseIso(entry.last_accessed);
    const elapsedDays = (Date.now() - lastAccessed.getTime()) / 86_400_000;
    const decayFactor = 0.5 ** (elapsedDays / this.halfLifeDays);
    const decayedAuthority = Math.max(
      this.minScore,
      entry.authority_level * decayFactor,
    );
    return new MemoryEntry({
      entry_id: entry.entry_id,
      content: entry.content,
      source: entry.source,
      tags: [...entry.tags],
      consumption_count: entry.consumption_count,
      last_accessed: entry.last_accessed,
      created_at: entry.created_at,
      authority_level: decayedAuthority,
    });
  }
}

/** 数值钳制到 [min, max]。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 解析 ISO 8601 时间字符串，失败时返回当前时间（对齐 Python _parse_iso）。 */
function parseIso(ts: string): Date {
  const dt = new Date(ts);
  return Number.isNaN(dt.getTime()) ? new Date() : dt;
}
