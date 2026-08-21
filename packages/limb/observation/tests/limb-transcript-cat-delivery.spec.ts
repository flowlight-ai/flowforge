/**
 * LimbTranscriptCatDelivery — T6.3 四肢转录 → 群聊投递契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbTranscriptCatDelivery.ts` 语义）：
 * - 转录写入群聊消息（connector 源标注 + observationId 幂等键）+ 触发绑定猫
 * - unknown cat / 调用运行时未就绪：持久化前抛错
 * - 队列已满（outcome 'full'）抛错；socket 广播可选
 *
 * @module @flowforge/limb-observation/tests
 */

import { describe, expect, it } from 'vitest';
import type { LimbEmbodimentBinding } from '@flowforge/limb-embodiment';
import type { LimbTranscriptObservation } from '../src/limb-observation-router.js';
import { LimbTranscriptCatDelivery } from '../src/limb-transcript-cat-delivery.js';

const binding: LimbEmbodimentBinding = {
  nodeId: 'stackchan-home',
  userId: 'default-user',
  threadId: 'thread-stackchan',
  catId: 'codex-sol',
  expressionRef: 'yanyan:replying',
  voiceProfileRef: 'yanyan:local',
  volumePercent: 35,
  updatedAt: Date.parse('2026-08-01T09:10:00.000Z'),
};

const observation: LimbTranscriptObservation = {
  v: 1,
  observationId: 'observation-1',
  nodeId: 'stackchan-home',
  occurredAt: '2026-08-01T09:15:00.000Z',
  sessionId: 'session-1',
  kind: 'transcript',
  payload: {
    interactionId: 'interaction-1',
    text: '大猫猫，你在吗？',
    language: 'zh',
    captureDurationMs: 5_000,
  },
};

describe('LimbTranscriptCatDelivery 转录入群', () => {
  it('幂等落库 + 源标注 + 广播 + 触发绑定猫', async () => {
    const appended: unknown[] = [];
    const triggered: unknown[][] = [];
    const broadcast: unknown[][] = [];
    const delivery = new LimbTranscriptCatDelivery({
      isKnownCat: (catId) => catId === 'codex-sol',
      messageStore: {
        async append(input) {
          appended.push(input);
          return { id: 'message-1' };
        },
      },
      invokeTriggerProvider: {
        get() {
          return {
            async trigger(...args: unknown[]) {
              triggered.push(args);
              return 'dispatched' as const;
            },
          };
        },
      },
      socketManager: {
        broadcastToRoom(room, event, data) {
          broadcast.push([room, event, data]);
        },
      },
    });

    await expect(delivery.deliverTranscript({ binding, observation })).resolves.toEqual({
      messageId: 'message-1',
    });
    expect(appended).toHaveLength(1);
    const record = appended[0] as {
      idempotencyKey: string;
      content: string;
      mentions: string[];
      catId: null;
      source: { connector: string; meta: { interactionId: string; observationId: string } };
      timestamp: number;
    };
    expect(record.idempotencyKey).toBe('limb:stackchan-home:observation-1');
    expect(record.content).toBe('大猫猫，你在吗？');
    expect(record.mentions).toEqual(['codex-sol']);
    expect(record.catId).toBeNull();
    expect(record.source.connector).toBe('physical-limb.stackchan');
    expect(record.source.meta.interactionId).toBe('interaction-1');
    expect(record.source.meta.observationId).toBe('observation-1');
    expect(record.timestamp).toBe(Date.parse('2026-08-01T09:15:00.000Z'));
    expect(triggered).toEqual([['thread-stackchan', 'codex-sol', 'default-user', '大猫猫，你在吗？', 'message-1']]);
    expect(broadcast).toHaveLength(1);
    expect((broadcast[0] as [string, string])[0]).toBe('thread:thread-stackchan');
    expect((broadcast[0] as [string, string])[1]).toBe('connector_message');
  });

  it('unknown cat 或调用运行时未就绪：持久化前抛错', async () => {
    let appendCount = 0;
    const base = {
      messageStore: {
        async append() {
          appendCount += 1;
          return { id: 'message-1' };
        },
      },
    };

    const unknownCat = new LimbTranscriptCatDelivery({
      ...base,
      isKnownCat: () => false,
      invokeTriggerProvider: { get: () => ({ trigger: async () => 'dispatched' as const }) },
    });
    await expect(unknownCat.deliverTranscript({ binding, observation })).rejects.toThrow('unknown bound cat');

    const noRuntime = new LimbTranscriptCatDelivery({
      ...base,
      isKnownCat: () => true,
      invokeTriggerProvider: { get: () => undefined },
    });
    await expect(noRuntime.deliverTranscript({ binding, observation })).rejects.toThrow(
      'invocation runtime is not ready',
    );
    expect(appendCount).toBe(0);
  });

  it('猫调用队列已满（outcome full）抛错', async () => {
    const delivery = new LimbTranscriptCatDelivery({
      isKnownCat: () => true,
      messageStore: { append: async () => ({ id: 'message-1' }) },
      invokeTriggerProvider: {
        get: () => ({ trigger: async () => 'full' as const }),
      },
    });

    await expect(delivery.deliverTranscript({ binding, observation })).rejects.toThrow('queue is full');
  });
});
