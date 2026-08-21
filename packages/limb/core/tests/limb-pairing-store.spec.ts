/**
 * LimbPairingStore — T6.1 设备配对审批契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbPairingStore.ts` 语义）：
 * - createRequest pending + apiKey 生成 + nodeId 幂等
 * - approve：状态/审批人/decidedAt；同用户幂等；他用户 OwnershipConflict
 * - reject 规则；getPending / getApproved 过滤
 * - findByApiKey 恒时比较；findApprovedByNodeId；updateApprovedEndpoint
 * - ApprovedLimbPairingPersistence：Memory 后端 roundtrip + restore 校验
 *
 * @module @flowforge/limb-core/tests
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ApprovedLimbPairingPersistence,
  ApprovedLimbPairingRedisKeys,
  LimbPairingOwnershipConflictError,
  LimbPairingStore,
  MemoryApprovedLimbPairingPersistence,
  RedisApprovedLimbPairingPersistence,
  RedisHashLike,
} from '../src/limb-pairing-store.js';
import { DEFAULT_CAPABILITIES } from './helpers.ts';

const PARAMS = {
  nodeId: 'remote-cam-01',
  displayName: 'Remote Camera',
  platform: 'linux-arm64',
  endpointUrl: 'ws://limb-host:9000',
  capabilities: DEFAULT_CAPABILITIES,
};

describe('LimbPairingStore 创建与审批', () => {
  it('createRequest 生成 pending 请求并带 apiKey', () => {
    const store = new LimbPairingStore();
    const req = store.createRequest(PARAMS);

    expect(req.status).toBe('pending');
    expect(req.requestId).toBeTruthy();
    expect(req.apiKey).toBeTruthy();
    expect(req.createdAt).toBeGreaterThan(0);
    expect(req.decidedAt).toBeUndefined();
    expect(req.capabilities).toEqual(DEFAULT_CAPABILITIES);
  });

  it('同 nodeId 重复创建幂等返回同一请求', () => {
    const store = new LimbPairingStore();
    const first = store.createRequest(PARAMS);
    const second = store.createRequest(PARAMS);
    expect(second.requestId).toBe(first.requestId);
    expect(store.getPending()).toHaveLength(1);
  });

  it('approve 置 approved 并记录审批人与决定时间', async () => {
    const store = new LimbPairingStore();
    const req = store.createRequest(PARAMS);

    const approved = await store.approve(req.requestId, 'user-1');
    expect(approved?.status).toBe('approved');
    expect(approved?.approvedByUserId).toBe('user-1');
    expect(approved?.decidedAt).toBeGreaterThanOrEqual(req.createdAt);
    expect(store.getPending()).toHaveLength(0);
    expect(store.getApproved()).toHaveLength(1);
  });

  it('同用户重复 approve 幂等；他用户抛 OwnershipConflict', async () => {
    const store = new LimbPairingStore();
    const req = store.createRequest(PARAMS);
    await store.approve(req.requestId, 'user-1');

    const again = await store.approve(req.requestId, 'user-1');
    expect(again?.status).toBe('approved');

    await expect(store.approve(req.requestId, 'user-2')).rejects.toThrow(LimbPairingOwnershipConflictError);
  });

  it('approve 未知 requestId 返回 null；空用户抛 TypeError', async () => {
    const store = new LimbPairingStore();
    expect(await store.approve('missing', 'user-1')).toBeNull();
    const req = store.createRequest(PARAMS);
    await expect(store.approve(req.requestId, '')).rejects.toThrow(TypeError);
  });

  it('reject 置 rejected；已 rejected 幂等；已 approved 不可 reject', async () => {
    const store = new LimbPairingStore();
    const req = store.createRequest(PARAMS);
    expect(store.reject(req.requestId)).toBe(true);
    expect(store.get(req.requestId)?.status).toBe('rejected');
    // 已 rejected 再 reject 幂等返回 true（实现语义）
    expect(store.reject(req.requestId)).toBe(true);

    await store.approve(req.requestId, 'user-1');
    expect(store.reject(req.requestId)).toBe(false);
  });
});

describe('LimbPairingStore 查询', () => {
  it('findByApiKey 仅匹配 approved 且恒时比较', async () => {
    const store = new LimbPairingStore();
    const pending = store.createRequest(PARAMS);
    expect(store.findByApiKey(pending.apiKey)).toBeUndefined();

    const approved = await store.approve(pending.requestId, 'user-1');
    const found = store.findByApiKey(approved!.apiKey);
    expect(found?.nodeId).toBe(PARAMS.nodeId);

    expect(store.findByApiKey('wrong-key')).toBeUndefined();
    expect(store.findByApiKey('')).toBeUndefined();
  });

  it('findApprovedByNodeId 命中 approved 记录', async () => {
    const store = new LimbPairingStore();
    const req = store.createRequest(PARAMS);
    expect(store.findApprovedByNodeId(PARAMS.nodeId)).toBeUndefined();

    await store.approve(req.requestId, 'user-1');
    expect(store.findApprovedByNodeId(PARAMS.nodeId)?.requestId).toBe(req.requestId);
  });

  it('updateApprovedEndpoint 更新端点并持久化', async () => {
    const persistence = new MemoryApprovedLimbPairingPersistence();
    const store = new LimbPairingStore(persistence);
    const req = store.createRequest(PARAMS);
    await store.approve(req.requestId, 'user-1');

    const updated = await store.updateApprovedEndpoint(PARAMS.nodeId, 'ws://new-host:9000');
    expect(updated?.endpointUrl).toBe('ws://new-host:9000');

    const restored = await LimbPairingStore.restore(persistence);
    expect(restored.findApprovedByNodeId(PARAMS.nodeId)?.endpointUrl).toBe('ws://new-host:9000');
  });

  it('updateApprovedEndpoint 对 pending/未知节点返回 undefined', async () => {
    const store = new LimbPairingStore();
    store.createRequest(PARAMS);
    expect(await store.updateApprovedEndpoint(PARAMS.nodeId, 'ws://x')).toBeUndefined();
    expect(await store.updateApprovedEndpoint('missing', 'ws://x')).toBeUndefined();
  });
});

describe('ApprovedLimbPairingPersistence 持久化', () => {
  it('Memory 后端 put/list/remove roundtrip', async () => {
    const persistence = new MemoryApprovedLimbPairingPersistence();
    const store = new LimbPairingStore(persistence);
    const req = store.createRequest(PARAMS);
    const approved = await store.approve(req.requestId, 'user-1');
    expect(approved).not.toBeNull();

    const listed = await persistence.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe('approved');
    expect(listed[0]?.approvedByUserId).toBe('user-1');

    await persistence.remove(PARAMS.nodeId);
    expect(await persistence.list()).toHaveLength(0);
  });

  it('restore 从持久化恢复已批准配对', async () => {
    const persistence = new MemoryApprovedLimbPairingPersistence();
    const store = new LimbPairingStore(persistence);
    const req = store.createRequest(PARAMS);
    await store.approve(req.requestId, 'user-1');

    const restored = await LimbPairingStore.restore(persistence);
    expect(restored.getApproved()).toHaveLength(1);
    expect(restored.findByApiKey(store.get(req.requestId)?.apiKey ?? '')?.nodeId).toBe(PARAMS.nodeId);
  });

  it('restore 拒绝非法/重复的已批准记录', async () => {
    const persistence = new MemoryApprovedLimbPairingPersistence();
    const store = new LimbPairingStore(persistence);
    const req = store.createRequest(PARAMS);
    await store.approve(req.requestId, 'user-1');
    // 同 requestId 不同 nodeId：Memory 后端按 nodeId 键控，需换 nodeId 才能共存
    await persistence.put({ ...(await persistence.list())[0]!, nodeId: 'other-node' });

    await expect(LimbPairingStore.restore(persistence)).rejects.toThrow(/Duplicate/i);

    // 自定义 persistence 直出坏记录（绕过 put 校验），验证 restore 自身校验
    const bad: ApprovedLimbPairingPersistence = {
      async list() {
        return [{
          requestId: 'x',
          nodeId: 'n',
          displayName: 'd',
          platform: 'p',
          endpointUrl: 'e',
          capabilities: [],
          status: 'approved',
          createdAt: 1,
          decidedAt: 2,
          approvedByUserId: '',
          apiKey: 'k',
        }];
      },
      async put() {},
      async remove() {},
    };
    await expect(LimbPairingStore.restore(bad)).rejects.toThrow(TypeError);
  });

  it('Redis 后端 put/list/remove roundtrip + 键常量', async () => {
    const map = new Map<string, string>();
    const redis: RedisHashLike = {
      hvals: vi.fn(async (key) => [...map.values()].filter(() => key === ApprovedLimbPairingRedisKeys.approved)),
      hset: vi.fn(async (key, field, value) => {
        if (key === ApprovedLimbPairingRedisKeys.approved) map.set(field, value);
      }),
      hdel: vi.fn(async (key, field) => {
        if (key === ApprovedLimbPairingRedisKeys.approved) map.delete(field);
      }),
    };
    const persistence = new RedisApprovedLimbPairingPersistence(redis);
    const store = new LimbPairingStore(persistence);
    const req = store.createRequest(PARAMS);
    const approved = await store.approve(req.requestId, 'user-1');
    expect(approved?.status).toBe('approved');

    const listed = await persistence.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.nodeId).toBe(PARAMS.nodeId);

    // 独立持久化实例可 restore（模拟进程重启）
    const restored = await LimbPairingStore.restore(new RedisApprovedLimbPairingPersistence(redis));
    expect(restored.findApprovedByNodeId(PARAMS.nodeId)?.approvedByUserId).toBe('user-1');

    await persistence.remove(PARAMS.nodeId);
    expect(await persistence.list()).toHaveLength(0);
    expect(ApprovedLimbPairingRedisKeys.approved).toBe('limb:pairing:approved:v1');
  });

  it('Redis 后端拒绝非法记录（put 校验 + list 坏数据抛 TypeError）', async () => {
    const redis: RedisHashLike = {
      hvals: vi.fn(async () => ['not-json']),
      hset: vi.fn(async () => undefined),
      hdel: vi.fn(async () => undefined),
    };
    const persistence = new RedisApprovedLimbPairingPersistence(redis);
    await expect(persistence.list()).rejects.toThrow(TypeError);

    const store = new LimbPairingStore(persistence);
    const req = store.createRequest(PARAMS);
    // 绕过 store 直接写坏记录
    await expect(persistence.put({ ...req, status: 'pending' })).rejects.toThrow(TypeError);
  });
});
