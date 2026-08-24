/**
 * @flowforge/forgekin-stores — F39 记忆治理之 Collection 层。
 *
 * TS 重写自 `core/memory_federation/collection.py`（roleagent.md §4.3 L4 Collection 层）：
 *   - MemoryEntry：记忆条目（consumption_count + last_accessed 是消费加权治理的信号源；
 *     mark_consumed 返回新对象，保持不可变语义便于 trace / 回滚）
 *   - MemoryCollection：记忆集合（一个领域一个集合，跨项目持续）
 *   - CollectionManager：集合管理器（CRUD + 内存索引 + 可选持久化）
 *
 * 铁律遵守（移植自 Python 原版注释）：
 *   - 铁律 3：通过构造函数注入 logger / backend，不直接实例化外部服务
 *   - 铁律 4：禁止直接操作数据库，所有持久化通过 backend 抽象层（注入）
 *   - 编程红线 9：组合（数据类 + backend 注入）而非继承
 */

import { StoresError } from './wal.js';

/**
 * 集合持久化后端协议 — 所有持久化通过此抽象层。
 *
 * 具体实现由调用方注入：InMemoryCollectionBackend（默认，单 session 用）/
 * SqliteCollectionBackend（跨 session 用）/ PostgresCollectionBackend（生产用）。
 * 协议方法签名与 CollectionManager 的持久化操作一一对应。
 */
export interface CollectionBackend {
  /** 保存或更新集合。 */
  save_collection(collection: MemoryCollection): Promise<void>;
  /** 加载集合（不存在返回 null）。 */
  load_collection(collection_id: string): Promise<MemoryCollection | null>;
  /** 列出所有集合。 */
  list_collections(): Promise<MemoryCollection[]>;
}

/** 记忆条目 — 单个原子记忆单元（roleagent.md §4.4：重要性靠消费信号而非自评）。 */
export class MemoryEntry {
  /** 条目唯一标识（自动生成 UUID）。 */
  readonly entry_id: string;
  /** 记忆内容文本。 */
  content: string;
  /** 来源标识（如 agent_id / tool / file_path）。 */
  source: string;
  /** 标签列表（用于 Index 入口过滤）。 */
  tags: string[];
  /** 消费次数（被引用 / 被复用次数；检索命中返回给 agent 时由调用方自增）。 */
  consumption_count: number;
  /** 最后访问时间 ISO 8601。 */
  last_accessed: string;
  /** 创建时间 ISO 8601。 */
  created_at: string;
  /** 权威等级（0.0-1.0，由治理层计算后注入）。 */
  authority_level: number;

  constructor(init: {
    content: string;
    source?: string;
    tags?: string[];
    consumption_count?: number;
    last_accessed?: string;
    created_at?: string;
    authority_level?: number;
    entry_id?: string;
  }) {
    this.entry_id = init.entry_id ?? crypto.randomUUID();
    this.content = init.content;
    this.source = init.source ?? '';
    this.tags = init.tags ?? [];
    this.consumption_count = init.consumption_count ?? 0;
    this.last_accessed = init.last_accessed ?? new Date().toISOString();
    this.created_at = init.created_at ?? new Date().toISOString();
    this.authority_level = init.authority_level ?? 0.5;
  }

  /**
   * 标记为已消费 — 返回新的 MemoryEntry（不修改原对象）。
   *
   * consumption_count + 1，last_accessed 更新为当前时间。
   * 返回新对象以保持不可变语义（便于 trace / 回滚）。
   */
  mark_consumed(): MemoryEntry {
    return new MemoryEntry({
      entry_id: this.entry_id,
      content: this.content,
      source: this.source,
      tags: [...this.tags],
      consumption_count: this.consumption_count + 1,
      last_accessed: new Date().toISOString(),
      created_at: this.created_at,
      authority_level: this.authority_level,
    });
  }
}

/** 记忆集合 — 一个领域一个 Collection（roleagent.md §4.3：跨项目持续沉淀领域知识）。 */
export class MemoryCollection {
  /** 集合唯一标识（自动生成 UUID）。 */
  readonly collection_id: string;
  /** 集合名称（如 python_async_patterns）。 */
  name: string;
  /** 所属领域（如 programming / finance / medicine）。 */
  domain: string;
  /** 记忆条目列表。 */
  entries: MemoryEntry[];
  /** 集合级权威等级（默认 0.5，可被治理层覆盖）。 */
  authority_level: number;
  /** 创建时间 ISO 8601。 */
  created_at: string;

  constructor(init: {
    name: string;
    domain: string;
    entries?: MemoryEntry[];
    authority_level?: number;
    created_at?: string;
    collection_id?: string;
  }) {
    this.collection_id = init.collection_id ?? crypto.randomUUID();
    this.name = init.name;
    this.domain = init.domain;
    this.entries = init.entries ?? [];
    this.authority_level = init.authority_level ?? 0.5;
    this.created_at = init.created_at ?? new Date().toISOString();
  }
}

/**
 * 集合管理器 — CRUD + 内存索引 + 可选持久化。
 *
 * 铁律 3：通过构造函数注入 backend，不直接实例化外部服务。
 * 铁律 4：所有持久化通过 backend 抽象层（CollectionBackend），不直接操作数据库。
 *
 * @param backend 可选的持久化后端；缺省为纯内存模式（测试 / 单 session 用）。
 */
export class CollectionManager {
  private readonly collections = new Map<string, MemoryCollection>();

  constructor(private readonly backend?: CollectionBackend) {}

  /**
   * 创建新集合并返回。
   *
   * @param name 集合名称（如 python_async_patterns）。
   * @param domain 所属领域（如 programming）。
   */
  async create(name: string, domain: string): Promise<MemoryCollection> {
    const collection = new MemoryCollection({ name, domain });
    this.collections.set(collection.collection_id, collection);
    if (this.backend !== undefined) {
      await this.backend.save_collection(collection);
    }
    return collection;
  }

  /**
   * 向集合添加记忆条目。
   *
   * @throws StoresError 集合不存在时。
   */
  async add_entry(collection_id: string, entry: MemoryEntry): Promise<void> {
    const collection = this.getLocal(collection_id);
    collection.entries.push(entry);
    if (this.backend !== undefined) {
      await this.backend.save_collection(collection);
    }
  }

  /** 获取集合（不存在返回 null；backend 提供时尝试从后端加载）。 */
  async get(collection_id: string): Promise<MemoryCollection | null> {
    const local = this.collections.get(collection_id);
    if (local !== undefined) {
      return local;
    }
    if (this.backend !== undefined) {
      const loaded = await this.backend.load_collection(collection_id);
      if (loaded !== null) {
        this.collections.set(collection_id, loaded);
        return loaded;
      }
    }
    return null;
  }

  /** 列出所有集合（backend 提供时合并后端集合）。 */
  async list_collections(): Promise<MemoryCollection[]> {
    if (this.backend !== undefined) {
      const backendCollections = await this.backend.list_collections();
      for (const c of backendCollections) {
        if (!this.collections.has(c.collection_id)) {
          this.collections.set(c.collection_id, c);
        }
      }
    }
    return [...this.collections.values()];
  }

  /** 按领域过滤集合。 */
  async find_by_domain(domain: string): Promise<MemoryCollection[]> {
    const all = await this.list_collections();
    return all.filter((c) => c.domain === domain);
  }

  private getLocal(collection_id: string): MemoryCollection {
    const collection = this.collections.get(collection_id);
    if (collection === undefined) {
      throw new StoresError(`Collection not found: ${collection_id}`);
    }
    return collection;
  }
}
