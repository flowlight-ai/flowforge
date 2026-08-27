/**
 * C26 FeatTrajectoryCollectorScheduler + backfill 测试（F233，clowder 直译）。
 *
 * 覆盖：
 *  - tick：collected/applied/failed/featsInStore 汇总 + per-snapshot 失败隔离
 *  - git collector 失败 → split/merge 仍跑 + lastCollectorTickAt 不记录（freshness 诚实）
 *  - git 成功（即使 0 snapshots）→ lastCollectorTickAt 记录（UI freshness）
 *  - runBackfill：collect → apply → per-feat summary（featId 排序）
 */

import { describe, expect, it, vi } from 'vitest';
import type { GitRefSnapshot } from '@flowforge/cats-shared';
import { InMemoryFeatTrajectoryStore } from '../src/store.js';
import { FeatTrajectoryProjector } from '../src/projector.js';
import { FeatTrajectoryCollectorScheduler } from '../src/scheduler.js';
import { runBackfill } from '../src/backfill.js';
import { GitRefSnapshotCollector } from '../src/git-ref-collector.js';
import { CrossPostCollector } from '../src/cross-post-collector.js';
import { ThreadSplitCollector } from '../src/thread-split-collector.js';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** 标准 snapshot（single-candidate high confidence）。 */
function snap(branchName: string, featId: string): GitRefSnapshot {
  return {
    branchName,
    headCommitSha: 'abc123',
    headCommitAt: T0 - 10 * 24 * HOUR,
    prNumber: null,
    prState: null,
    mergedToMain: false,
    prOpenedAt: null,
    prMergedAt: null,
    authorIdentity: 'opus-47',
    featureCandidates: [featId],
    associatedThreadIds: [],
    lastThreadMessageAt: null,
    lastThreadActivityAt: null,
    joinProvenance: { confidence: 'high', joinedVia: ['branch_name_F#'] },
    collectedAt: T0,
  };
}

function makeHarness(overrides: {
  snapshots?: GitRefSnapshot[];
  collectorThrow?: boolean;
  applyThrow?: (branchName: string) => boolean;
} = {}) {
  const store = new InMemoryFeatTrajectoryStore();
  const projector = new FeatTrajectoryProjector(store);
  const collector = {
    collectAll: vi.fn(async (): Promise<GitRefSnapshot[]> => {
      if (overrides.collectorThrow) throw new Error('git ls-remote failed');
      return overrides.snapshots ?? [];
    }),
  } as unknown as GitRefSnapshotCollector;
  const scheduler = new FeatTrajectoryCollectorScheduler({
    collector,
    projector,
    store,
    now: () => T0,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  });
  return { scheduler, store, projector, collector };
}

