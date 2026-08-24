/**
 * MemoryCollection / CollectionManager — F39 记忆集合层契约验证。
 *
 * 移植自 `core/memory_federation/collection.py`：
 *   - MemoryEntry.mark_consumed 不可变语义（返回新对象，原对象不变）
 *   - CollectionManager create / add_entry / get / list_collections / find_by_domain
 *   - backend 协议注入（铁律 4：持久化走抽象层）+ 惰性加载
 *   - add_entry 未知集合抛 StoresError（对齐 Python KeyError）
 *
 * @module @flowforge/forgekin-stores/tests
 */

import { describe, expect, it } from 'vitest';
import {
  CollectionBackend,
  CollectionManager,
  MemoryCollection,
  MemoryEntry,
} from '../src/collection.js';
import { StoresError } from '../src/wal.js';

/** 内存版 backend（测试用，模拟跨 session 持久化）。 */
class FakeBackend implements CollectionBackend {
  private readonly store = new Map<string, MemoryCollection>();

  async save_collection(collection: MemoryCollection): Promise<void> {
    this.store.set(collection.collection_id, collection);
  }

  async load_collection(collection_id: string): Promise<MemoryCollection | null> {
    return this.store.get(collection_id) ?? null;
  }

  async list_collections(): Promise<MemoryCollection[]> {
    return [...this.store.values()];
  }
}

describe('MemoryEntry', () => {
  it('mark_consumed 返回新对象：消费计数 +1、时间刷新、原对象不变', () => {
    const entry = new MemoryEntry({ content: 'python asyncio 模式', source: 'codex' });
    const consumed = entry.mark_consumed();

    expect(consumed).not.toBe(entry);
    expect(consumed.entry_id).toBe(entry.entry_id);
    expect(consumed.consumption_count).toBe(1);
    expect(entry.consumption_count).toBe(0);
    expect(consumed.content).toBe(entry.content);
    expect(consumed.last_accessed >= entry.last_accessed).toBe(true);
  });

  it('连续消费可累积（每次基于最新状态）', () => {
    let entry = new MemoryEntry({ content: 'x' });
    entry = entry.mark_consumed();
    entry = entry.mark_consumed();
    entry = entry.mark_consumed();
    expect(entry.consumption_count).toBe(3);
  });
});

describe('CollectionManager CRUD', () => {
  it('create 返回新集合，get 可读回', async () => {
    const mgr = new CollectionManager();
    const collection = await mgr.create('python_async_patterns', 'programming');

    expect(collection.name).toBe('python_async_patterns');
    expect(collection.domain).toBe('programming');
    expect(collection.authority_level).toBe(0.5);
    expect(await mgr.get(collection.collection_id)).toBe(collection);
  });

  it('add_entry 写入集合，get 不存在返回 null', async () => {
    const mgr = new CollectionManager();
    const collection = await mgr.create('finance', 'finance');
    const entry = new MemoryEntry({ content: '复利公式', tags: ['math'] });

    await mgr.add_entry(collection.collection_id, entry);
    const loaded = await mgr.get(collection.collection_id);
    expect(loaded?.entries).toHaveLength(1);
    expect(loaded?.entries[0]?.content).toBe('复利公式');
    expect(await mgr.get('ghost-id')).toBeNull();
  });

  it('add_entry 未知集合抛 StoresError', async () => {
    const mgr = new CollectionManager();
    await expect(
      mgr.add_entry('nope', new MemoryEntry({ content: 'x' })),
    ).rejects.toThrow(StoresError);
  });

  it('list_collections 返回全部，find_by_domain 按领域过滤', async () => {
    const mgr = new CollectionManager();
    await mgr.create('python', 'programming');
    await mgr.create('js', 'programming');
    await mgr.create('cardio', 'medicine');

    expect(await mgr.list_collections()).toHaveLength(3);
    const programming = await mgr.find_by_domain('programming');
    expect(programming).toHaveLength(2);
    expect(programming.map((c) => c.name).sort()).toEqual(['js', 'python']);
  });
});

describe('CollectionManager backend 协议注入', () => {
  it('create 经 backend 持久化，新管理器可加载（跨 session）', async () => {
    const backend = new FakeBackend();
    const mgr1 = new CollectionManager(backend);
    const collection = await mgr1.create('persisted', 'programming');
    const entry = new MemoryEntry({ content: '记忆', source: 'spiritforge' });
    await mgr1.add_entry(collection.collection_id, entry);

    // 模拟新 session：纯 backend 驱动
    const mgr2 = new CollectionManager(backend);
    const loaded = await mgr2.get(collection.collection_id);
    expect(loaded?.name).toBe('persisted');
    expect(loaded?.entries).toHaveLength(1);
  });

  it('list_collections 合并后端集合（惰性加载，不重复）', async () => {
    const backend = new FakeBackend();
    await new CollectionManager(backend).create('backend-only', 'medicine');

    const mgr = new CollectionManager(backend);
    await mgr.create('local-only', 'programming');
    const all = await mgr.list_collections();

    expect(all).toHaveLength(2);
    expect(all.map((c) => c.name).sort()).toEqual(['backend-only', 'local-only']);
  });
});
