/**
 * C26 CrossPostCollector + ThreadSplitCollector 测试（F233，clowder collectors 直译）。
 *
 * 覆盖：
 *  - CrossPostCollector：queued/canceled skip、无 sourceThreadId skip、无 featId
 *    skip、source→target 回退查找、正常 emit thread_merge
 *  - ThreadSplitCollector：非 approved skip、无 createdThreadId skip、无 featId
 *    skip、splitAt = approvedAt ?? createdAt、正常 emit thread_split
 */

import { describe, expect, it, vi } from 'vitest';
import { CrossPostCollector } from '../src/cross-post-collector.js';
import type { IMessageStoreForCrossPost } from '../src/cross-post-collector.js';
import { ThreadSplitCollector } from '../src/thread-split-collector.js';
import type { IProposalStoreForSplit } from '../src/thread-split-collector.js';

const T0 = 1_700_000_000_000;

// ─── CrossPostCollector ────────────────────────────────────────────────────

describe('C26 CrossPostCollector：cross-thread 消息 → thread_merge', () => {
  function messageStore(messages: Array<Record<string, unknown>>): IMessageStoreForCrossPost {
    return {
      listCrossPostMessages: vi.fn(async () => messages as never),
    };
  }

  it('正常 cross-post 消息 → thread_merge snapshot（catId 缺省 unknown）', async () => {
    const collector = new CrossPostCollector({
      messageStore: messageStore([
        {
          id: 'msg-1',
          threadId: 't-dst',
          catId: 'cat-a',
          timestamp: T0,
          deliveryStatus: 'delivered',
          extra: { crossPost: { sourceThreadId: 't-src' } },
        },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async (tid) => (tid === 't-src' ? 'F233' : null)) },
    });
    const snaps = await collector.collectAll();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual({
      kind: 'thread_merge',
      messageId: 'msg-1',
      sourceThreadId: 't-src',
      targetThreadId: 't-dst',
      catId: 'cat-a',
      featId: 'F233',
      postedAt: T0,
    });
  });

  it('queued/canceled → skip（未送达不产生轨迹边）', async () => {
    const collector = new CrossPostCollector({
      messageStore: messageStore([
        { id: 'q', threadId: 't', catId: null, timestamp: T0, deliveryStatus: 'queued', extra: { crossPost: { sourceThreadId: 's' } } },
        { id: 'c', threadId: 't', catId: null, timestamp: T0, deliveryStatus: 'canceled', extra: { crossPost: { sourceThreadId: 's' } } },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    expect(await collector.collectAll()).toHaveLength(0);
  });

  it('无 sourceThreadId / 无 crossPost 元数据 → skip', async () => {
    const collector = new CrossPostCollector({
      messageStore: messageStore([
        { id: 'm1', threadId: 't', catId: null, timestamp: T0, deliveryStatus: 'delivered' },
        { id: 'm2', threadId: 't', catId: null, timestamp: T0, deliveryStatus: 'delivered', extra: {} },
        { id: 'm3', threadId: 't', catId: null, timestamp: T0, deliveryStatus: 'delivered', extra: { crossPost: {} } },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    expect(await collector.collectAll()).toHaveLength(0);
  });

  it('两侧都无 feat 关联 → skip；source 缺失 → 回退 target', async () => {
    const lookup = vi.fn(async (tid: string) => (tid === 't-dst' ? 'F188' : null));
    const collector = new CrossPostCollector({
      messageStore: messageStore([
        { id: 'with-target', threadId: 't-dst', catId: null, timestamp: T0, deliveryStatus: 'delivered', extra: { crossPost: { sourceThreadId: 't-src' } } },
        { id: 'no-feat', threadId: 't-x', catId: null, timestamp: T0, deliveryStatus: 'delivered', extra: { crossPost: { sourceThreadId: 't-y' } } },
      ]),
      featIndex: { lookupByThreadId: lookup },
    });
    const snaps = await collector.collectAll();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.featId).toBe('F188'); // source 无 → target 回退
    expect(snaps[0]!.messageId).toBe('with-target');
  });
});

// ─── ThreadSplitCollector ──────────────────────────────────────────────────

describe('C26 ThreadSplitCollector：approved proposals → thread_split', () => {
  function proposalStore(proposals: Array<Record<string, unknown>>): IProposalStoreForSplit {
    return {
      listAll: vi.fn(async () => proposals as never),
    };
  }

  it('approved + createdThreadId → thread_split（splitAt = approvedAt）', async () => {
    const collector = new ThreadSplitCollector({
      proposalStore: proposalStore([
        {
          proposalId: 'tp-1',
          status: 'approved',
          parentThreadId: 't-parent',
          createdThreadId: 't-child',
          sourceCatId: 'cat-a',
          createdAt: T0 - 1000,
          approvedAt: T0,
        },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    const snaps = await collector.collectAll();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual({
      kind: 'thread_split',
      proposalId: 'tp-1',
      parentThreadId: 't-parent',
      childThreadId: 't-child',
      featId: 'F233',
      splitAt: T0,
      catId: 'cat-a',
    });
  });

  it('非 approved（approving/pending）→ skip（防止 premature split 边）', async () => {
    const collector = new ThreadSplitCollector({
      proposalStore: proposalStore([
        { proposalId: 'tp-a', status: 'approving', parentThreadId: 'p', createdThreadId: 'c', sourceCatId: 'cat', createdAt: T0 },
        { proposalId: 'tp-b', status: 'pending', parentThreadId: 'p', sourceCatId: 'cat', createdAt: T0 },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    expect(await collector.collectAll()).toHaveLength(0);
  });

  it('无 createdThreadId / 无 feat 关联 → skip', async () => {
    const collector = new ThreadSplitCollector({
      proposalStore: proposalStore([
        { proposalId: 'tp-1', status: 'approved', parentThreadId: 'p', sourceCatId: 'cat', createdAt: T0 },
        { proposalId: 'tp-2', status: 'approved', parentThreadId: 'p-no-feat', createdThreadId: 'c', sourceCatId: 'cat', createdAt: T0 },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async (tid) => (tid === 'p' ? 'F188' : null)) },
    });
    const snaps = await collector.collectAll();
    expect(snaps).toHaveLength(0);
  });

  it('approvedAt 缺省 → splitAt = createdAt', async () => {
    const collector = new ThreadSplitCollector({
      proposalStore: proposalStore([
        { proposalId: 'tp-1', status: 'approved', parentThreadId: 'p', createdThreadId: 'c', sourceCatId: 'cat', createdAt: T0 },
      ]),
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    const snaps = await collector.collectAll();
    expect(snaps[0]!.splitAt).toBe(T0);
  });
});
