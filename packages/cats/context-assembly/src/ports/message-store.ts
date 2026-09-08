/**
 * Message store port (self-contained).
 *
 * Ported shape of clowder `stores/ports/MessageStore.ts`, bounded to the fields
 * the context-assembly domain consumes. `StoredMessage` / `StoredToolEvent` are
 * local契型; `IMessageStore` is the injectable read port satisfied in tests by
 * `MemoryMessageStore` and in EP2 by the cats-stores host implementation.
 */

import type {
  CatId,
  ConnectorSource,
  CrossThreadCoordination,
  MessageContent,
  RichMessageExtra,
} from '@flowforge/cats-shared';
import type { MessageBundleCarrierV1 } from '../contract/message-bundle.ts';

export interface StoredToolEvent {
  id: string;
  type: 'tool_use' | 'tool_result';
  label: string;
  detail?: string;
  timestamp: number;
  status?: 'ok' | 'error' | 'unknown';
  toolName?: string;
}

/** Minimal tie to queued-message custody for visibility gates (owner-bound). */
export interface QueueBodyExposure {
  targetCatId: string;
}

export interface QueuedMessageCustody {
  ownerUserId?: string;
  bodyExposures?: readonly QueueBodyExposure[];
}

export interface RichBlockExtraSubset {
  blocks: ReadonlyArray<import('@flowforge/cats-shared').RichBlock>;
}

export interface StoredMessage {
  id: string;
  threadId: string;
  userId: string;
  /** null = user message; CatId = cat message; 'system' = system-authored. */
  catId: CatId | null;
  content: string;
  contentBlocks?: readonly MessageContent[];
  toolEvents?: readonly StoredToolEvent[];
  timestamp: number;
  origin?: 'stream' | 'callback' | 'briefing' | 'queue_user' | 'cable' | 'scheduler' | string;
  deliveryStatus?: 'delivered' | 'queued' | 'canceled';
  /** Connector source metadata for external ingress. */
  source?: ConnectorSource;
  extra?: {
    rich?: RichMessageExtra;
    stream?: {
      invocationId?: string;
      turnInvocationId?: string;
      cliStdout?: string;
      speechContent?: string;
    };
    crossPost?: {
      sourceThreadId: string;
      sourceMessageId?: string;
      effectClass?: 'fyi' | 'coordinate' | 'investigate' | 'assign_work';
    };
    coordination?: CrossThreadCoordination;
    isExplicitPost?: boolean;
    scheduler?: { hiddenTrigger?: boolean };
  };
  replyTo?: string;
  deletedAt?: number;
  _tombstone?: boolean;
  recall?: { exposure?: 'none' | 'seen'; recalledAt?: number };
  isStreaming?: boolean;
  timelineOrderAt?: number;
  deliveredAt?: number;
  queueCustody?: QueuedMessageCustody;
  messageBundle?: MessageBundleCarrierV1;
  visibility?: 'public' | 'whisper';
  revealedAt?: number;
  whisperTo?: readonly CatId[];
  metadata?: Record<string, unknown>;
}

export interface ThreadMessageReadOptions {
  includeQueuedCatMessages?: boolean;
  includeQueuedUserMessages?: boolean;
  includeRecalledUserMessages?: boolean;
  includeExposedQueuedUserMessagesForCatId?: CatId;
}

export interface IMessageStore {
  getById(id: string): StoredMessage | null | Promise<StoredMessage | null>;
  getByThreadAfter(
    threadId: string,
    afterId?: string,
    limit?: number,
    viewerUserId?: string,
    options?: ThreadMessageReadOptions,
  ): StoredMessage[] | Promise<StoredMessage[]>;
}

/**
 * In-memory contract implementation used by vitest (real store, no mocks).
 * Adverse-case options documented per method; selection resolver uses
 * `getByThreadAfter` timeline snapshots exactly as the host would.
 */
export class MemoryMessageStore implements IMessageStore {
  private messages = new Map<string, StoredMessage>();

  constructor(seed: readonly StoredMessage[] = []) {
    for (const m of seed) this.messages.set(m.id, m);
  }

  getById(id: string): StoredMessage | null {
    return this.messages.get(id) ?? null;
  }

  getByThreadAfter(
    threadId: string,
    _afterId?: string,
    _limit?: number,
    _viewerUserId?: string,
    _options?: ThreadMessageReadOptions,
  ): StoredMessage[] {
    const sorted = [...this.messages.values()]
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    return sorted;
  }

  /** Test helper: upsert or overwrite a stored message. */
  put(msg: StoredMessage): void {
    this.messages.set(msg.id, msg);
  }

  clear(): void {
    this.messages.clear();
  }
}

/** CLI observable label semantics used by projection (kept for parity). */
export function isDelivered(msg: Pick<StoredMessage, 'deliveryStatus'>): boolean {
  return !msg.deliveryStatus || msg.deliveryStatus === 'delivered';
}