/**
 * @flowforge/forgekin-memory — 阶段7 T7.3 EchoStore 记忆存储域
 *
 * 本地化自 flowforge Python `memory/{base,episodic}.py`：
 * - EchoStore 抽象接口（P-109）：所有记忆存储统一 store/search 契约
 * - EpisodicMemoryStore：情景记忆（事件驱动持久化的内存实现，组合根可注入 SQLite 后端）
 *
 * @module @flowforge/forgekin-memory/echo-store
 */

/** 情景记忆记录（对齐 Python episodes 表行语义） */
export interface EpisodeRecord {
  /** 自增记录 ID */
  id: number;
  /** 关联任务 ID（Python 的 task_id 列） */
  taskId: string;
  /** 记忆内容（Python 的 trace JSON 列） */
  trace: unknown;
  /** 创建时间 ISO 8601 */
  createdAt: string;
}

/** EchoStore 记忆存储统一接口 — P-109（各存储子类必须实现 store 与 search） */
export interface EchoStore {
  /** 写入一条记忆 */
  store(key: string, value: unknown): Promise<void>;
  /** 按关键字检索记忆，返回条目列表（统一 limit 关键字） */
  search(query: string, limit?: number): Promise<unknown[]>;
}

/** 内存 EchoStore（默认后端，组合根可替换为 SQLite/Redis 持久化） */
export class InMemoryEchoStore implements EchoStore {
  private readonly entries = new Map<string, unknown>();

  async store(key: string, value: unknown): Promise<void> {
    this.entries.set(key, value);
  }

  async search(query: string, limit = 10): Promise<unknown[]> {
    const q = query.toLowerCase();
    const hits = [...this.entries.entries()]
      .filter(([k, v]) => k.toLowerCase().includes(q) || JSON.stringify(v).toLowerCase().includes(q))
      .map(([, v]) => v);
    return hits.slice(0, limit);
  }
}

/** 情景记忆存储（内存实现，对齐 Python EpisodicMemory：task_id + trace + created_at） */
export class EpisodicMemoryStore implements EchoStore {
  private readonly episodes: EpisodeRecord[] = [];
  private nextId = 1;

  async store(key: string, value: unknown): Promise<void> {
    this.episodes.push({
      id: this.nextId,
      taskId: key,
      trace: value,
      createdAt: new Date().toISOString(),
    });
    this.nextId += 1;
  }

  async search(query: string, limit = 10): Promise<unknown[]> {
    const q = query.toLowerCase();
    const hits = this.episodes
      .filter((e) => e.taskId.toLowerCase().includes(q) || JSON.stringify(e.trace).toLowerCase().includes(q))
      .map((e) => e.trace);
    return hits.slice(0, limit);
  }

  /** 列出记忆（分页 + 按 taskId 过滤，对齐 MemoryManager.list_memories） */
  listMemories(limit = 50, offset = 0, taskId?: string): { records: EpisodeRecord[]; total: number; limit: number; offset: number } {
    const filtered = taskId ? this.episodes.filter((e) => e.taskId === taskId) : [...this.episodes];
    const total = filtered.length;
    const records = filtered.reverse().slice(offset, offset + limit);
    return { records, total, limit, offset };
  }

  /** 按 ID 查询记忆 */
  getMemory(memoryId: number): EpisodeRecord | undefined {
    return this.episodes.find((e) => e.id === memoryId);
  }

  /** 按 ID 删除记忆 */
  deleteMemory(memoryId: number): boolean {
    const idx = this.episodes.findIndex((e) => e.id === memoryId);
    if (idx === -1) return false;
    this.episodes.splice(idx, 1);
    return true;
  }

  /** 按任务 ID 列出全部记忆（倒序） */
  getByTask(taskId: string): EpisodeRecord[] {
    return this.episodes.filter((e) => e.taskId === taskId).reverse();
  }
}
