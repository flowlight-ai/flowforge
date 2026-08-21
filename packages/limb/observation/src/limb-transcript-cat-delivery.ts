/**
 * LimbTranscriptCatDelivery — 四肢转录 → 群聊投递（T6.3）
 *
 * 本地化自 clowder-ai `src/domains/limb/LimbTranscriptCatDelivery.ts`（F126 Phase C）：
 * 将四肢转录观察写入群聊消息（connector 源标注 + 幂等键）+ socket 广播 +
 * 触发绑定猫的调用。observationId 即持久化幂等键（配合 Router 的 receipt）。
 *
 * @module @flowforge/limb-observation/limb-transcript-cat-delivery
 */

import type { ConnectorSource } from '@flowforge/cats-shared';
import type { LimbTranscriptDelivery, LimbTranscriptObservation } from './limb-observation-router.js';

type TriggerOutcome = 'dispatched' | 'enqueued' | 'full';

export interface LimbTranscriptCatDeliveryOptions {
  readonly isKnownCat: (catId: string) => boolean;
  /** 群聊消息存储（对接 chat/cats-stores 实现） */
  readonly messageStore: {
    append(input: {
      readonly threadId: string;
      readonly userId: string;
      readonly catId: null;
      readonly content: string;
      readonly source: ConnectorSource;
      readonly mentions: readonly string[];
      readonly timestamp: number;
      readonly idempotencyKey: string;
    }): Promise<{ readonly id: string }> | { readonly id: string };
  };
  /** 猫调用运行时提供者（组合根注入；未就绪抛错） */
  readonly invokeTriggerProvider: {
    get():
      | {
          trigger(
            threadId: string,
            catId: string,
            userId: string,
            message: string,
            messageId: string,
          ): Promise<TriggerOutcome>;
        }
      | undefined;
  };
  /** 实时广播（可选，未注入则仅落库） */
  readonly socketManager?: {
    broadcastToRoom(room: string, event: string, data: unknown): void;
  };
}

const STACKCHAN_SOURCE: ConnectorSource = {
  connector: 'physical-limb.stackchan',
  label: 'StackChan',
  icon: 'robot',
};

export class LimbTranscriptCatDelivery implements LimbTranscriptDelivery {
  constructor(private readonly options: LimbTranscriptCatDeliveryOptions) {}

  async deliverTranscript(
    input: Parameters<LimbTranscriptDelivery['deliverTranscript']>[0],
  ): Promise<{ readonly messageId: string }> {
    if (!this.options.isKnownCat(input.binding.catId)) {
      throw new Error(`unknown bound cat: ${input.binding.catId}`);
    }
    const trigger = this.options.invokeTriggerProvider.get();
    if (!trigger) {
      throw new Error('cat invocation runtime is not ready');
    }

    const catId = input.binding.catId;
    const observation: LimbTranscriptObservation = input.observation;
    const timestamp = Date.parse(observation.occurredAt);
    const source: ConnectorSource = {
      ...STACKCHAN_SOURCE,
      meta: {
        nodeId: observation.nodeId,
        observationId: observation.observationId,
        interactionId: observation.payload.interactionId,
        sessionId: observation.sessionId,
        language: observation.payload.language,
        captureDurationMs: observation.payload.captureDurationMs,
        rawMediaTransferred: false,
      },
    };
    const stored = await this.options.messageStore.append({
      threadId: input.binding.threadId,
      userId: input.binding.userId,
      catId: null,
      content: observation.payload.text,
      source,
      mentions: [catId],
      timestamp,
      idempotencyKey: `limb:${observation.nodeId}:${observation.observationId}`,
    });

    this.options.socketManager?.broadcastToRoom(`thread:${input.binding.threadId}`, 'connector_message', {
      threadId: input.binding.threadId,
      message: {
        id: stored.id,
        type: 'connector',
        content: observation.payload.text,
        source,
        timestamp,
      },
    });

    const outcome = await trigger.trigger(
      input.binding.threadId,
      catId,
      input.binding.userId,
      observation.payload.text,
      stored.id,
    );
    if (outcome === 'full') {
      throw new Error('cat invocation queue is full');
    }
    return { messageId: stored.id };
  }
}
