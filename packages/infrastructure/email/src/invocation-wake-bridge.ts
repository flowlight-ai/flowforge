/**
 * Invocation Wake Bridge — email 域 ↔ cats-invocation 队列的宿主接线桥。
 *
 * 批次51（C33 收尾）：批次39 交付的 `createConnectorInvokeTrigger` 把实际唤醒
 * 委托给注入的 `InvocationWakePort`；本模块提供该端口的默认实现——把唤醒请求
 * 适配为 invocation 队列的 `enqueue`（结构化端口，本包不直接依赖
 * cats-invocation，宿主组合根传入 `ctx.catsInvocationQueue` 或测试桩）。
 *
 * 结果语义映射（EnqueueOutcome → InvocationWakePort outcome）：
 *   - created / deduped → 'enqueued'（deduped 幂等重放视为已入队）
 *   - full             → 'full'（上层 ConnectorInvokeTrigger 再按 onFull 降级）
 */

import type { InvocationWakePort } from './connector-invoke-trigger.ts';

/** invocation 队列结构化端口（对齐 cats-invocation `InvocationQueueService.enqueue`）。 */
export interface InvocationQueueWakeSource {
  enqueue(input: {
    readonly threadId: string;
    readonly userId: string;
    readonly targetCatIds: readonly string[];
    readonly source: string;
    readonly sourceCategory?: string | undefined;
    readonly userMessageId?: string | undefined;
    readonly idempotencyKey?: string | undefined;
    readonly suggestedSkill?: string | undefined;
  }): {
    readonly outcome: 'created' | 'deduped' | 'full';
    readonly entry?: { readonly id: string } | undefined;
    readonly dedupedEntryId?: string | undefined;
  };
}

export interface InvocationWakeBridgeOptions {
  /** 队列入队幂等键前缀（缺省 'connector-callback'）。 */
  readonly idempotencyPrefix?: string | undefined;
}

/**
 * 把 invocation 队列适配为 `InvocationWakePort`（宿主接线默认实现）。
 * source 固定 'connector'（外部连接器回调来源），sourceCategory 由调用方
 * policy 传递或缺省 'conflict'（email TaskSpecs 的主要来源域）。
 */
export function createInvocationWakePort(
  queue: InvocationQueueWakeSource,
  opts: InvocationWakeBridgeOptions = {},
): InvocationWakePort {
  const prefix = opts.idempotencyPrefix ?? 'connector-callback';
  return {
    async trigger(input) {
      const result = queue.enqueue({
        threadId: input.threadId,
        userId: input.userId,
        targetCatIds: [input.catId],
        source: 'connector',
        sourceCategory: input.policy?.sourceCategory ?? 'conflict',
        userMessageId: input.messageId,
        idempotencyKey: `${prefix}:${input.messageId}`,
        ...(input.policy?.suggestedSkill !== undefined ? { suggestedSkill: input.policy.suggestedSkill } : {}),
      });
      if (result.outcome === 'full') {
        return { outcome: 'full' };
      }
      const invocationId =
        result.outcome === 'created' ? result.entry?.id : result.dedupedEntryId;
      return {
        outcome: 'enqueued',
        ...(invocationId !== undefined ? { invocationId } : {}),
      };
    },
  };
}
