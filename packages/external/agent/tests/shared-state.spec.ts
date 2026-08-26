/**
 * shared-state — F33 外部 Agent 共享状态测试（EX-004）。
 *
 * 语义对照 flowforge/core/external_agent/test_shared_state.py：
 *   - ExternalAgentSharedState.write：落 store + 内存条目索引（含 decision_context）
 *   - read：透传 store
 *   - listHistory：按 timestamp 升序
 *   - listKeys：透传 store
 *   - clear：清空索引
 *
 * @module @flowforge/external-agent/tests
 */

import { describe, expect, it } from 'vitest';
import { InMemorySharedStateStore } from '../src/index.js';
import {
  type SharedStateStore,
  ExternalAgentSharedState,
} from '../src/shared-state.js';

/** 可编程内存 Store（可注入故障）。 */
class FakeStore implements SharedStateStore {
  data = new Map<string, Map<string, unknown>>();
  failRead = false;

  async read(forgekinId: string, key: string): Promise<unknown> {
    if (this.failRead) {
      throw new Error('store read failed');
    }
    return this.data.get(forgekinId)?.get(key);
  }

  async write(forgekinId: string, key: string, value: unknown): Promise<void> {
    let map = this.data.get(forgekinId);
    if (!map) {
      map = new Map();
      this.data.set(forgekinId, map);
    }
    map.set(key, value);
  }

  async listKeys(forgekinId: string): Promise<string[]> {
    return Array.from(this.data.get(forgekinId)?.keys() ?? []);
  }
}

describe('ExternalAgentSharedState（shared_state.py）', () => {
  it('write 落 store 且 read 可回读', async () => {
    const state = new ExternalAgentSharedState(new FakeStore());
    await state.write('fk-1', 'task_result', { done: true }, 'vendor.tool');
    await expect(state.read('fk-1', 'task_result')).resolves.toEqual({ done: true });
  });

  it('未写过的 key 返回 undefined', async () => {
    const state = new ExternalAgentSharedState(new FakeStore());
    await expect(state.read('fk-1', 'nope')).resolves.toBeUndefined();
  });

  it('write 记录 provider_name 与 decision_context', async () => {
    const state = new ExternalAgentSharedState(new FakeStore());
    await state.write('fk-1', 'k', 'v', 'vendor.tool', { reason: 'test' });
    const history = await state.listHistory('fk-1');
    expect(history).toHaveLength(1);
    expect(history[0]!.provider_name).toBe('vendor.tool');
    expect(history[0]!.decision_context).toEqual({ reason: 'test' });
    expect(history[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('listHistory 按 timestamp 升序', async () => {
    const state = new ExternalAgentSharedState(new FakeStore());
    // 手动控制顺序：先写较晚时间戳不可行，改用多次写入验证相对顺序稳定
    await state.write('fk-1', 'a', 1);
    await state.write('fk-1', 'b', 2);
    await state.write('fk-1', 'c', 3);
    const history = await state.listHistory('fk-1');
    expect(history.map((e) => e.key)).toEqual(['a', 'b', 'c']);
    const timestamps = history.map((e) => e.timestamp);
    expect([...timestamps].sort()).toEqual(timestamps);
  });

  it('listKeys 透传 store 的 key 集合', async () => {
    const store = new FakeStore();
    const state = new ExternalAgentSharedState(store);
    await state.write('fk-1', 'x', 1);
    await state.write('fk-1', 'y', 2);
    await expect(state.listKeys('fk-1')).resolves.toEqual(['x', 'y']);
  });

  it('clear 清空历史索引（store 数据保留）', async () => {
    const store = new FakeStore();
    const state = new ExternalAgentSharedState(store);
    await state.write('fk-1', 'x', 1);
    state.clear('fk-1');
    await expect(state.listHistory('fk-1')).resolves.toEqual([]);
    await expect(state.read('fk-1', 'x')).resolves.toBe(1);
  });

  it('read 失败透传 store 异常', async () => {
    const store = new FakeStore();
    store.failRead = true;
    const state = new ExternalAgentSharedState(store);
    await expect(state.read('fk-1', 'x')).rejects.toThrow('store read failed');
  });

  it('InMemorySharedStateStore 缺省实现可用', async () => {
    const state = new ExternalAgentSharedState(new InMemorySharedStateStore());
    await state.write('fk-2', 'k', { n: 1 });
    await expect(state.read('fk-2', 'k')).resolves.toEqual({ n: 1 });
    await expect(state.listKeys('fk-2')).resolves.toEqual(['k']);
  });
});
