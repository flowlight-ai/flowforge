/**
 * @flowforge/forgekin-memory — 阶段7 T7.3 情景记忆域 Cordis 插件
 *
 * 挂载 `ctx.forgeMemory`：EchoStore 五存储（working/shortTerm/longTerm/semantic/episodic）
 * save/retrieve/hybridSearch/list/get/delete + 事件驱动持久化后端注入点。
 * 对齐 Python `memory/{base,manager,episodic}.py` 语义（P-109）。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  EpisodeRecord,
} from './echo-store.js';
import {
  HYBRID_SEARCH_DEFAULT_TYPES,
  MemoryManager,
  MemoryManagerOptions,
} from './memory-manager.js';

export * from './echo-store.js';
export * from './memory-manager.js';

/** 情景记忆持久化钩子（事件驱动持久化：组合根监听事件写 SQLite/WAL） */
export interface EpisodePersistenceHook {
  /** 新情景记忆落库回调 */
  onStore(record: EpisodeRecord): Promise<void>;
}

export interface MemoryServiceOptions extends MemoryManagerOptions {
  /** 事件驱动持久化钩子（组合根注入 SQLite/Redis 后端） */
  readonly persistence?: EpisodePersistenceHook | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 情景记忆域：五存储 save/retrieve/hybrid + 情景记忆 CRUD */
    forgeMemory: MemoryService;
  }
}

export class MemoryService extends Service {
  readonly manager: MemoryManager;
  private readonly persistence: EpisodePersistenceHook | undefined;

  constructor(ctx: Context, options: MemoryServiceOptions = {}) {
    super(ctx, 'forgeMemory');
    this.manager = new MemoryManager(options);
    this.persistence = options.persistence;
  }

  /** 写入一条记忆（memoryType: working/short_term/long_term/semantic/episodic） */
  async save(memoryType: string, key: string, data: unknown): Promise<void> {
    await this.manager.save(memoryType, key, data);
    if (memoryType === 'episodic' && this.persistence) {
      const records = await this.manager.getByTask(key);
      const latest = records[0];
      if (latest) await this.persistence.onStore(latest);
    }
  }

  /** 检索记忆 */
  retrieve(memoryType: string, query: string): Promise<unknown[]> {
    return this.manager.retrieve(memoryType, query);
  }

  /** 混合检索（默认 semantic + long_term + episodic） */
  hybridSearch(query: string, types: string[] = [...HYBRID_SEARCH_DEFAULT_TYPES], limit = 10): Promise<unknown[]> {
    return this.manager.hybridSearch(query, types, limit);
  }

  /** 列出情景记忆（分页 + taskId 过滤） */
  listMemories(limit = 50, offset = 0, taskId?: string): Promise<{ records: EpisodeRecord[]; total: number; limit: number; offset: number }> {
    return this.manager.listMemories(limit, offset, taskId);
  }

  /** 按 ID 查询情景记忆 */
  getMemory(memoryId: number): Promise<EpisodeRecord | undefined> {
    return this.manager.getMemory(memoryId);
  }

  /** 按 ID 删除情景记忆 */
  deleteMemory(memoryId: number): Promise<boolean> {
    return this.manager.deleteMemory(memoryId);
  }

  /** 按任务 ID 列出情景记忆 */
  getByTask(taskId: string): Promise<EpisodeRecord[]> {
    return this.manager.getByTask(taskId);
  }

  /** 存储类型清单（P-109 告警文案） */
  listStores(): string[] {
    return this.manager.listStores();
  }
}

export default function Plugin(ctx: Context, options?: MemoryServiceOptions) {
  return ctx.plugin(MemoryService, options);
}
