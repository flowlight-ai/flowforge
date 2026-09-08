/**
 * Message selection results (self-contained port of clowder
 * `message-selection-results.ts`).
 */

import type { RichBlock } from '@flowforge/cats-shared';
import type { StoredMessage } from '../ports/message-store.ts';
import type {
  MessageSelectionAuthor,
  MessageSelectionTombstone,
  MessageSelectionTombstoneReason,
  ResolvedMessageSelectionItem,
} from './message-selection-types.ts';

function authorFor(message: StoredMessage): MessageSelectionAuthor {
  return message.catId === null ? { kind: 'user', userId: message.userId } : { kind: 'cat', catId: message.catId };
}

export function tombstone(messageId: string, reason: MessageSelectionTombstoneReason): MessageSelectionTombstone {
  return { status: 'tombstone', messageId, reason };
}

export function projectedItem(
  message: StoredMessage,
  item: { kind: ResolvedMessageSelectionItem['kind']; comment?: string | undefined },
  readableContent: string,
  richBlock?: RichBlock,
): ResolvedMessageSelectionItem {
  return {
    status: 'available',
    kind: item.kind,
    messageId: message.id,
    sourceThreadId: message.threadId,
    author: authorFor(message),
    timestamp: message.timestamp,
    readableContent,
    ...(item.comment ? { comment: item.comment } : {}),
    ...(richBlock ? { richBlock } : {}),
  };
}