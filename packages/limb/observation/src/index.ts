/**
 * @flowforge/limb-observation — 阶段6 T6.3 四肢观察域 Cordis 插件
 *
 * 挂载 `ctx.limbObservation`：LimbObservationRouter（观察路由：stale/unbound/
 * duplicate/reflex_only/routed）、LimbOutboundDeliveryHook（群聊 → 四肢出站
 * display+speaker 投递）、LimbTranscriptCatDelivery（转录 → 群聊消息）。
 * 组合根注入 bindingStore / receiptStore / delivery / limbRegistry 等依赖。
 */

import { Context, Service } from '@flowforge/cordis';
import type { LimbRegistry } from '@flowforge/limb-core';
import type { LimbEmbodimentBindingStore } from '@flowforge/limb-embodiment';
import { LimbOutboundDeliveryHook } from './limb-outbound-delivery-hook.js';
import {
  createLimbObservationRouter,
  LimbObservationReceiptStore,
  LimbObservationRouter,
  LimbTranscriptDelivery,
  MemoryLimbObservationReceiptStore,
} from './limb-observation-router.js';
import { LimbTranscriptCatDelivery } from './limb-transcript-cat-delivery.js';

export {
  LimbObservation,
  LimbObservationReceiptStore,
  LimbObservationRouteResult,
  LimbObservationRouter,
  LimbObservationRouterOptions,
  LimbTouchObservation,
  LimbTranscriptDelivery,
  LimbTranscriptObservation,
  MemoryLimbObservationReceiptStore,
  RedisLimbObservationReceiptStore,
  RedisSetLike,
  createLimbObservationRouter,
} from './limb-observation-router.js';
export { LimbOutboundDeliveryHook, LimbOutboundDeliveryHookOptions } from './limb-outbound-delivery-hook.js';
export { LimbTranscriptCatDelivery, LimbTranscriptCatDeliveryOptions } from './limb-transcript-cat-delivery.js';

export interface ObservationServiceOptions {
  /** 具身绑定存储（必填：路由与出站投递共用） */
  readonly bindingStore: LimbEmbodimentBindingStore;
  /** 观察回执存储（缺省 Memory；组合根注入 Redis 后端） */
  readonly receiptStore?: LimbObservationReceiptStore | undefined;
  /** 转录投递目标（缺省 LimbTranscriptCatDelivery 需注入 messageStore） */
  readonly delivery?: LimbTranscriptDelivery | undefined;
  /** 四肢注册表（出站投递经 registry.invoke 执行 physical_limb.execute） */
  readonly limbRegistry?: LimbRegistry | undefined;
  /** 转录投递的猫调用运行时（LimbTranscriptCatDelivery 选项透传） */
  readonly transcriptOptions?: Pick<
    ConstructorParameters<typeof LimbTranscriptCatDelivery>[0],
    'isKnownCat' | 'messageStore' | 'invokeTriggerProvider' | 'socketManager'
  >;
  readonly now?: () => number;
  readonly maxAgeMs?: number;
  readonly maxFutureSkewMs?: number;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 四肢观察域：观察路由 + 出站投递 + 转录入群 */
    limbObservation: ObservationService;
  }
}

export class ObservationService extends Service {
  /** 观察路由（stale/unbound/duplicate/reflex_only/routed） */
  readonly router: LimbObservationRouter;
  /** 群聊 → 四肢出站投递 hook */
  readonly outbound: LimbOutboundDeliveryHook;
  /** 转录 → 群聊投递实现 */
  readonly transcript: LimbTranscriptCatDelivery;

  constructor(ctx: Context, options: ObservationServiceOptions) {
    super(ctx, 'limbObservation');
    const receiptStore = options.receiptStore ?? new MemoryLimbObservationReceiptStore();
    const transcriptOptions = options.transcriptOptions;
    const defaultTranscript = new LimbTranscriptCatDelivery({
      isKnownCat: transcriptOptions?.isKnownCat ?? (() => true),
      messageStore: transcriptOptions?.messageStore ?? {
        append: async () => {
          throw new Error('messageStore is not configured');
        },
      },
      invokeTriggerProvider: transcriptOptions?.invokeTriggerProvider ?? {
        get: () => undefined,
      },
      ...(transcriptOptions?.socketManager ? { socketManager: transcriptOptions.socketManager } : {}),
    });
    const delivery = options.delivery ?? defaultTranscript;
    this.transcript = options.delivery instanceof LimbTranscriptCatDelivery ? options.delivery : defaultTranscript;
    this.router = createLimbObservationRouter({
      bindingStore: options.bindingStore,
      receiptStore,
      delivery,
      ...(options.now ? { now: options.now } : {}),
      ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {}),
      ...(options.maxFutureSkewMs !== undefined ? { maxFutureSkewMs: options.maxFutureSkewMs } : {}),
    });
    this.outbound = new LimbOutboundDeliveryHook({
      bindingStore: options.bindingStore,
      limbRegistry: {
        invoke: (nodeId, command, params, context) =>
          options.limbRegistry
            ? options.limbRegistry.invoke(nodeId, command, params, context)
            : Promise.resolve({ success: false, error: 'limbRegistry is not configured' }),
      },
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /** 路由一条观察（touch/transcript） */
  route(observation: Parameters<LimbObservationRouter['route']>[0]): ReturnType<LimbObservationRouter['route']> {
    return this.router.route(observation);
  }

  /** 出站投递猫回复到绑定四肢（display + speaker） */
  deliver(threadId: string, content: string, catId?: string, triggerMessageId?: string): Promise<void> {
    return this.outbound.deliver(threadId, content, catId, triggerMessageId);
  }
}

export default function Plugin(ctx: Context, options: ObservationServiceOptions) {
  return ctx.plugin(ObservationService, options);
}
