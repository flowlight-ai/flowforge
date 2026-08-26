/**
 * @flowforge/external-agent capability-registry — 能力注册表（EX-008）。
 *
 * TS 重写自 flowforge/core/external_agent/capability_registry.py：
 *   - CapabilityEntry: provider_name / capability / manifest_ref / success_rate
 *   - CapabilityRegistry: 二级索引 provider → capability → entry；
 *     register / unregister / discover（按 success_rate 降序）/
 *     listCapabilities / getBestProvider(capability, exclude?)
 */

/** 能力条目（capability_registry.py CapabilityEntry）。 */
export interface CapabilityEntry {
  /** Provider 名称。 */
  readonly provider_name: string;
  /** 能力名称。 */
  readonly capability: string;
  /** Manifest 引用（provider 点分名）。 */
  readonly manifest_ref: string;
  /** 成功率（0.0-1.0，缺省 1.0）。 */
  readonly success_rate: number;
}

/** 能力注册表（capability_registry.py CapabilityRegistry）。 */
export class CapabilityRegistry {
  /** provider -> capability -> entry。 */
  private readonly _index = new Map<string, Map<string, CapabilityEntry>>();

  /** 注册能力（provider 维度覆盖式注册）。 */
  register(entry: CapabilityEntry): void {
    let providerMap = this._index.get(entry.provider_name);
    if (!providerMap) {
      providerMap = new Map();
      this._index.set(entry.provider_name, providerMap);
    }
    providerMap.set(entry.capability, entry);
  }

  /** 注销某 Provider 的某能力（返回是否曾注册）。 */
  unregister(providerName: string, capability: string): boolean {
    const providerMap = this._index.get(providerName);
    if (!providerMap) {
      return false;
    }
    const removed = providerMap.delete(capability);
    if (providerMap.size === 0) {
      this._index.delete(providerName);
    }
    return removed;
  }

  /**
   * 按能力发现 Provider（capability_registry.py discover）：
   * 返回按 success_rate 降序排列的条目列表。
   */
  discover(capability: string): CapabilityEntry[] {
    const entries: CapabilityEntry[] = [];
    for (const providerMap of this._index.values()) {
      const entry = providerMap.get(capability);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.success_rate - a.success_rate);
  }

  /** 列出某 Provider 的全部能力。 */
  listCapabilities(providerName: string): string[] {
    const providerMap = this._index.get(providerName);
    return providerMap ? [...providerMap.keys()] : [];
  }

  /**
   * 获取某能力的最佳 Provider（capability_registry.py get_best_provider）。
   *
   * @param capability 能力名称。
   * @param exclude 排除的 Provider 列表（fallback 时逐级排除）。
   * @returns 最佳 Provider 名称（无可用时 undefined）。
   */
  getBestProvider(capability: string, exclude: readonly string[] = []): string | undefined {
    const candidates = this.discover(capability).filter(
      (entry) => !exclude.includes(entry.provider_name),
    );
    return candidates.length > 0 ? candidates[0]!.provider_name : undefined;
  }

  /** 全部条目（按 provider 注册顺序）。 */
  listAll(): CapabilityEntry[] {
    const entries: CapabilityEntry[] = [];
    for (const providerMap of this._index.values()) {
      for (const entry of providerMap.values()) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /** 已注册 Provider 数量。 */
  get providerCount(): number {
    return this._index.size;
  }
}
