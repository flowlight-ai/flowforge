/**
 * C26 GitRefSnapshotCollector 测试（F233，clowder GitRefSnapshotCollector 直译）。
 *
 * 覆盖：
 *  - heuristicFeatJoin：branch_name_F# / commit_message_F# 证据累加 → 置信度；
 *    multi-F# branch → multi-candidate（policy 正确拒绝）
 *  - applyMultiCandidatePolicy：0/low/multi → skip；single high/medium → emit；
 *    emit-per-candidate 未实现 → explicit throw
 *  - collectAll：prefetch + 单次 lsRemote + per-branch failure isolation +
 *    snapshot DTO 字段（真实 PR timestamp contract + collectedAt）
 *  - collectOne：分支不存在 → null
 */

import { describe, expect, it, vi } from 'vitest';
import type { GitRefSnapshot } from '@flowforge/cats-shared';
import {
  GitRefSnapshotCollector,
  applyMultiCandidatePolicy,
  heuristicFeatJoin,
} from '../src/git-ref-collector.js';
import type {
  FeatIndexLookup,
  GhClient,
  GitBranchRef,
  GitCommitMeta,
  GitRunner,
  ThreadSearch,
} from '../src/git-ref-collector.js';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

// ─── heuristicFeatJoin ─────────────────────────────────────────────────────

describe('C26 heuristicFeatJoin：文本证据累加', () => {
  it('branch + commit 双证据 → high confidence', () => {
    const r = heuristicFeatJoin('fix/f188-phase-k', ['F188: fix something']);
    expect(r.featureCandidates).toEqual(['F188']);
    expect(r.confidence).toBe('high');
    expect(r.joinedVia).toEqual(['branch_name_F#', 'commit_message_F#']);
  });

  it('单证据（branch only / commit only）→ medium confidence', () => {
    const branchOnly = heuristicFeatJoin('fix/f233-cleanup', ['chore: cleanup']);
    expect(branchOnly.featureCandidates).toEqual(['F233']);
    expect(branchOnly.confidence).toBe('medium');
    expect(branchOnly.joinedVia).toEqual(['branch_name_F#']);

    const commitOnly = heuristicFeatJoin('misc/random', ['(F155) guide states']);
    expect(commitOnly.featureCandidates).toEqual(['F155']);
    expect(commitOnly.confidence).toBe('medium');
    expect(commitOnly.joinedVia).toEqual(['commit_message_F#']);
  });

  it('无证据 → low confidence + 空 candidates', () => {
    const r = heuristicFeatJoin('misc/random', ['chore: cleanup']);
    expect(r.featureCandidates).toEqual([]);
    expect(r.confidence).toBe('low');
    expect(r.joinedVia).toEqual([]);
  });

  it('multi-F# branch → multi-candidate（matchAll 收集全部）', () => {
    const r = heuristicFeatJoin('fix/f188-f233-cleanup', []);
    expect(r.featureCandidates.sort()).toEqual(['F188', 'F233']);
    expect(r.confidence).toBe('medium');
  });

  it('commit message 多 F# → multi-candidate + 幂等 joinedVia', () => {
    const r = heuristicFeatJoin('misc/x', ['F188: a', 'F233: b']);
    expect(r.featureCandidates.sort()).toEqual(['F188', 'F233']);
    expect(r.joinedVia).toEqual(['commit_message_F#']);
  });

  it('大小写不敏感：fix/F233-* 与 f233 同归一', () => {
    expect(heuristicFeatJoin('feat/f233-x', []).featureCandidates).toEqual(['F233']);
    expect(heuristicFeatJoin('feat/F233-x', []).featureCandidates).toEqual(['F233']);
  });
});

// ─── applyMultiCandidatePolicy ─────────────────────────────────────────────

describe('C26 applyMultiCandidatePolicy：skip-low-confidence（default）', () => {
  it('0 candidates → skip', () => {
    const d = applyMultiCandidatePolicy([], 'high', 'skip-low-confidence');
    expect(d.decision).toBe('skip');
    expect(d.reason).toMatch(/no candidates/);
  });

  it('low confidence → skip（避免污染轨迹）', () => {
    expect(applyMultiCandidatePolicy(['F188'], 'low', 'skip-low-confidence').decision).toBe('skip');
  });

  it('multi-candidate（即使 high conf）→ skip（single-feat 模糊）', () => {
    const d = applyMultiCandidatePolicy(['F188', 'F233'], 'high', 'skip-low-confidence');
    expect(d.decision).toBe('skip');
    expect(d.reason).toMatch(/multi-candidate ambiguity/);
  });

  it('single high/medium → emit（selectedFeatId 返回）', () => {
    expect(applyMultiCandidatePolicy(['F188'], 'high', 'skip-low-confidence')).toEqual({
      decision: 'emit',
      selectedFeatId: 'F188',
    });
    expect(applyMultiCandidatePolicy(['F233'], 'medium', 'skip-low-confidence').decision).toBe('emit');
  });

  it('emit-per-candidate-low-confidence 未实现 → explicit throw', () => {
    expect(() => applyMultiCandidatePolicy(['F188'], 'low', 'emit-per-candidate-low-confidence')).toThrow(
      /not yet implemented/,
    );
  });
});

