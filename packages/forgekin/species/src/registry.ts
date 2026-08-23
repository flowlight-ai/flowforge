/**
 * @flowforge/forgekin-species — ForgekinRegistry 注册表 + 生命周期
 *
 * TS 移植自 `forgemind/registry.py`：
 * - register/unregister by id / lookup by id/name/type/capability
 * - list_active（energy > 0）
 * - select_owner 启发式：最多匹配能力 × 最高最小熟练度 × 最早注册
 * - 默认注册表可替换（测试隔离）
 *
 * @module @flowforge/forgekin-species/registry
 */

import { Forgekin, ForgekinError, type Capability, type ForgekinType } from './models.js';

/** 内存态 Forgekin 注册表 */
export class ForgekinRegistry {
  /** id → forgekin（Map 保持插入顺序 = 注册顺序，对齐 Python dict） */
  private readonly byId = new Map<string, Forgekin>();

  register(forgekin: Forgekin): void {
    if (this.byId.has(forgekin.forgekinId)) {
      throw new ForgekinError(`Forgekin ${JSON.stringify(forgekin.forgekinId)} already registered`);
    }
    this.byId.set(forgekin.forgekinId, forgekin);
  }

  unregister(forgekinId: string): Forgekin {
    const fk = this.byId.get(forgekinId);
    if (fk === undefined) {
      throw new ForgekinError(`Forgekin ${JSON.stringify(forgekinId)} not found`);
    }
    this.byId.delete(forgekinId);
    return fk;
  }

  get(forgekinId: string): Forgekin {
    const fk = this.byId.get(forgekinId);
    if (fk === undefined) {
      throw new ForgekinError(`Forgekin ${JSON.stringify(forgekinId)} not found`);
    }
    return fk;
  }

  findByName(name: string): Forgekin[] {
    return [...this.byId.values()].filter((fk) => fk.name === name);
  }

  findByType(forgekinType: ForgekinType): Forgekin[] {
    return [...this.byId.values()].filter((fk) => fk.forgekinType === forgekinType);
  }

  findByCapability(capabilityName: string, minProficiency = 0.5): Forgekin[] {
    return [...this.byId.values()].filter((fk) => fk.hasCapability(capabilityName, minProficiency));
  }

  /** 活跃 Forgekin（energy > 0） */
  listActive(): Forgekin[] {
    return [...this.byId.values()].filter((fk) => fk.state.energy > 0.0);
  }

  listAll(): Forgekin[] {
    return [...this.byId.values()];
  }

  count(): number {
    return this.byId.size;
  }

  /**
   * 选择最适合承接任务的 Forgekin。
   *
   * 启发式（对齐 Python select_owner）：
   * 最多匹配能力 × 最高最小熟练度 × 最早注册（确定性，便于测试）。
   */
  selectOwner(requiredCapabilities: readonly string[], exclude: readonly string[] = []): Forgekin | null {
    const excluded = new Set(exclude);
    interface Candidate {
      matched: number;
      minProf: number;
      index: number;
      forgekin: Forgekin;
    }
    const candidates: Candidate[] = [];
    let idx = 0;
    for (const fk of this.byId.values()) {
      idx += 1;
      if (excluded.has(fk.forgekinId)) {
        continue;
      }
      if (fk.state.energy <= 0.0) {
        continue;
      }
      let matched = 0;
      for (const c of requiredCapabilities) {
        if (fk.hasCapability(c)) {
          matched += 1;
        }
      }
      if (matched === 0 && requiredCapabilities.length > 0) {
        continue;
      }
      let minProf = 1.0;
      for (const c of requiredCapabilities) {
        const cap: Capability | undefined = fk.capabilities.get(c);
        if (cap !== undefined) {
          minProf = Math.min(minProf, cap.proficiency);
        } else {
          minProf = 0.0;
          break;
        }
      }
      candidates.push({ matched, minProf, index: idx, forgekin: fk });
    }
    if (candidates.length === 0) {
      return null;
    }
    // 排序：matched 降序 → minProf 降序 → index 升序（最早注册优先）
    candidates.sort((a, b) =>
      a.matched !== b.matched
        ? b.matched - a.matched
        : a.minProf !== b.minProf
          ? b.minProf - a.minProf
          : a.index - b.index,
    );
    return candidates[0]?.forgekin ?? null;
  }

  clear(): void {
    this.byId.clear();
  }
}

// ── 默认注册表（进程级，可替换用于测试隔离）──────────────────────

let defaultRegistry: ForgekinRegistry | null = null;

/** 获取进程级默认注册表（懒创建） */
export function getRegistry(): ForgekinRegistry {
  if (defaultRegistry === null) {
    defaultRegistry = new ForgekinRegistry();
  }
  return defaultRegistry;
}

/** 覆盖默认注册表（传 null 重置；测试隔离用） */
export function setRegistry(registry: ForgekinRegistry | null): void {
  defaultRegistry = registry;
}
