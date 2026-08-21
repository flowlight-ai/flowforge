/**
 * LimbOutboundDeliveryHook — 群聊 → 物理四肢出站投递（T6.3）
 *
 * 本地化自 clowder-ai `src/domains/limb/LimbOutboundDeliveryHook.ts`（F126 Phase B）：
 * 将猫在群聊的回复内容投递到具身绑定节点：display（表情 scene）+ speaker（TTS 语音）
 * 两条 `physical_limb.execute` 指令。4096 code-point 上限；triggerMessageId 驱动的
 * 120s 去重（同 node/消息/内容不重复发声）。
 *
 * @module @flowforge/limb-observation/limb-outbound-delivery-hook
 */

import { createHash, randomUUID } from 'node:crypto';
import type { LimbInvocationContext, LimbInvokeResult } from '@flowforge/limb-core';
import type { LimbEmbodimentBinding, LimbEmbodimentBindingStore } from '@flowforge/limb-embodiment';

const ACTION_TIMEOUT_MS = 30_000;
const MAX_SPEECH_CODE_POINTS = 4_096;
const DELIVERY_DEDUPE_TTL_MS = 120_000;

interface DeliveryDedupeEntry {
  readonly expiresAt: number;
  readonly promise: Promise<void>;
}

export interface LimbOutboundDeliveryHookOptions {
  readonly bindingStore: LimbEmbodimentBindingStore;
  readonly limbRegistry: {
    invoke(
      nodeId: string,
      command: string,
      params: Record<string, unknown>,
      context?: LimbInvocationContext,
    ): Promise<LimbInvokeResult>;
  };
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class LimbOutboundDeliveryHook {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly recentDeliveries = new Map<string, DeliveryDedupeEntry>();

  constructor(private readonly options: LimbOutboundDeliveryHookOptions) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  async deliver(threadId: string, content: string, catId?: string, triggerMessageId?: string): Promise<void> {
    if (!catId || content.length === 0) return;
    if (Array.from(content).length > MAX_SPEECH_CODE_POINTS) {
      throw new Error('physical-limb speech exceeds the 4096 code-point contract bound');
    }

    const bindings = (await this.options.bindingStore.getByThread(threadId)).filter(
      (binding) => binding.catId === catId,
    );
    for (const binding of bindings) {
      if (!triggerMessageId) {
        await this.deliverToBinding(binding, threadId, content, catId);
        continue;
      }

      const now = this.now();
      this.pruneExpiredDeliveries(now);
      const dedupeKey = this.deliveryDedupeKey(binding.nodeId, triggerMessageId, catId, content);
      const existing = this.recentDeliveries.get(dedupeKey);
      if (existing && existing.expiresAt > now) {
        await existing.promise;
        continue;
      }

      const promise = this.deliverToBinding(binding, threadId, content, catId, triggerMessageId);
      const entry: DeliveryDedupeEntry = {
        expiresAt: now + DELIVERY_DEDUPE_TTL_MS,
        promise,
      };
      this.recentDeliveries.set(dedupeKey, entry);
      try {
        await promise;
      } catch (error) {
        if (this.recentDeliveries.get(dedupeKey) === entry) {
          this.recentDeliveries.delete(dedupeKey);
        }
        throw error;
      }
    }
  }

  private async deliverToBinding(
    binding: LimbEmbodimentBinding,
    threadId: string,
    content: string,
    catId: string,
    triggerMessageId?: string,
  ): Promise<void> {
    const now = this.now();
    const deadlineUnixMs = now + ACTION_TIMEOUT_MS;
    const sourceRef = triggerMessageId ?? `cat-reply:${catId}`;
    const context: LimbInvocationContext = {
      catId,
      userId: binding.userId,
      threadId,
      ...(triggerMessageId ? { userMessageId: triggerMessageId } : {}),
    };
    await this.invokeOrThrow(
      binding.nodeId,
      {
        v: 1,
        actionId: this.createId(),
        nodeId: binding.nodeId,
        deadlineUnixMs,
        timeoutMs: ACTION_TIMEOUT_MS,
        cancelToken: this.createId(),
        kind: 'display',
        payload: {
          expression: binding.expressionRef,
          // Phase B uses an explicit reply animation scene. It is not a
          // claim about the cat's hidden mood; Phase C adds cat_state refs.
          expressionSource: { kind: 'play', ref: sourceRef },
        },
      },
      context,
    );

    await this.invokeOrThrow(
      binding.nodeId,
      {
        v: 1,
        actionId: this.createId(),
        nodeId: binding.nodeId,
        deadlineUnixMs,
        timeoutMs: ACTION_TIMEOUT_MS,
        cancelToken: this.createId(),
        kind: 'speaker',
        payload: {
          text: content,
          voiceProfileRef: binding.voiceProfileRef,
          volumePercent: binding.volumePercent,
        },
      },
      context,
    );
  }

  private deliveryDedupeKey(nodeId: string, triggerMessageId: string, catId: string, content: string): string {
    const contentDigest = createHash('sha256').update(content).digest('hex');
    return `${nodeId}:${triggerMessageId}:${catId}:${contentDigest}`;
  }

  private pruneExpiredDeliveries(now: number): void {
    for (const [key, entry] of this.recentDeliveries) {
      if (entry.expiresAt <= now) this.recentDeliveries.delete(key);
    }
  }

  private async invokeOrThrow(
    nodeId: string,
    instruction: Record<string, unknown>,
    context: LimbInvocationContext,
  ): Promise<void> {
    const result = await this.options.limbRegistry.invoke(nodeId, 'physical_limb.execute', { instruction }, context);
    if (!result.success) {
      throw new Error(result.error ?? 'physical-limb action was refused');
    }
  }
}
