/**
 * C26 FeatTrajectoryProjector 测试（F233，clowder FeatTrajectoryProjector 直译）。
 *
 * 覆盖：
 *  - mapBallCustodyEventToTrajectory：done_notify → 'closed'，其余保守 skip
 *  - applyBallCustodyEvent：evt: entryId 幂等（同 sourceEventId 不增 counts）
 *  - applyGitRefSnapshot：branch_pushed 恒发 / pr_opened 与 merged null→skip /
 *    stale unmerged bucket entry（entry.at = headCommitAt + bucketThresholdMs）
 *  - 0 candidates → skip whole snapshot（single-feat contract）
 *  - INV-2 rebuild-safe：重放同 entries → 逐字段相同 projection
 *  - updatedAt monotonic max（多源 out-of-order 防倒退）
 *  - applyThreadSplit / applyCrossPost entryId 幂等；applyStitchedEntry throw RED
 */

import { describe, expect, it } from 'vitest';
import type {
  BallCustodyEvent,
  FeatTrajectoryEntry,
  GitRefSnapshot,
} from '@flowforge/cats-shared';
import { InMemoryFeatTrajectoryStore } from '../src/store.js';
import {
  FeatTrajectoryProjector,
  mapBallCustodyEventToTrajectory,
} from '../src/projector.js';
import type { CrossPostSnapshot } from '../src/cross-post-collector.js';
import type { ThreadSplitSnapshot } from '../src/thread-split-collector.js';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** 构造合法 BallCustodyEvent（ball.handed_cvo 默认）。 */
function ballEvent(overrides: Partial<BallCustodyEvent> = {}): BallCustodyEvent {
  return {
    sourceEventId: 'route:msg-1',
    subjectKey: 'ball:thread:t-1',
    kind: 'ball.handed_cvo',
    classification: 'state-changing',
    payload: { intent: 'handoff' },
    at: T0,
    ...overrides,
  };
}

/** 构造 git snapshot（single-candidate high confidence 默认）。 */
function snapshot(overrides: Partial<GitRefSnapshot> = {}): GitRefSnapshot {
  return {
    branchName: 'fix/f188-phase-k',
    headCommitSha: 'abc123',
    headCommitAt: T0 - 10 * 24 * HOUR,
    prNumber: 42,
    prState: 'open',
    mergedToMain: false,
    prOpenedAt: T0 - 9 * 24 * HOUR,
    prMergedAt: null,
    authorIdentity: 'opus-47',
    featureCandidates: ['F188'],
    associatedThreadIds: ['t-1'],
    lastThreadMessageAt: T0 - 11 * 24 * HOUR,
    lastThreadActivityAt: T0 - 11 * 24 * HOUR,
    joinProvenance: { confidence: 'high', joinedVia: ['branch_name_F#', 'commit_message_F#'] },
    collectedAt: T0,
    ...overrides,
  };
}

// ─── mapBallCustodyEventToTrajectory ───────────────────────────────────────

describe('C26 mapBallCustodyEventToTrajectory：conservative 映射', () => {
  it('ball.handed_cvo + intent=done_notify → closed', () => {
    const kind = mapBallCustodyEventToTrajectory(ballEvent({ payload: { intent: 'done_notify' } }));
    expect(kind).toBe('closed');
  });

  it('ball.handed_cvo 其他 intent → null（skip）', () => {
    expect(mapBallCustodyEventToTrajectory(ballEvent({ payload: { intent: 'handoff' } }))).toBeNull();
    expect(mapBallCustodyEventToTrajectory(ballEvent({ payload: { intent: 'fyi' } }))).toBeNull();
  });

  it('其余 ball 事件 kind → null（球权层语义不投 feat 轨迹）', () => {
    expect(mapBallCustodyEventToTrajectory(ballEvent({ kind: 'ball.void_pass' }))).toBeNull();
    expect(mapBallCustodyEventToTrajectory(ballEvent({ kind: 'ball.held' }))).toBeNull();
  });
});

// ─── applyBallCustodyEvent ─────────────────────────────────────────────────

