/**
 * Connector 消息投递端口 + deliverConnectorMessage（C33）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/deliver-connector-message.ts`：
 * 消息经 messageStore.append 落库（catId 进 mentions）→ socket 广播
 * `thread:{threadId}` room 的 `connector_message` 事件。
 *
 * 插件化改造：clowder `IMessageStore`（具体端口）→ 注入式 `MessageAppender`
 * 端口（append 返回 { id, timestamp }）；socketManager 可选注入。
 */

import type { CatId, ConnectorSource } from '@flowforge/cats-shared';

/** messageStore.append 端口（cats MessageStore 的子集）。 */
export interface MessageAppender {
  append(input: {
    threadId: string;
    userId: string;
    catId: string | null;
    content: string;
    source: ConnectorSource;
    mentions: readonly CatId[];
    timestamp: number;
    extra?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<{ id: string; timestamp: number }>;
}

export interface SocketBroadcaster {
  broadcastToRoom(room: string, event: string, data: unknown): void;
}

export interface ConnectorDeliveryDeps {
  readonly messageStore: MessageAppender;
  readonly socketManager?: SocketBroadcaster;
}

export interface ConnectorDeliveryInput {
  readonly threadId: string;
  readonly userId: string;
  readonly catId: string;
  readonly content: string;
  readonly source: ConnectorSource;
  readonly extra?: Record<string, unknown>;
  /** Stable MessageStore key for crash-safe connector delivery retries. */
  readonly idempotencyKey?: string;
}

export interface ConnectorDeliveryResult {
  readonly messageId: string;
  readonly content: string;
}

export async function deliverConnectorMessage(
  deps: ConnectorDeliveryDeps,
  input: ConnectorDeliveryInput,
): Promise<ConnectorDeliveryResult> {
  const stored = await deps.messageStore.append({
    threadId: input.threadId,
    userId: input.userId,
    catId: null,
    content: input.content,
    source: input.source,
    mentions: [input.catId as CatId],
    timestamp: Date.now(),
    ...(input.extra ? { extra: input.extra } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });

  deps.socketManager?.broadcastToRoom(`thread:${input.threadId}`, 'connector_message', {
    threadId: input.threadId,
    message: {
      id: stored.id,
      type: 'connector',
      content: input.content,
      source: input.source,
      timestamp: stored.timestamp,
    },
  });

  return { messageId: stored.id, content: input.content };
}