// ─── GitRefSnapshotCollector ───────────────────────────────────────────────

/** Stub IO deps builder — 可覆盖任意接口行为。 */
function collectorDeps(overrides: {
  branches?: GitBranchRef[];
  commitMeta?: (sha: string, branchName: string) => GitCommitMeta;
  prInfo?: (branchName: string) => Awaited<ReturnType<GhClient['findPrByBranch']>>;
  index?: (branchName: string) => Awaited<ReturnType<FeatIndexLookup['findByBranch']>>;
  threads?: (featId: string) => Awaited<ReturnType<ThreadSearch['findByFeatId']>>;
  prefetchFail?: boolean;
} = {}) {
  const gitRunner: GitRunner = {
    prefetch: vi.fn(async () => {}),
    lsRemote: vi.fn(async () => overrides.branches ?? []),
    getCommitMeta: vi.fn(
      async (sha: string, branchName: string) =>
        overrides.commitMeta?.(sha, branchName) ?? {
          headCommitAt: T0 - 10 * 24 * HOUR,
          authorIdentity: 'opus-47',
          commitMessages: ['F188: fix phase K'],
        },
    ),
  };
  const ghClient: GhClient = {
    findPrByBranch: vi.fn(
      async (branchName: string): Promise<Awaited<ReturnType<GhClient['findPrByBranch']>>> =>
        overrides.prInfo?.(branchName) ?? {
          prNumber: 42,
          prState: 'open',
          prOpenedAt: T0 - 9 * 24 * HOUR,
          prMergedAt: null,
          mergedToMain: false,
        },
    ),
  };
  const featIndexLookup: FeatIndexLookup = {
    findByBranch: vi.fn(async (branchName: string) => overrides.index?.(branchName) ?? []),
  };
  const threadSearch: ThreadSearch = {
    findByFeatId: vi.fn(async (featId: string) => overrides.threads?.(featId) ?? []),
  };
  return { gitRunner, ghClient, featIndexLookup, threadSearch };
}

function makeCollector(overrides: Parameters<typeof collectorDeps>[0] = {}) {
  const deps = collectorDeps(overrides);
  const collector = new GitRefSnapshotCollector({ ...deps });
  return { collector, deps };
}