describe('C26 applyBallCustodyEvent：event-stream 轨投影', () => {
  it('done_notify → closed entry，event-stream counts=1', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyBallCustodyEvent(ballEvent({ payload: { intent: 'done_notify' } }), 'F233');

    const proj = (await store.get('F233'))!;
    expect(proj.featId).toBe('F233');
    expect(proj.entries).toHaveLength(1);
    expect(proj.entries[0]!.entryId).toBe('evt:route:msg-1');
    expect(proj.entries[0]!.kind).toBe('closed');
    expect(proj.entries[0]!.source).toBe('event-stream');
    expect(proj.countsBySource['event-stream']).toBe(1);
    expect(proj.countsByKind.closed).toBe(1);
    expect(proj.appliedEntryCount).toBe(1);
  });

  it('同 sourceEventId 重放 → upsert 不增 counts（幂等）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    const event = ballEvent({ payload: { intent: 'done_notify' } });
    await projector.applyBallCustodyEvent(event, 'F233');
    await projector.applyBallCustodyEvent(event, 'F233');

    const proj = (await store.get('F233'))!;
    expect(proj.entries).toHaveLength(1);
    expect(proj.appliedEntryCount).toBe(1);
    expect(proj.countsBySource['event-stream']).toBe(1);
  });

  it('unmapped event → 静默 skip（不创建 projection）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyBallCustodyEvent(ballEvent({ payload: { intent: 'handoff' } }), 'F233');
    expect(await store.get('F233')).toBeNull();
  });
});

// ─── applyGitRefSnapshot ───────────────────────────────────────────────────

describe('C26 applyGitRefSnapshot：git-ref-snapshot 轨投影', () => {
  it('0 candidates → skip whole snapshot（无 feat 关联无轨迹意义）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyGitRefSnapshot(snapshot({ featureCandidates: [] }));
    expect(await store.listFeatIds()).toEqual([]);
  });

  it('branch_pushed 恒发 + pr_opened emit（真实时间）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyGitRefSnapshot(snapshot());

    const proj = (await store.get('F188'))!;
    const kinds = proj.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['branch_pushed', 'branch_stale_unmerged', 'pr_opened']);
    const pushed = proj.entries.find((e) => e.kind === 'branch_pushed')!;
    expect(pushed.at).toBe(T0 - 10 * 24 * HOUR);
    expect(pushed.subjectKey).toBe('git-ref:fix/f188-phase-k');
    const opened = proj.entries.find((e) => e.kind === 'pr_opened')!;
    expect(opened.at).toBe(T0 - 9 * 24 * HOUR);
    expect(opened.payload.detectedAt).toBe(T0);
  });

  it('prOpenedAt=null → 不 emit pr_opened（护栏：不伪装 collectedAt）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyGitRefSnapshot(snapshot({ prOpenedAt: null, prNumber: null, prState: null }));
    const proj = (await store.get('F188'))!;
    expect(proj.entries.some((e) => e.kind === 'pr_opened')).toBe(false);
  });

  it('mergedToMain → branch_merged_to_main emit；不 emit stale', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyGitRefSnapshot(
      snapshot({
        mergedToMain: true,
        prMergedAt: T0 - 8 * 24 * HOUR,
        prState: 'merged',
        collectedAt: T0,
      }),
    );
    const proj = (await store.get('F188'))!;
    const merged = proj.entries.find((e) => e.kind === 'branch_merged_to_main')!;
    expect(merged.at).toBe(T0 - 8 * 24 * HOUR);
    expect(proj.entries.some((e) => e.kind === 'branch_stale_unmerged')).toBe(false);
  });

  it('stale unmerged：entry.at = headCommitAt + bucketThresholdMs（largest crossed）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    // headCommitAt 10d 前 → bucket '7d' → at = headCommitAt + 7d
    await projector.applyGitRefSnapshot(snapshot());
    const proj = (await store.get('F188'))!;
    const stale = proj.entries.find((e) => e.kind === 'branch_stale_unmerged')!;
    expect(stale.at).toBe(T0 - 10 * 24 * HOUR + 7 * 24 * HOUR);
    expect(stale.payload.staleBucket).toBe('7d');
    expect(stale.payload.detectedAt).toBe(T0); // observation 真实时间与 entry.at 分开
  });

  it('age < 24h → 不 emit stale', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyGitRefSnapshot(
      snapshot({ headCommitAt: T0 - 2 * HOUR, prOpenedAt: null, prNumber: null, prState: null }),
    );
    const proj = (await store.get('F188'))!;
    expect(proj.entries.some((e) => e.kind === 'branch_stale_unmerged')).toBe(false);
  });

  it('同 snapshot 重放 → 同 entryId upsert，counts 不 inflate（幂等）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    const snap = snapshot();
    await projector.applyGitRefSnapshot(snap);
    await projector.applyGitRefSnapshot(snap);
    const proj = (await store.get('F188'))!;
    expect(proj.entries).toHaveLength(3);
    expect(proj.appliedEntryCount).toBe(3);
    expect(proj.countsBySource['git-ref-snapshot']).toBe(3);
  });

  it('updatedAt monotonic max：多源 out-of-order 防倒退', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    // 先 apply 较新事件，再 apply 较旧事件 → updatedAt 不倒退
    await projector.applyBallCustodyEvent(ballEvent({ payload: { intent: 'done_notify' }, at: T0 + 5000 }), 'F188');
    await projector.applyBallCustodyEvent(ballEvent({ sourceEventId: 'route:msg-2', payload: { intent: 'done_notify' }, at: T0 }), 'F188');
    const proj = (await store.get('F188'))!;
    expect(proj.updatedAt).toBe(T0 + 5000);
  });

  it('INV-2 rebuild-safe：重放同 entries → 逐字段相同 projection', async () => {
    const storeA = new InMemoryFeatTrajectoryStore();
    const storeB = new InMemoryFeatTrajectoryStore();
    const projA = new FeatTrajectoryProjector(storeA);
    const projB = new FeatTrajectoryProjector(storeB);

    const snap = snapshot({ mergedToMain: true, prMergedAt: T0 - 8 * 24 * HOUR });
    const evt = ballEvent({ payload: { intent: 'done_notify' } });
    // 不同 apply 顺序（模拟多源 out-of-order）
    await projA.applyBallCustodyEvent(evt, 'F188');
    await projA.applyGitRefSnapshot(snap);
    await projB.applyGitRefSnapshot(snap);
    await projB.applyBallCustodyEvent(evt, 'F188');

    const a = (await storeA.get('F188'))!;
    const b = (await storeB.get('F188'))!;
    expect(a).toEqual(b);
  });
});

