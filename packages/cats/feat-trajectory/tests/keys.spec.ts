/**
 * C26 FeatTrajectory keys 测试（F233，clowder feat-trajectory-keys 直译）。
 *
 * 覆盖：
 *  - staleBucketForAge：<24h → null / largest crossed（10d → '7d'）
 *  - subjectKey / entryId 派生（KD-1：featId / branchName 派生，不引新原语）
 *  - FeatTrajectoryKeys namespace（store 分桶 key）
 *  - makeGitRefEntryId 公式 re-export（per-kind stable id）
 */

import { describe, expect, it } from 'vitest';
import {
  FeatTrajectoryKeys,
  STALE_BUCKET_THRESHOLDS_MS,
  makeCrossPostEntryId,
  makeEventStreamEntryId,
  makeFeatSubjectKey,
  makeGitRefEntryId,
  makeGitRefSubjectKey,
  makeStitchedEntryId,
  makeThreadSplitEntryId,
  staleBucketForAge,
} from '../src/keys.js';

const HOUR = 60 * 60 * 1000;

describe('C26 staleBucketForAge：largest crossed 分配', () => {
  it('阈值映射：24h/72h/7d/30d', () => {
    expect(STALE_BUCKET_THRESHOLDS_MS['24h']).toBe(24 * HOUR);
    expect(STALE_BUCKET_THRESHOLDS_MS['72h']).toBe(72 * HOUR);
    expect(STALE_BUCKET_THRESHOLDS_MS['7d']).toBe(7 * 24 * HOUR);
    expect(STALE_BUCKET_THRESHOLDS_MS['30d']).toBe(30 * 24 * HOUR);
  });

  it('age < 24h → null（不 emit branch_stale_unmerged）', () => {
    expect(staleBucketForAge(23 * HOUR)).toBeNull();
    expect(staleBucketForAge(0)).toBeNull();
  });

  it('恰好跨阈值 → 该 bucket', () => {
    expect(staleBucketForAge(24 * HOUR)).toBe('24h');
    expect(staleBucketForAge(72 * HOUR)).toBe('72h');
    expect(staleBucketForAge(7 * 24 * HOUR)).toBe('7d');
    expect(staleBucketForAge(30 * 24 * HOUR)).toBe('30d');
  });

  it('largest crossed：10d → 7d（不是 24h/72h），40d → 30d', () => {
    expect(staleBucketForAge(10 * 24 * HOUR)).toBe('7d');
    expect(staleBucketForAge(40 * 24 * HOUR)).toBe('30d');
    expect(staleBucketForAge(72 * HOUR + 1)).toBe('72h');
  });
});

describe('C26 subjectKey / entryId 派生（KD-1）', () => {
  it('makeFeatSubjectKey / makeGitRefSubjectKey 前缀', () => {
    expect(makeFeatSubjectKey('F233')).toBe('feat:F233');
    expect(makeGitRefSubjectKey('fix/f188-phase-k')).toBe('git-ref:fix/f188-phase-k');
  });

  it('三源 entryId：evt: / stitch: / split: / merge:', () => {
    expect(makeEventStreamEntryId('route:msg-1')).toBe('evt:route:msg-1');
    expect(makeStitchedEntryId('F188', 1_700_000_000_000, 'git_log')).toBe('stitch:F188:1700000000000:git_log');
    expect(makeThreadSplitEntryId('tp-9')).toBe('split:tp-9');
    expect(makeCrossPostEntryId('msg-7')).toBe('merge:msg-7');
  });

  it('makeGitRefEntryId 公式：per-kind stable id', () => {
    expect(makeGitRefEntryId({ kind: 'branch_pushed', branchName: 'fix/f188', headCommitSha: 'abc123' })).toBe(
      'git-ref:fix/f188:abc123:branch_pushed',
    );
    expect(makeGitRefEntryId({ kind: 'pr_opened', branchName: 'fix/f188', prNumber: 42 })).toBe(
      'git-ref:fix/f188:pr-42:pr_opened',
    );
    expect(makeGitRefEntryId({ kind: 'branch_merged_to_main', branchName: 'fix/f188', prNumber: 42 })).toBe(
      'git-ref:fix/f188:pr-42:branch_merged_to_main',
    );
    expect(
      makeGitRefEntryId({ kind: 'branch_stale_unmerged', branchName: 'fix/f188', headCommitSha: 'abc123', staleBucket: '7d' }),
    ).toBe('git-ref:fix/f188:abc123:branch_stale_unmerged:7d');
  });
});

describe('C26 FeatTrajectoryKeys namespace（store 分桶）', () => {
  it('projection/counts/feats/lastCollectorTickAt key 规范', () => {
    expect(FeatTrajectoryKeys.projection('F233')).toBe('feat-trajectory:projection:F233');
    expect(FeatTrajectoryKeys.countsBySource('event-stream')).toBe('feat-trajectory:counts:event-stream');
    expect(FeatTrajectoryKeys.feats()).toBe('feat-trajectory:feats');
    expect(FeatTrajectoryKeys.lastCollectorTickAt()).toBe('feat-trajectory:last-collector-tick-at');
  });
});
