/**
 * @flowforge/cats-feat-trajectory — cross-post-collector（C26 CrossPostCollector，F233）。
 *
 * TS 移植自 clowder-ai `domains/feat-trajectory/CrossPostCollector.ts`：
 *   - 扫描带 cross-post 元数据的消息 → `thread_merge` trajectory snapshots
 *   - 每条 cross-post 消息代表跨线程信息流——叙事泳道上的 "merge" 边
 *   - collector 模式：纯数据提取，无投影逻辑；IO 接口注入（messageStore /
 *     featIndex），宿主提供 Real 实现
 *
 * @module @flowforge/cats-feat-trajectory/cross-post-collector
 */

import { isCrossThreadProvenance } from '@flowforge/cats-shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossPostSnapshot {
  kind: 'thread_merge';
  messageId: string;
  sourceThreadId: string;
  targetThreadId: string;
  catId: string;
  featId: string;
  postedAt: number;
}

/** Minimal message shape needed by this collector. */
interface CrossPostMessageLike {
  id: string;
  threadId: string;
  catId: string | null;
  timestamp: number;
  deliveryStatus?: 'queued' | 'delivered' | 'canceled';
  extra?: {
    crossPost?: {
      sourceThreadId: string;
    };
  };
}

/** Store interface — lists messages that have cross-post metadata. */
export interface IMessageStoreForCrossPost {
  listCrossPostMessages(): Promise<CrossPostMessageLike[]>;
}

/** Feat index lookup — maps threadId to featId. */
export interface IFeatIndexForCrossPost {
  lookupByThreadId(threadId: string): Promise<string | null>;
}

export interface CrossPostCollectorOptions {
  readonly messageStore: IMessageStoreForCrossPost;
  readonly featIndex: IFeatIndexForCrossPost;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export class CrossPostCollector {
  private readonly messageStore: IMessageStoreForCrossPost;
  private readonly featIndex: IFeatIndexForCrossPost;

  constructor(opts: CrossPostCollectorOptions) {
    this.messageStore = opts.messageStore;
    this.featIndex = opts.featIndex;
  }

  async collectAll(): Promise<CrossPostSnapshot[]> {
    const messages = await this.messageStore.listCrossPostMessages();
    const results: CrossPostSnapshot[] = [];

    for (const msg of messages) {
      // Skip undelivered messages — queued/canceled cross-posts haven't
      // reached the target thread and shouldn't produce trajectory edges.
      if (msg.deliveryStatus === 'queued' || msg.deliveryStatus === 'canceled') continue;

      // Must have cross-post metadata with sourceThreadId
      const sourceThreadId = msg.extra?.crossPost?.sourceThreadId;
      if (!isCrossThreadProvenance(sourceThreadId, msg.threadId)) continue;

      // Look up feat association — try source thread first, fall back to target
      let featId = await this.featIndex.lookupByThreadId(sourceThreadId);
      if (!featId) {
        featId = await this.featIndex.lookupByThreadId(msg.threadId);
      }
      if (!featId) continue; // No feature association on either side — skip

      results.push({
        kind: 'thread_merge',
        messageId: msg.id,
        sourceThreadId,
        targetThreadId: msg.threadId,
        catId: msg.catId ?? 'unknown',
        featId,
        postedAt: msg.timestamp,
      });
    }

    return results;
  }
}