// ─── applyThreadSplit / applyCrossPost ─────────────────────────────────────

describe('C26 applyThreadSplit / applyCrossPost：emit 器投影', () => {
  const split: ThreadSplitSnapshot = {
    kind: 'thread_split',
    proposalId: 'tp-1',
    parentThreadId: 't-parent',
    childThreadId: 't-child',
    featId: 'F233',
    splitAt: T0,
    catId: 'cat-a',
  };
  const merge: CrossPostSnapshot = {
    kind: 'thread_merge',
    messageId: 'msg-1',
    sourceThreadId: 't-src',
    targetThreadId: 't-dst',
    catId: 'cat-b',
    featId: 'F233',
    postedAt: T0 + 1000,
  };

  it('thread_split entry：split:{proposalId} 幂等 upsert', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyThreadSplit(split);
    await projector.applyThreadSplit(split);
    const proj = (await store.get('F233'))!;
    expect(proj.entries).toHaveLength(1);
    expect(proj.entries[0]!.entryId).toBe('split:tp-1');
    expect(proj.entries[0]!.payload.childThreadId).toBe('t-child');
    expect(proj.countsByKind.thread_split).toBe(1);
  });

  it('thread_merge entry：merge:{messageId} 幂等 upsert + at 排序', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await projector.applyThreadSplit(split);
    await projector.applyCrossPost(merge);
    const proj = (await store.get('F233'))!;
    expect(proj.entries.map((e) => e.entryId)).toEqual(['split:tp-1', 'merge:msg-1']); // 按 at 升序
    expect(proj.countsByKind.thread_merge).toBe(1);
  });

  it('applyStitchedEntry：RED not implemented（explicit throw）', async () => {
    const store = new InMemoryFeatTrajectoryStore();
    const projector = new FeatTrajectoryProjector(store);
    await expect(
      projector.applyStitchedEntry({} as FeatTrajectoryEntry),
    ).rejects.toThrow(/not implemented/);
  });
});
