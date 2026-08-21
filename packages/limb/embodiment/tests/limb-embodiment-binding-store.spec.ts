/**
 * LimbEmbodimentBindingStore — T6.4 具身绑定存储契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbEmbodimentBindingStore.ts` 语义）：
 * - Memory 后端 put/get/getByThread/remove roundtrip + structuredClone 隔离
 * - put 校验非法绑定抛 TypeError
 * - Redis 后端 roundtrip；换线程后旧线程 set 清理；getByThread 清理孤儿
 *
 * @module @flowforge/limb-embodiment/tests
 */

import { describe, expect, it } from 'vitest';
import {
  LimbEmbodimentBinding,
  MemoryLimbEmbodimentBindingStore,
  RedisLimbEmbodimentBindingStore,
  RedisBindingLike,
} from '../src/limb-embodiment-binding-store.ts';

function makeBinding(overrides: Partial<LimbEmbodimentBinding> = {}): LimbEmbodimentBinding {
  return {
    nodeId: 'camera-01',
    userId: 'user-1',
    threadId: 'thread-a',
    catId: 'cat_a',
    expressionRef: 'calm',
    voiceProfileRef: 'default',
    volumePercent: 70,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('MemoryLimbEmbodimentBindingStore', () => {
  it('put/get/getByThread/remove roundtrip', async () => {
    const store = new MemoryLimbEmbodimentBindingStore();
    expect(await store.get('camera-01')).toBeUndefined();

    await store.put(makeBinding());
    const got = await store.get('camera-01');
    expect(got?.threadId).toBe('thread-a');
    expect(got?.volumePercent).toBe(70);

    expect(await store.getByThread('thread-a')).toHaveLength(1);
    expect(await store.getByThread('thread-b')).toHaveLength(0);

    await store.remove('camera-01');
    expect(await store.get('camera-01')).toBeUndefined();
  });

  it('put 同 nodeId 覆盖；换线程后按新线程查询', async () => {
    const store = new MemoryLimbEmbodimentBindingStore();
    await store.put(makeBinding());
    await store.put(makeBinding({ threadId: 'thread-b', voiceProfileRef: 'deep' }));

    expect(await store.getByThread('thread-a')).toHaveLength(0);
    const moved = await store.getByThread('thread-b');
    expect(moved).toHaveLength(1);
    expect(moved[0]?.voiceProfileRef).toBe('deep');
  });

  it('get 返回克隆（引用隔离，外部修改不影响存储）', async () => {
    const store = new MemoryLimbEmbodimentBindingStore();
    await store.put(makeBinding());
    const got = await store.get('camera-01');
    const again = await store.get('camera-01');
    expect(again).not.toBe(got);
    expect(again?.volumePercent).toBe(70);
  });

  it('put 校验非法绑定抛 TypeError', async () => {
    const store = new MemoryLimbEmbodimentBindingStore();
    await expect(store.put(makeBinding({ volumePercent: 101 }))).rejects.toThrow(TypeError);
    await expect(store.put(makeBinding({ nodeId: '' }))).rejects.toThrow(TypeError);
    await expect(store.put(makeBinding({ updatedAt: -1 }))).rejects.toThrow(TypeError);
  });
});

function makeRedis(): { store: RedisLimbEmbodimentBindingStore; redis: RedisBindingLike } {
  const data = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const redis: RedisBindingLike = {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
    async sadd(key, member) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(member);
      sets.set(key, s);
    },
    async srem(key, member) {
      sets.get(key)?.delete(member);
    },
    async smembers(key) {
      return [...(sets.get(key) ?? [])];
    },
  };
  return { store: new RedisLimbEmbodimentBindingStore(redis), redis };
}

describe('RedisLimbEmbodimentBindingStore', () => {
  it('put/get/getByThread/remove roundtrip', async () => {
    const { store } = makeRedis();
    await store.put(makeBinding());
    expect((await store.get('camera-01'))?.threadId).toBe('thread-a');
    expect(await store.getByThread('thread-a')).toHaveLength(1);

    await store.remove('camera-01');
    expect(await store.get('camera-01')).toBeUndefined();
    expect(await store.getByThread('thread-a')).toHaveLength(0);
  });

  it('put 换线程清理旧线程索引', async () => {
    const { store } = makeRedis();
    await store.put(makeBinding());
    await store.put(makeBinding({ threadId: 'thread-b' }));

    expect(await store.getByThread('thread-a')).toHaveLength(0);
    expect(await store.getByThread('thread-b')).toHaveLength(1);
  });

  it('getByThread 清理孤儿索引（set 残留但记录已失）', async () => {
    const { store, redis } = makeRedis();
    await store.put(makeBinding());
    await redis.del('limb:embodiment-binding:camera-01'); // 模拟外部删记录

    expect(await store.getByThread('thread-a')).toHaveLength(0);
    expect(await redis.smembers('limb:embodiment-thread:thread-a')).toHaveLength(0);
  });

  it('put 校验非法绑定抛 TypeError；get 解析坏 JSON 返回 undefined', async () => {
    const { store, redis } = makeRedis();
    await expect(store.put(makeBinding({ volumePercent: 200 }))).rejects.toThrow(TypeError);

    await redis.set('limb:embodiment-binding:camera-01', 'not-json');
    expect(await store.get('camera-01')).toBeUndefined();
  });
});
