/**
 * @flowforge/forgekin-memory — 阶段7 T7.3 MemoryManager 记忆管理器
 *
 * 本地化自 flowforge Python `memory/manager.py`（134 行）：
 * - 五存储组合：working / shortTerm / longTerm / semantic / episodic
 * - save/retrieve 未知类型告警（P-109：避免静默丢失写入）
 * - hybridSearch 过滤未知类型；listMemories/getMemory/deleteMemory/getByTask 走 episodic
 *
 * @module @flowforge/forgekin-memory/memory-manager
 */

import { EchoStore, EpisodicMemoryStore, EpisodeRecord, InMemoryEchoStore } from './echo-store.js';

export const MEMORY_TYPES = ['working', 'short_term', 'long_term', 'semantic', 'episodic'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** hybrid_search 默认检索范围（对齐 Python 默认 types） */
export const HYBRID_SEARCH_DEFAULT_TYPES = ['semantic', 'long_term', 'episodic'] as const;

/** 存储后端注入项（键为类属性名） */
export type MemoryStoreBackends = Partial<{
  working: EchoStore;
  shortTerm: EchoStore;
  longTerm: EchoStore;
  semantic: EchoStore;
  episodic: EchoStore;
}>;

export interface MemoryManagerOptions {
  /** 各存储后端（缺省全部 InMemory；组合根注入持久化后端） */
  readonly stores?: MemoryStoreBackends | undefined;
}

export class MemoryManager {
  readonly working: EchoStore;
  readonly shortTerm: EchoStore;
  readonly longTerm: EchoStore;
  readonly semantic: EchoStore;
  readonly episodic: EpisodicMemoryStore;

  constructor(options: MemoryManagerOptions = {}) {
    const stores = options.stores ?? {};
    this.working = stores.working ?? new InMemoryEchoStore();
    this.shortTerm = stores.shortTerm ?? new InMemoryEchoStore();
    this.longTerm = stores.longTerm ?? new InMemoryEchoStore();
    this.semantic = stores.semantic ?? new InMemoryEchoStore();
    // episodic 需要 list/get/delete 能力，固定用 EpisodicMemoryStore（组合根可继承扩展）
    this.episodic = stores.episodic instanceof EpisodicMemoryStore
      ? stores.episodic
      : new EpisodicMemoryStore();
  }

  /** 列出可用存储类型（P-109 告警文案用） */
  listStores(): string[] {
    return ['working', 'short_term', 'long_term', 'episodic', 'semantic'];
  }

  private resolve(type: string): EchoStore | undefined {
    switch (type) {
      case 'working': return this.working;
      case 'short_term': return this.shortTerm;
      case 'long_term': return this.longTerm;
      case 'semantic': return this.semantic;
      case 'episodic': return this.episodic;
      default: return undefined;
    }
  }

  /** 写入一条记忆（未知存储类型记录告警，避免静默丢失 — P-109） */
  async save(memoryType: string, key: string, data: unknown): Promise<void> {
    const store = this.resolve(memoryType);
    if (!store) {
      console.warn(`[forgeMemory] save: 未知记忆存储类型 '${memoryType}'（可选：${this.listStores().join(', ')}）`);
      return;
    }
    await store.store(key, data);
  }

  /** 检索记忆（未知存储类型返回空结果并告警 — P-109） */
  async retrieve(memoryType: string, query: string): Promise<unknown[]> {
    const store = this.resolve(memoryType);
    if (!store) {
      console.warn(`[forgeMemory] retrieve: 未知记忆存储类型 '${memoryType}'（可选：${this.listStores().join(', ')}）`);
      return [];
    }
    return store.search(query);
  }

  /** 混合检索：默认 semantic + long_term + episodic，未知类型忽略 */
  async hybridSearch(query: string, types: string[] = [...HYBRID_SEARCH_DEFAULT_TYPES], limit = 10): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const t of types) {
      const store = this.resolve(t);
      if (!store) {
        console.warn(`[forgeMemory] hybrid_search: 忽略未知存储类型 '${t}'`);
        continue;
      }
      results.push(...await store.search(query, limit));
    }
    return results;
  }

  /** 列出情景记忆（分页 + 按 taskId 过滤） */
  async listMemories(limit = 50, offset = 0, taskId?: string): Promise<{ records: EpisodeRecord[]; total: number; limit: number; offset: number }> {
    return this.episodic.listMemories(limit, offset, taskId);
  }

  /** 按 ID 查询情景记忆 */
  async getMemory(memoryId: number): Promise<EpisodeRecord | undefined> {
    return this.episodic.getMemory(memoryId);
  }

  /** 按 ID 删除情景记忆 */
  async deleteMemory(memoryId: number): Promise<boolean> {
    return this.episodic.deleteMemory(memoryId);
  }

  /** 按任务 ID 列出情景记忆（倒序） */
  async getByTask(taskId: string): Promise<EpisodeRecord[]> {
    return this.episodic.getByTask(taskId);
  }
}
