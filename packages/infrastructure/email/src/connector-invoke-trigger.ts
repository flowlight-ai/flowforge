/**
 * Connector Invoke Trigger — 消息投递后编程触发 cat 调用的适配层。
 *
 * clowder `ConnectorInvokeTrigger`（1381 行）深耦合 cats AgentRouter/
 * InvocationQueue/QueuedMessageCustodyCoordinator 等 invocation 栈。按
 * 「注入式端口」边界：本模块实现 `InvokeTriggerPort` 契约，将实际唤醒委托
 * 给注入的 invocation 端口（宿主在 cats invocation 域落地后接线，例如
 * `ctx.catsInvocation` / AgentRouter）。
 */

import type { InvokeTriggerPort, ConnectorTriggerPolicy } from './conflict-check-task-spec.ts';

/** cats invocation 唤醒端口（宿主接线 AgentRouter/InvocationQueue）。 */
export interface InvocationWakePort {
  trigger(input: {
    threadId: string;
    catId: string;
    userId: string;
    message: string;
    messageId: string;
    policy?: ConnectorTriggerPolicy;
  }): Promise<{ outcome: 'dispatched' | 'enqueued' | 'full'; invocationId?: string }>;
}

export interface ConnectorInvokeTriggerOptions {
  /** cats invocation 唤醒端口（必填；宿主接线）。 */
  wake: InvocationWakePort;
  /** 队列满时的降级策略。 */
  onFull?: (input: { threadId: string; catId: string }) => 'drop' | 'retry';
}

/**
 * 创建 InvokeTriggerPort 适配器（TriggerOutcome 语义：
 * dispatched=直接执行 / enqueued=入队 / full=队列满）。
 */
export function createConnectorInvokeTrigger(opts: ConnectorInvokeTriggerOptions): InvokeTriggerPort {
  return {
    async trigger(threadId, catId, userId, message, messageId, _contentBlocks, policy) {
      const result = await opts.wake.trigger({
        threadId,
        catId,
        userId,
        message,
        messageId,
        ...(policy ? { policy } : {}),
      });
      if (result.outcome === 'full') {
        const action = opts.onFull?.({ threadId, catId }) ?? 'retry';
        if (action === 'drop') return 'full';
      }
      return result.outcome;
    },
  };
}

export type { InvokeTriggerPort };