describe('C26 collectAll：census tick', () => {
  it('prefetch + 单次 lsRemote + single-candidate snapshot 完整字段', async () => {
    const { collector, deps } = makeCollector({
      branches: [
        { branchName: 'fix/f188-phase-k', headCommitSha: 'abc123' },
        { branchName: 'feat/f233-euthanasia', headCommitSha: 'def456' },
      ],
      commitMeta: (sha) =>
        sha === 'abc123'
          ? { headCommitAt: T0 - 10 * 24 * HOUR, authorIdentity: 'opus-47', commitMessages: ['F188: fix phase K'] }
          : { headCommitAt: T0 - 2 * HOUR, authorIdentity: 'you', commitMessages: ['(F233 Phase C) e2e'] },
    });

    const snapshots = await collector.collectAll(T0);
    expect(deps.gitRunner.prefetch).toHaveBeenCalledTimes(1);
    expect(deps.gitRunner.lsRemote).toHaveBeenCalledTimes(1); // 单次 scan（N+1 退化解）
    expect(snapshots).toHaveLength(2);

    const f188 = snapshots.find((s) => s.branchName === 'fix/f188-phase-k')!;
    expect(f188).toMatchObject({
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
      collectedAt: T0,
    });
    expect(f188.joinProvenance.confidence).toBe('high');
    expect(f188.associatedThreadIds).toEqual([]);
    expect(f188.lastThreadMessageAt).toBeNull();
  });

  it('per-branch failure isolation：坏 branch 不 brick 整 tick', async () => {
    const { deps } = makeCollector({
      branches: [
        { branchName: 'fix/f188-phase-k', headCommitSha: 'abc123' },
        { branchName: 'fix/f233-bad', headCommitSha: 'deadbeef' },
      ],
      commitMeta: (sha) => {
        if (sha === 'deadbeef') throw new Error('object not found (not fetched)');
        return { headCommitAt: T0, authorIdentity: 'opus-47', commitMessages: ['F188: x'] };
      },
    });
    const warn = vi.fn();
    const collectorWithLogger = new GitRefSnapshotCollector({
      ...deps,
      logger: { warn, info: vi.fn(), error: vi.fn() },
    });

    const snapshots = await collectorWithLogger.collectAll(T0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.branchName).toBe('fix/f188-phase-k');
    expect(warn).toHaveBeenCalled();
  });

  it('prefetch 失败 → warn + 继续（stale local refs 降级）', async () => {
    const { deps } = makeCollector({
      branches: [{ branchName: 'fix/f188-phase-k', headCommitSha: 'abc123' }],
      prefetchFail: true,
    });
    if (deps.gitRunner.prefetch) {
      deps.gitRunner.prefetch = vi.fn(async () => {
        throw new Error('network down');
      });
    }
    const warn = vi.fn();
    const collectorWithLogger = new GitRefSnapshotCollector({
      ...deps,
      logger: { warn, info: vi.fn(), error: vi.fn() },
    });
    const snapshots = await collectorWithLogger.collectAll(T0);
    expect(snapshots).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('multi-candidate / low confidence → skip emit（policy 生效）', async () => {
    const { collector } = makeCollector({
      branches: [{ branchName: 'fix/f188-f233-ambiguous', headCommitSha: 'abc123' }],
      commitMeta: () => ({ headCommitAt: T0, authorIdentity: 'you', commitMessages: [] }),
    });
    const snapshots = await collector.collectAll(T0);
    expect(snapshots).toHaveLength(0); // multi-candidate → skip
  });

  it('feat_index 命中 → high confidence + unshift 优先位置', async () => {
    const { collector } = makeCollector({
      branches: [{ branchName: 'misc/random-branch', headCommitSha: 'abc123' }],
      commitMeta: () => ({ headCommitAt: T0, authorIdentity: 'you', commitMessages: ['chore: x'] }),
      index: () => ['F188'],
    });
    const snapshots = await collector.collectAll(T0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.featureCandidates).toEqual(['F188']);
    expect(snapshots[0]!.joinProvenance.confidence).toBe('high');
    expect(snapshots[0]!.joinProvenance.joinedVia[0]).toBe('feat_index');
  });

  it('thread association：lastMessageAt/lastActivityAt 取 max', async () => {
    const { collector } = makeCollector({
      branches: [{ branchName: 'fix/f188-phase-k', headCommitSha: 'abc123' }],
      threads: () => [
        { threadId: 't-1', lastMessageAt: T0 - 3 * HOUR, lastActivityAt: T0 - 2 * HOUR },
        { threadId: 't-2', lastMessageAt: T0 - 1 * HOUR, lastActivityAt: null },
      ],
    });
    const snapshots = await collector.collectAll(T0);
    const f188 = snapshots[0]!;
    expect(f188.associatedThreadIds).toEqual(['t-1', 't-2']);
    expect(f188.lastThreadMessageAt).toBe(T0 - 1 * HOUR);
    expect(f188.lastThreadActivityAt).toBe(T0 - 2 * HOUR);
  });
});

describe('C26 collectOne：单分支 focused collect', () => {
  it('分支存在 → snapshot；不存在 → null', async () => {
    const { collector } = makeCollector({
      branches: [{ branchName: 'fix/f188-phase-k', headCommitSha: 'abc123' }],
    });
    const found = await collector.collectOne('fix/f188-phase-k', T0);
    expect(found?.branchName).toBe('fix/f188-phase-k');
    const missing = await collector.collectOne('fix/ghost', T0);
    expect(missing).toBeNull();
  });

  it('默认 branchPatterns = fix/* + feat/*（constructor 缺省）', async () => {
    const { deps } = makeCollector({ branches: [] });
    const collector = new GitRefSnapshotCollector({ ...deps });
    await collector.collectAll(T0);
    expect(deps.gitRunner.lsRemote).toHaveBeenCalledWith(['fix/*', 'feat/*']);
  });
});

// 类型级 sanity：snapshot 与 shared GitRefSnapshot 契约一致
const _snapshotCheck: (s: GitRefSnapshot) => void = (s) => {
  void s.branchName;
};
void _snapshotCheck;
