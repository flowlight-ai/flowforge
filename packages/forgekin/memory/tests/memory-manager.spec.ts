/**
 * EchoStore / MemoryManager — T7.3 记忆存储域契约验证。
 *
 * 覆盖（对齐 Python `memory/{base,episodic,manager}.py` 语义）：
 * - EchoStore 统一 store/search 契约 + limit 关键字
 * - EpisodicMemoryStore：taskId/trace/createdAt + list/get/delete/getByTask
 * - MemoryManager：save/retrieve/hybridSearch/listMemories + P-109 未知类型告警
 *
 * @module @flowforge/forgekin-memory/tests
 */

import { describe, expect, it } from 'vitest';
import {
  EpisodicMemoryStore,
  InMemoryEchoStore,
} from '../src/echo-store.js';
import {
  MemoryManager,
} from '../src/memory-manager.js';

describe('EchoStore 契约', () => {
  it('InMemoryEchoStore：store/search 按 key + 内容匹配', async () => {
    const store = new InMemoryEchoStore();
    await store.store('task-1', { kind: 'episode', note: '重构了 limb-core' });
    await store.store('task-2', { kind: 'episode', note: '调试了 tmux 网关' });
    expect((await store.search('limb')).length).toBe(1);
    expect((await store.search('task-1')).length).toBe(1);
    expect(await store.search('不存在')).toEqual([]);
  });

  it('search 统一 limit 关键字', async () => {
    const store = new InMemoryEchoStore();
    for (let i = 0; i < 5; i += 1) await store.store(`k-${i}`, { note: `内容 ${i}` });
    expect((await store.search('内容', 3)).length).toBe(3);
  });
});

describe('EpisodicMemoryStore', () => {
  it('store 自动递增 id + created_at；search 返回 trace', async () => {
    const store = new EpisodicMemoryStore();
    await store.store('task-1', { action: 'review' });
    await store.store('task-1', { action: 'fix' });
    const hits = await store.search('review');
    expect(hits).toEqual([{ action: 'review' }]);
    const records = store.listMemories();
    expect(records.total).toBe(2);
    expect(records.records[0]!.id).toBe(2);
    expect(records.records[0]!.taskId).toBe('task-1');
    expect(records.records[0]!.createdAt).toBeTruthy();
  });

  it('listMemories 分页 + taskId 过滤（倒序）', async () => {
    const store = new EpisodicMemoryStore();
    for (let i = 1; i <= 4; i += 1) await store.store(`task-${i % 2}`, { n: i });
    const page1 = store.listMemories(2, 0);
    expect(page1.records.map((r) => r.id)).toEqual([4, 3]);
    expect(page1.total).toBe(4);
    const page2 = store.listMemories(2, 2);
    expect(page2.records.map((r) => r.id)).toEqual([2, 1]);
    const byTask = store.listMemories(50, 0, 'task-0');
    expect(byTask.total).toBe(2);
    expect(byTask.records.map((r) => r.id)).toEqual([4, 2]);
  });

  it('getMemory / deleteMemory / getByTask', async () => {
    const store = new EpisodicMemoryStore();
    await store.store('task-a', { action: 'a1' });
    await store.store('task-a', { action: 'a2' });
    await store.store('task-b', { action: 'b1' });
    expect(store.getMemory(2)?.trace).toEqual({ action: 'a2' });
    expect(store.getMemory(99)).toBeUndefined();
    expect(store.deleteMemory(2)).toBe(true);
    expect(store.deleteMemory(2)).toBe(false);
    expect(store.getByTask('task-a').map((r) => r.id)).toEqual([1]);
    expect(store.getByTask('task-b').map((r) => r.id)).toEqual([3]);
  });
});

describe('MemoryManager', () => {
  it('save/retrieve 各存储类型独立 + 未知类型告警不崩溃（P-109）', async () => {
    const manager = new MemoryManager();
    await manager.save('semantic', 'concept-1', { title: '插件化原则' });
    await manager.save('long_term', 'rule-1', { title: '一切皆插件' });
    await manager.save('unknown_type', 'x', { title: '应被告警' });
    expect((await manager.retrieve('semantic', '插件化')).length).toBe(1);
    expect(await manager.retrieve('unknown_type', 'x')).toEqual([]);
  });

  it('hybridSearch：默认 semantic+long_term+episodic，未知类型忽略', async () => {
    const manager = new MemoryManager();
    await manager.save('semantic', 's-1', { title: '跨厂商 review 原则' });
    await manager.save('long_term', 'l-1', { title: '跨厂商 review 执行' });
    await manager.save('working', 'w-1', { title: '跨厂商 review 草稿' });
    const results = await manager.hybridSearch('review');
    expect(results).toHaveLength(2);
    const withUnknown = await manager.hybridSearch('review', ['semantic', 'bogus', 'long_term']);
    expect(withUnknown).toHaveLength(2);
  });

  it('listMemories/getMemory/deleteMemory/getByTask 走 episodic', async () => {
    const manager = new MemoryManager();
    await manager.save('episodic', 'task-9', { action: 'distill' });
    const listed = await manager.listMemories();
    expect(listed.total).toBe(1);
    const got = await manager.getMemory(listed.records[0]!.id);
    expect(got?.taskId).toBe('task-9');
    expect((await manager.getByTask('task-9')).length).toBe(1);
    expect(await manager.deleteMemory(listed.records[0]!.id)).toBe(true);
    expect((await manager.listMemories()).total).toBe(0);
  });

  it('listStores 返回全部可用类型', () => {
    const manager = new MemoryManager();
    expect(manager.listStores()).toEqual(['working', 'short_term', 'long_term', 'episodic', 'semantic']);
  });
});
