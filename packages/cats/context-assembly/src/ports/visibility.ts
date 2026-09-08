/**
 * Message visibility predicates (self-contained port of clowder
 * `stores/visibility.ts`). F35 Whisper + system-user exemption + managed-hold
 * connector gates, bounded to the predicates the context-assembly domain needs.
 *
 * `isSelectableManagedHoldConnectorSource` is rebuilt locally (clowder
 * `@cat-cafe/shared/types/connector.ts`) so nothing here imports clowder internals.
 */

import type { CatId, ConnectorSource } from '@flowforge/cats-shared';
import type { StoredMessage, ThreadMessageReadOptions } from './message-store.ts';

const SYSTEM_USER_IDS: ReadonlySet<string> = new Set(['scheduler', 'system']);

export function isSystemUserMessage(msg: Pick<StoredMessage, 'userId' | 'catId'>): boolean {
  return SYSTEM_USER_IDS.has(msg.userId) && (msg.catId === 'system' || msg.catId === null);
}

function isDeliveredMessage(message: StoredMessage): boolean {
  return !message.deliveryStatus || message.deliveryStatus === 'delivered';
}

function isRealCatSpeech(message: StoredMessage): boolean {
  return (
    message.catId !== null &&
    message.catId !== 'system' &&
    message.userId !== 'system' &&
    message.userId !== 'scheduler' &&
    message.origin !== 'briefing'
  );
}

export function isTimelinePublished(msg: StoredMessage): boolean {
  if (!msg.deliveryStatus || msg.deliveryStatus === 'delivered') return true;
  return msg.deliveryStatus === 'queued' && isRealCatSpeech(msg);
}

/**
 * Rebuilt local predicate: a connector source is selectable as a managed-hold
 * carrier only when it carries a complete, wake-eligible task anchor.
 */
export function isSelectableManagedHoldConnectorSource(
  source: Pick<ConnectorSource, 'connector' | 'meta'> | null | undefined,
): boolean {
  const meta = source?.meta as Record<string, unknown> | undefined;
  return Boolean(
    source?.connector === 'hold-ball' &&
      meta?.wakeWhen === true &&
      typeof meta.taskId === 'string' &&
      meta.taskId.trim().length > 0 &&
      typeof meta.threadId === 'string' &&
      meta.threadId.trim().length > 0 &&
      typeof meta.catId === 'string' &&
      meta.catId.trim().length > 0,
  );
}

type ManagedHoldConnectorVisibilityMessage = Pick<
  StoredMessage,
  'userId' | 'catId' | 'threadId' | 'source' | 'extra' | 'queueCustody'
>;

export function isManagedHoldConnectorMessage(msg: ManagedHoldConnectorVisibilityMessage): boolean {
  return msg.userId === 'scheduler' && msg.catId === null && msg.source?.connector === 'hold-ball';
}

export function isOwnerVisibleManagedHoldConnector(
  msg: ManagedHoldConnectorVisibilityMessage,
  viewerUserId?: string,
): boolean {
  return (
    typeof viewerUserId === 'string' &&
    viewerUserId.length > 0 &&
    isManagedHoldConnectorMessage(msg) &&
    msg.extra?.scheduler?.hiddenTrigger !== true &&
    msg.queueCustody?.ownerUserId === viewerUserId &&
    isSelectableManagedHoldConnectorSource(msg.source) &&
    (msg.source?.meta as Record<string, unknown> | undefined)?.threadId === msg.threadId
  );
}

export function isOwnerVisibleQueuedManagedHoldConnector(msg: StoredMessage, viewerUserId?: string): boolean {
  return msg.deliveryStatus === 'queued' && isOwnerVisibleManagedHoldConnector(msg, viewerUserId);
}

export function isQueuedCatTimelineMessage(message: StoredMessage): boolean {
  return message.deliveryStatus === 'queued' && isRealCatSpeech(message);
}

