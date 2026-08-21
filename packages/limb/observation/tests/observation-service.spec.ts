/**
 * ObservationService — T6.3 Cordis 插件挂载契约验证。
 *
 * 覆盖：
 * - `ctx.plugin(ObservationService)` 挂载 ctx.limbObservation 服务句柄
 * - route/deliver 代理委托；默认导出 Plugin 函数等价挂载
 * - 注入自定义 receiptStore / delivery / transcriptOptions
 * - 缺省注入（limbRegistry 未配置时出站投递返回错误）
 *
 * @module @flowforge/limb-observation/tests
 */

import { describe, expect, it, vi } from 'vitest';
import { Context } from '@flowforge/cordis';
import { MemoryLimbEmbodimentBindingStore } from '@flowforge/limb-embodiment';
import ObservationPlugin, { ObservationService } from '../src/index.ts';
import {
  LimbTranscriptObservation,
  MemoryLimbObservationReceiptStore,
} from '../src/limb-observation-router.js';
import { LimbTranscriptCatDelivery } from '../src/limb-transcript-cat-delivery.js';

const NOW = Date.parse('2026-08-01T09:15:00.000Z');

function makeBindingStore() {
  const store = new MemoryLimbEmbodimentBindingStore();
  return store;
}

function makeObservation(): LimbTranscriptObservation {
  return {
    v: 1,
    observationId: 'observation-1',
    nodeId: 'stackchan-home',
    occurredAt: new Date(NOW - 500).toISOString(),
    sessionId: 'session-1',
    kind: 'transcript',
    payload: { interactionId: 'interaction-1', text: '你好', language: 'zh', captureDurationMs: 5_000 },
  };
}

describe('ObservationService Cordis 插件挂载', () => {
  it('ctx.plugin(ObservationService) 挂载 ctx.limbObservation', async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(ObservationService, { bindingStore: makeBindingStore() });

    expect(ctx.limbObservation).toBeInstanceOf(ObservationService);
    expect(ctx.limbObservation.router).toBeTruthy();
    expect(ctx.limbObservation.outbound).toBeTruthy();
    expect(ctx.limbObservation.transcript).toBeInstanceOf(LimbTranscriptCatDelivery);
    await fiber.dispose();
  });

  it('默认导出 Plugin 函数等价挂载', async () => {
    const ctx = new Context();
    await ObservationPlugin(ctx, { bindingStore: makeBindingStore() });
    expect(ctx.limbObservation).toBeInstanceOf(ObservationService);
  });

  it('route 代理委托：unbound / routed', async () => {
    const bindingStore = makeBindingStore();
    const ctx = new Context();
    await ctx.plugin(ObservationService, {
      bindingStore,
      now: () => NOW,
      delivery: { deliverTranscript: async () => ({ messageId: 'message-1' }) },
    });

    await expect(ctx.limbObservation.route(makeObservation())).resolves.toEqual({ status: 'unbound' });

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
    await expect(ctx.limbObservation.route(makeObservation())).resolves.toEqual({
      status: 'routed',
      messageId: 'message-1',
    });
  });

  it('deliver 代理委托：未配置 limbRegistry 时返回失败', async () => {
    const bindingStore = makeBindingStore();
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
    const ctx = new Context();
    await ctx.plugin(ObservationService, {
      bindingStore,
      now: () => NOW,
      delivery: { deliverTranscript: async () => ({ messageId: 'message-1' }) },
    });

    // 缺省 limbRegistry → invoke 返回 refused 错误
    await expect(
      ctx.limbObservation.deliver('thread-stackchan', '回复', 'codex-sol', 'message-1'),
    ).rejects.toThrow('limbRegistry is not configured');
  });

  it('注入自定义 receiptStore 与 transcriptOptions', async () => {
    const bindingStore = makeBindingStore();
    const receiptStore = new MemoryLimbObservationReceiptStore();
    const isKnownCat = vi.fn(() => true);
    const append = vi.fn(async () => ({ id: 'message-1' }));
    const ctx = new Context();
    await ctx.plugin(ObservationService, {
      bindingStore,
      receiptStore,
      transcriptOptions: {
        isKnownCat,
        messageStore: { append },
        invokeTriggerProvider: { get: () => ({ trigger: async () => 'dispatched' as const }) },
      },
      now: () => NOW,
    });

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
    await ctx.limbObservation.route(makeObservation());

    expect(append).toHaveBeenCalledTimes(1);
    expect(isKnownCat).toHaveBeenCalledWith('codex-sol');
  });

  it('注入自定义 delivery（非 LimbTranscriptCatDelivery）时 transcript 回退缺省', async () => {
    const ctx = new Context();
    await ctx.plugin(ObservationService, {
      bindingStore: makeBindingStore(),
      delivery: { deliverTranscript: async () => ({ messageId: 'message-1' }) },
    });

    expect(ctx.limbObservation.transcript).toBeInstanceOf(LimbTranscriptCatDelivery);
  });
});