describe('C26 scheduler.tick：census 汇总', () => {
  it('git snapshots 全量 apply：collected/applied/featsInStore', async () => {
    const h = makeHarness({ snapshots: [snap('fix/f188-phase-k', 'F188'), snap('feat/f233-euthanasia', 'F233')] });
    const result = await h.scheduler.tick();
    expect(result.collected).toBe(2);
    expect(result.applied).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.featsInStore).toBe(2);
    // freshness 记录（git 成功）
    expect(await h.store.getLastCollectorTickAt()).toBe(T0);
  });

  it('per-snapshot apply 失败 → failed 计数 + 其余继续（不 fatal）', async () => {
    const h = makeHarness({ snapshots: [snap('fix/f188-phase-k', 'F188'), snap('feat/f233-euthanasia', 'F233')] });
    const store = new InMemoryFeatTrajectoryStore();
    const failingProjector = {
      applyGitRefSnapshot: vi.fn(async (s: GitRefSnapshot) => {
        if (s.branchName === 'fix/f188-phase-k') throw new Error('boom');
      }),
    } as unknown as FeatTrajectoryProjector;
    const scheduler = new FeatTrajectoryCollectorScheduler({
      collector: h.collector,
      projector: failingProjector,
      store,
      now: () => T0,
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    });
    const result = await scheduler.tick();
    expect(result.collected).toBe(2);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('git collector 抛错 → split/merge collectors 仍跑 + lastCollectorTickAt 不记录', async () => {
    const h = makeHarness({ collectorThrow: true });
    const splitData = [
      { proposalId: 'tp-1', status: 'approved', parentThreadId: 'p', createdThreadId: 'c', sourceCatId: 'cat', createdAt: T0 },
    ];
    const mergeData = [
      { id: 'msg-1', threadId: 't-dst', catId: null, timestamp: T0, deliveryStatus: 'delivered' as const, extra: { crossPost: { sourceThreadId: 't-src' } } },
    ];
    // 为 split/merge 提供 featIndex stub 的 collector 实例
    const splitCollector = new ThreadSplitCollector({
      proposalStore: { listAll: vi.fn(async () => splitData) },
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    const mergeCollector = new CrossPostCollector({
      messageStore: { listCrossPostMessages: vi.fn(async () => mergeData) },
      featIndex: { lookupByThreadId: vi.fn(async () => 'F233') },
    });
    const store = new InMemoryFeatTrajectoryStore();
    const scheduler = new FeatTrajectoryCollectorScheduler({
      collector: h.collector,
      projector: new FeatTrajectoryProjector(store),
      store,
      threadSplitCollector: splitCollector,
      crossPostCollector: mergeCollector,
      now: () => T0,
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    });
    const result = await scheduler.tick();
    expect(result.collected).toBe(2); // 1 split + 1 merge
    expect(result.applied).toBe(2);
    expect(result.featsInStore).toBe(1); // 都投到 F233
    expect(await store.getLastCollectorTickAt()).toBeNull(); // git 失败 → 不记录 freshness
  });

  it('git 成功但 0 snapshots（安静期）→ 仍记录 freshness', async () => {
    const h = makeHarness({ snapshots: [] });
    const result = await h.scheduler.tick();
    expect(result.collected).toBe(0);
    expect(result.applied).toBe(0);
    expect(await h.store.getLastCollectorTickAt()).toBe(T0);
  });
});

describe('C26 runBackfill：历史回填', () => {
  it('collect → apply → per-feat summary（featId 数字排序）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    const collector = {
      collectAll: vi.fn(async () => [snap('feat/f233-euthanasia', 'F233'), snap('fix/f188-phase-k', 'F188')]),
    } as unknown as GitRefSnapshotCollector;
    const logs: string[] = [];

    const result = await runBackfill({
      collector,
      projector,
      store,
      now: () => T0,
      logger: (msg) => logs.push(msg),
    });

    expect(result.snapshotsCollected).toBe(2);
    expect(result.snapshotsApplied).toBe(2);
    expect(result.featsInStore).toEqual(['F188', 'F233']); // 数字排序
    expect(result.perFeatSummary).toHaveLength(2);
    expect(result.perFeatSummary[0]!.featId).toBe('F188');
    expect(result.perFeatSummary[0]!.entryCount).toBe(2); // branch_pushed + stale
    expect(logs.some((l) => l.includes('F188: 2 entries'))).toBe(true);
  });

  it('apply 失败 → 跳过该 snapshot 不中断（⚠️ 日志）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const failingProjector = {
      applyGitRefSnapshot: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as FeatTrajectoryProjector;
    const collector = {
      collectAll: vi.fn(async () => [snap('fix/f188-phase-k', 'F188')]),
    } as unknown as GitRefSnapshotCollector;
    const logs: string[] = [];

    const result = await runBackfill({
      collector,
      projector: failingProjector,
      store,
      now: () => T0,
      logger: (msg) => logs.push(msg),
    });
    expect(result.snapshotsCollected).toBe(1);
    expect(result.snapshotsApplied).toBe(0);
    expect(logs.some((l) => l.includes('⚠️'))).toBe(true);
  });
});