function isQueuedUserTimelineMessage(message: StoredMessage): boolean {
  if (
    message.deliveryStatus !== 'queued' ||
    message.catId !== null ||
    message.source !== undefined ||
    message.userId === 'system' ||
    message.userId === 'scheduler' ||
    message.origin === 'briefing'
  ) {
    return false;
  }
  return message.queueCustody !== undefined;
}

function isQueuedOwnerConnectorTimelineMessage(message: StoredMessage): boolean {
  return (
    message.deliveryStatus === 'queued' &&
    message.catId === null &&
    message.source !== undefined &&
    message.userId !== 'system' &&
    message.userId !== 'scheduler' &&
    message.origin !== 'briefing' &&
    message.queueCustody !== undefined
  );
}

function isOwnerVisibleRecalledUserMessage(message: StoredMessage): boolean {
  return (
    message.deliveryStatus === 'canceled' &&
    message.catId === null &&
    message._tombstone === true &&
    message.recall?.exposure === 'seen'
  );
}

export function hasDurableQueueBodyExposure(msg: StoredMessage, catId: string): boolean {
  return (
    msg.deliveryStatus === 'queued' &&
    msg.catId === null &&
    (msg.queueCustody?.bodyExposures ?? []).some((exposure) => exposure.targetCatId === catId)
  );
}

export function isDurablyReadableByCat(msg: StoredMessage, catId: string): boolean {
  return isTimelinePublished(msg) || hasDurableQueueBodyExposure(msg, catId);
}

export function passesManagedHoldViewerBoundary(
  msg: ManagedHoldConnectorVisibilityMessage,
  viewerUserId?: string,
): boolean {
  return (
    viewerUserId === undefined ||
    !isManagedHoldConnectorMessage(msg) ||
    isOwnerVisibleManagedHoldConnector(msg, viewerUserId)
  );
}

export function resolveThreadMessageVisibility(
  options?: ThreadMessageReadOptions,
  viewerUserId?: string,
): (message: StoredMessage) => boolean {
  return (message) => {
    if (!passesManagedHoldViewerBoundary(message, viewerUserId)) return false;
    if (viewerUserId !== undefined && isManagedHoldConnectorMessage(message)) {
      return (
        isDeliveredMessage(message) ||
        (options?.includeQueuedUserMessages === true && message.deliveryStatus === 'queued')
      );
    }
    return (
      isDeliveredMessage(message) ||
      (options?.includeQueuedCatMessages === true && isQueuedCatTimelineMessage(message)) ||
      (options?.includeQueuedUserMessages === true &&
        (isQueuedUserTimelineMessage(message) || isQueuedOwnerConnectorTimelineMessage(message))) ||
      (options?.includeExposedQueuedUserMessagesForCatId !== undefined &&
        hasDurableQueueBodyExposure(message, options.includeExposedQueuedUserMessagesForCatId)) ||
      (options?.includeRecalledUserMessages === true && isOwnerVisibleRecalledUserMessage(message))
    );
  };
}

/** Match the Redis timeline score when constructing pagination cursors in memory. */
export function getTimelineOrderTime(message: StoredMessage): number {
  if (message.timelineOrderAt !== undefined) return message.timelineOrderAt;
  if (
    isQueuedCatTimelineMessage(message) ||
    isQueuedUserTimelineMessage(message) ||
    isQueuedOwnerConnectorTimelineMessage(message)
  ) {
    return message.timestamp;
  }
  return message.deliveredAt ?? message.timestamp;
}

/** Who is viewing */
export type Viewer = { readonly type: 'user' } | { readonly type: 'cat'; readonly catId: string };

export function canViewMessage(msg: StoredMessage, viewer: Viewer): boolean {
  if (viewer.type === 'user') return true;
  if (!msg.visibility || msg.visibility === 'public') return true;
  if (msg.visibility === 'whisper') {
    if (msg.revealedAt) return true;
    return msg.whisperTo?.some((c) => c === (viewer.catId as CatId)) ?? false;
  }
  return false;
}