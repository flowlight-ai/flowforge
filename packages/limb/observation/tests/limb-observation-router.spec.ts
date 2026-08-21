/**
 * LimbObservationRouter — T6.3 四肢观察路由契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbObservationRouter.ts` 语义）：
 * - touch 反射-only；transcript 路由到绑定猫并返回 messageId
 * - receipt 去重（duplicate）；stale 时效校验；unbound 拒绝
 * - 投递失败释放 receipt（瞬时失败可重试不产生重复消息）
 * - RedisLimbObservationReceiptStore：set NX claim + del release
 *
 * @module @flowforge/limb-observation/tests
 */

import { describe, expect, it } from 'vitest';
import { MemoryLimbEmbodimentBindingStore } from '@flowforge/limb-embodiment';
import {
  LimbObservationRouterOptions,
  LimbTouchObservation,
  LimbTranscriptObservation,
  MemoryLimbObservationReceiptStore,
  RedisLimbObservationReceiptStore,
  createLimbObservationRouter,
} from '../src/limb-observation-router.js';

const NOW = Date.parse('2026-08-01T09:15:00.000Z');

function transcript(overrides: Partial<LimbTranscriptObservation> = {}): LimbTranscriptObservation {
  return {
    v: 1,
    observationId: 'observation-transcript-1',
    nodeId: 'stackchan-home',
    occurredAt: new Date(NOW - 500).toISOString(),
    sessionId: 'session-1',
    kind: 'transcript',
    payload: {
      interactionId: 'interaction-1',
      text: '大猫猫，你在吗？',
      language: 'zh',
      captureDurationMs: 5_000,
    },
    ...overrides,
  };
}

function touch(overrides: Partial<LimbTouchObservation> = {}): LimbTouchObservation {
  return {
    v: 1,
    observationId: 'observation-touch-1',
    nodeId: 'stackchan-home',
    occurredAt: new Date(NOW - 5_500).toISOString(),
    sessionId: 'session-1',
    kind: 'touch',
    payload: { gesture: 'stroke', durationMs: 780, confidence: 1 },
    ...overrides,
  };
}

async function createFixture(overrides: Partial<LimbObservationRouterOptions> = {}) {
  const bindingStore = new MemoryLimbEmbodimentBindingStore();
  await bindingStore.put({
    nodeId: 'stackchan-home',
    userId: 'default-user',
    threadId: 'thread-stackchan',
    catId: 'codex-sol',
    expressionRef: 'yanyan:replying',
    voiceProfileRef: 'yanyan:local',
    volumePercent: 35,
    updatedAt: NOW,
  });
  const delivered: Array<{ binding: unknown; observation: unknown }> = [];
  const router = createLimbObservationRouter({
    bindingStore,
    receiptStore: new MemoryLimbObservationReceiptStore(),
    now: () => NOW,
    delivery: {
      async deliverTranscript(input) {
        delivered.push(input);
        return { messageId: 'message-1' };
      },
    },
    ...overrides,
  });
  return { router, delivered };
}

describe('LimbObservationRouter 观察路由', () => {
  it('touch 反射-only，transcript 路由到绑定猫', async () => {
    const { router, delivered } = await createFixture();

    await expect(router.route(touch())).resolves.toEqual({ status: 'reflex_only' });
    expect(delivered).toHaveLength(0);

    await expect(router.route(transcript())).resolves.toEqual({ status: 'routed', messageId: 'message-1' });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.binding).toMatchObject({ catId: 'codex-sol', threadId: 'thread-stackchan' });
    expect(delivered[0]!.observation).toMatchObject({ payload: { text: '大猫猫，你在吗？' } });
  });

  it('同 observationId 重复上报判 duplicate 且不二次投递', async () => {
    const { router, delivered } = await createFixture();

    await expect(router.route(transcript())).resolves.toEqual({ status: 'routed', messageId: 'message-1' });
    await expect(router.route(transcript())).resolves.toEqual({ status: 'duplicate' });
    expect(delivered).toHaveLength(1);
  });

  it('stale：超出 maxAgeMs 或早于 maxFutureSkewMs 拒绝', async () => {
    const { router } = await createFixture();

    await expect(router.route(transcript({ occurredAt: new Date(NOW - 61_000).toISOString() }))).resolves.toEqual({
      status: 'stale',
    });
    await expect(router.route(transcript({ occurredAt: new Date(NOW + 10_000).toISOString() }))).resolves.toEqual({
      status: 'stale',
    });
  });

  it('unbound：无具身绑定的节点拒绝', async () => {
    const bindingStore = new MemoryLimbEmbodimentBindingStore();
    const router = createLimbObservationRouter({
      bindingStore,
      receiptStore: new MemoryLimbObservationReceiptStore(),
      now: () => NOW,
      delivery: { deliverTranscript: async () => ({ messageId: 'message-1' }) },
    });

    await expect(router.route(transcript())).resolves.toEqual({ status: 'unbound' });
  });

  it('投递失败释放 receipt，重试可再次路由', async () => {
    let attempt = 0;
    const { router, delivered } = await createFixture({
      delivery: {
        async deliverTranscript(input) {
          delivered.push(input);
          attempt += 1;
          if (attempt === 1) throw new Error('delivery backend down');
          return { messageId: 'message-2' };
        },
      },
    });

    await expect(router.route(transcript())).rejects.toThrow('delivery backend down');
    await expect(router.route(transcript())).resolves.toEqual({ status: 'routed', messageId: 'message-2' });
    expect(delivered).toHaveLength(2);
  });
});

describe('RedisLimbObservationReceiptStore', () => {
  it('set NX claim 幂等去重，del 释放后可重认领', async () => {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const redis = {
      async set(...args: unknown[]) {
        calls.push({ op: 'set', args });
        return 'OK';
      },
      async del(...args: unknown[]) {
        calls.push({ op: 'del', args });
        return 1;
      },
    };
    const store = new RedisLimbObservationReceiptStore(redis);

    await expect(store.claim('stackchan-home', 'observation-1')).resolves.toBe(true);
    await expect(store.release('stackchan-home', 'observation-1')).resolves.toBeUndefined();

    expect(calls.map((c) => c.op)).toEqual(['set', 'del']);
    expect(calls[0]!.args).toEqual(['limb:observation-receipt:stackchan-home:observation-1', '1', 'NX']);
    expect(calls[1]!.args).toEqual(['limb:observation-receipt:stackchan-home:observation-1']);
  });

  it('set NX 返回非 OK 视为重复 claim', async () => {
    const store = new RedisLimbObservationReceiptStore({
      async set() {
        return null;
      },
      async del() {
        return 1;
      },
    });

    await expect(store.claim('stackchan-home', 'observation-1')).resolves.toBe(false);
  });
});

describe('MemoryLimbObservationReceiptStore', () => {
  it('同 node+observationId 仅首次 claim 成功', async () => {
    const store = new MemoryLimbObservationReceiptStore();
    await expect(store.claim('node-a', 'obs-1')).resolves.toBe(true);
    await expect(store.claim('node-a', 'obs-1')).resolves.toBe(false);
    await store.release('node-a', 'obs-1');
    await expect(store.claim('node-a', 'obs-1')).resolves.toBe(true);
  });
});
