/**
 * 绑定存储契约测试 — Memory + Redis（端口仿真）。
 * 真实存储（Memory / FakeConnectorRedis），禁 Mock。
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryConnectorThreadBindingStore,
  type IConnectorThreadBindingStore,
  RedisConnectorThreadBindingStore,
} from '../src/index.ts';
import { FakeConnectorRedis } from './helpers/fake-redis.ts';

describe('MemoryConnectorThreadBindingStore', () => {
  const store: IConnectorThreadBindingStore = new MemoryConnectorThreadBindingStore();

  it('bind 后可按外部会话查询 binding 字段', () => {
    const b = store.bind('feishu', 'chat-1', 'th-1', 'u-1');
    expect(b.connectorId).toBe('feishu');
    expect(b.externalChatId).toBe('chat-1');
    expect(b.threadId).toBe('th-1');
    expect(b.userId).toBe('u-1');
    expect(typeof b.createdAt).toBe('number');

    const got = store.getByExternal('feishu', 'chat-1');
    expect(got?.threadId).toBe('th-1');
    expect(store.getByExternal('feishu', 'nope')).toBeNull();
  });

  it('getByThread 聚合所有绑定，remove 反向清理', () => {
    store.bind('telegram', 'tg-1', 'th-2', 'u-1');
    store.bind('dingtalk', 'dt-1', 'th-2', 'u-2');
    expect(store.getByThread('th-2')).toHaveLength(2);

    expect(store.remove('telegram', 'tg-1')).toBe(true);
    expect(store.getByThread('th-2')).toHaveLength(1);
    expect(store.remove('telegram', 'tg-1')).toBe(false);
  });

  it('listByUser 按 connector 过滤并支持 limit', () => {
    store.bind('feishu', 'chat-2', 'th-3', 'u-7');
    store.bind('feishu', 'chat-3', 'th-4', 'u-7');
    const all = store.listByUser('feishu', 'u-7');
    expect(all).toHaveLength(2);
    const limited = store.listByUser('feishu', 'u-7', 1);
    expect(limited).toHaveLength(1);
  });

  it('setHubThread 更新 hubThreadId 且对不存在绑定返回 null', () => {
    store.bind('feishu', 'chat-9', 'th-9', 'u-9');
    store.setHubThread('feishu', 'chat-9', 'hub-1');
    expect(store.getByExternal('feishu', 'chat-9')?.hubThreadId).toBe('hub-1');
    expect(store.setHubThread('feishu', 'missing', 'hub-2')).toBeNull();
  });
});

describe('RedisConnectorThreadBindingStore', () => {
  const redis = new FakeConnectorRedis();
  const store: IConnectorThreadBindingStore = new RedisConnectorThreadBindingStore(redis);

  it('bind 写入 hash + 反向索引，getByExternal/getByThread 可读回', async () => {
    await store.bind('feishu', 'rc-1', 'rt-1', 'ru-1');
    const got = await store.getByExternal('feishu', 'rc-1');
    expect(got?.threadId).toBe('rt-1');
    expect(got?.userId).toBe('ru-1');

    const byThread = await store.getByThread('rt-1');
    expect(byThread).toHaveLength(1);
    expect(byThread[0]?.connectorId).toBe('feishu');
  });

  it('remove 清理 hash 与反向索引', async () => {
    await store.bind('telegram', 'rtg-1', 'rt-2', 'ru-2');
    expect(await store.remove('telegram', 'rtg-1')).toBe(true);
    expect(await store.getByExternal('telegram', 'rtg-1')).toBeNull();
    expect(await store.getByThread('rt-2')).toHaveLength(0);
    expect(await store.remove('telegram', 'rtg-1')).toBe(false);
  });

  it('listByUser 返回按 createdAt 倒序的用户绑定', async () => {
    await store.bind('feishu', 'rc-u1', 'rt-u1', 'ruu');
    // 保证 createdAt 递增（Date.now 毫秒戳），否则同毫秒下倒序不稳定
    await new Promise((r) => setTimeout(r, 5));
    await store.bind('feishu', 'rc-u2', 'rt-u2', 'ruu');
    const list = await store.listByUser('feishu', 'ruu');
    expect(list.map((b) => b.externalChatId)).toEqual(['rc-u2', 'rc-u1']);
  });

  it('setHubThread 更新 hubThreadId（hash 写回）', async () => {
    await store.bind('feishu', 'rc-h', 'rt-h', 'ru-h');
    await store.setHubThread('feishu', 'rc-h', 'hub-x');
    expect((await store.getByExternal('feishu', 'rc-h'))?.hubThreadId).toBe('hub-x');
  });
});