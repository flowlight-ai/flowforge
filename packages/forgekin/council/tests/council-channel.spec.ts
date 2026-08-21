/**
 * CouncilChannel — T7.5 MindCouncil 跨厂商审议通道聚合与召集验证。
 *
 * 覆盖：
 * - aggregate 聚合裁决全分支（ESCALATE×3 / FAIL 优先 / NEEDS_REVISION 优先 / 加权分阈值）
 * - 同厂商一致意见折扣加权（防 groupthink）
 * - convene 召集（stub 缺省 / 自定义 reviewFn / 人数不足 / 自定义阈值）
 *
 * @module @flowforge/forgekin-council/tests
 */

import { describe, expect, it } from 'vitest';
import { CouncilChannel } from '../src/council-channel.js';
import {
  CouncilReview,
  CouncilReviewer,
  CouncilVerdict,
  makeCouncilReview,
} from '../src/models.js';

function review(vendor: string, verdict: CouncilVerdict, score: number): CouncilReview {
  return makeCouncilReview({
    reviewerId: `fk-${vendor}-${score}`,
    reviewerVendor: vendor,
    verdict,
    score,
  });
}

const reviewer = (forgekinId: string, vendor: string): CouncilReviewer => ({ forgekinId, vendor });

describe('CouncilChannel.aggregate 聚合裁决', () => {
  const channel = new CouncilChannel(); // 默认 2/2/0.85

  it('空审议列表 → ESCALATE 0.0', () => {
    expect(channel.aggregate([])).toEqual({ verdict: CouncilVerdict.ESCALATE, score: 0.0 });
  });

  it('人数 < minReviewers → ESCALATE 0.0', () => {
    const one = [review('openai', CouncilVerdict.PASS, 0.9)];
    expect(channel.aggregate(one)).toEqual({ verdict: CouncilVerdict.ESCALATE, score: 0.0 });
  });

  it('不同厂商数 < minDistinctVendors → ESCALATE 0.0（同厂商 groupthink）', () => {
    const sameVendor = [
      review('openai', CouncilVerdict.PASS, 0.95),
      review('openai', CouncilVerdict.PASS, 0.95),
    ];
    expect(channel.aggregate(sameVendor)).toEqual({ verdict: CouncilVerdict.ESCALATE, score: 0.0 });
  });

  it('任一 FAIL → FAIL（即使其他 PASS 高分）', () => {
    const reviews = [
      review('openai', CouncilVerdict.PASS, 0.98),
      review('anthropic', CouncilVerdict.FAIL, 0.2),
    ];
    const outcome = channel.aggregate(reviews);
    expect(outcome.verdict).toBe(CouncilVerdict.FAIL);
    expect(outcome.score).toBeCloseTo(0.59, 5);
  });

  it('任一 NEEDS_REVISION → NEEDS_REVISION（优先级高于分数）', () => {
    const reviews = [
      review('openai', CouncilVerdict.PASS, 0.98),
      review('anthropic', CouncilVerdict.NEEDS_REVISION, 0.7),
    ];
    const outcome = channel.aggregate(reviews);
    expect(outcome.verdict).toBe(CouncilVerdict.NEEDS_REVISION);
    expect(outcome.score).toBeCloseTo(0.84, 5);
  });

  it('跨厂商全 PASS 且加权分 ≥ 阈值 → PASS', () => {
    const reviews = [
      review('openai', CouncilVerdict.PASS, 0.9),
      review('anthropic', CouncilVerdict.PASS, 0.9),
    ];
    const outcome = channel.aggregate(reviews);
    expect(outcome.verdict).toBe(CouncilVerdict.PASS);
    expect(outcome.score).toBeCloseTo(0.9, 5);
  });

  it('加权分 < 阈值 → NEEDS_REVISION（0.8 < 0.85）', () => {
    const reviews = [
      review('openai', CouncilVerdict.PASS, 0.8),
      review('anthropic', CouncilVerdict.PASS, 0.8),
    ];
    expect(channel.aggregate(reviews)).toEqual({ verdict: CouncilVerdict.NEEDS_REVISION, score: 0.8 });
  });

  it('同厂商折扣：厂商内 reviewer 均分厂商权重（2×openai 0.85 + 1×anthropic 0.9 → 0.875）', () => {
    const reviews = [
      review('openai', CouncilVerdict.PASS, 0.85),
      review('openai', CouncilVerdict.PASS, 0.85),
      review('anthropic', CouncilVerdict.PASS, 0.9),
    ];
    const outcome = channel.aggregate(reviews);
    expect(outcome.verdict).toBe(CouncilVerdict.PASS);
    // openai 权重 0.5/2=0.25 each；anthropic 权重 0.5
    expect(outcome.score).toBeCloseTo(0.85 * 0.25 + 0.85 * 0.25 + 0.9 * 0.5, 5);
  });

  it('自定义阈值：passThreshold=0.95 时 0.9 双 PASS → NEEDS_REVISION', () => {
    const strict = new CouncilChannel({ passThreshold: 0.95 });
    const reviews = [
      review('openai', CouncilVerdict.PASS, 0.9),
      review('anthropic', CouncilVerdict.PASS, 0.9),
    ];
    expect(strict.aggregate(reviews)).toEqual({ verdict: CouncilVerdict.NEEDS_REVISION, score: 0.9 });
  });
});

describe('CouncilChannel.convene 召集会期', () => {
  it('缺省 reviewFn 使用中性 stub（PASS 0.85），跨厂商 → 最终 PASS', () => {
    const channel = new CouncilChannel();
    const session = channel.convene('artifact-x', [
      reviewer('fk-openai', 'openai'),
      reviewer('fk-anthropic', 'anthropic'),
    ]);
    expect(session.reviews).toHaveLength(2);
    expect(session.reviews.every((r) => r.verdict === CouncilVerdict.PASS && r.score === 0.85)).toBe(true);
    expect(session.finalVerdict).toBe(CouncilVerdict.PASS);
    expect(session.finalScore).toBeCloseTo(0.85, 5);
    expect(session.closedAt).toBeDefined();
    expect(session.artifact).toBe('artifact-x');
  });

  it('自定义 reviewFn 被逐 reviewer 调用（push-back 意见透传）', () => {
    const channel = new CouncilChannel();
    const seen: string[] = [];
    const reviewFn = (r: CouncilReviewer, artifact: string): CouncilReview => {
      seen.push(`${r.forgekinId}@${artifact}`);
      return makeCouncilReview({
        reviewerId: r.forgekinId,
        reviewerVendor: r.vendor,
        verdict: CouncilVerdict.NEEDS_REVISION,
        score: 0.6,
        notes: 'push-back: 需补充边界用例',
        pushBackPoints: ['边界用例缺失'],
      });
    };
    const session = channel.convene('artifact-y', [
      reviewer('fk-a', 'openai'),
      reviewer('fk-b', 'anthropic'),
    ], reviewFn);
    expect(seen).toEqual(['fk-a@artifact-y', 'fk-b@artifact-y']);
    expect(session.finalVerdict).toBe(CouncilVerdict.NEEDS_REVISION);
    expect(session.reviews[0]?.pushBackPoints).toEqual(['边界用例缺失']);
  });

  it('审议人数不足时仍收集意见，但聚合裁决 ESCALATE', () => {
    const channel = new CouncilChannel();
    const session = channel.convene('artifact-z', [reviewer('fk-solo', 'openai')]);
    expect(session.reviews).toHaveLength(1);
    expect(session.finalVerdict).toBe(CouncilVerdict.ESCALATE);
    expect(session.finalScore).toBe(0.0);
  });

  it('minReviewers=3 时 2 人审议 → ESCALATE', () => {
    const channel = new CouncilChannel({ minReviewers: 3 });
    const session = channel.convene('artifact-w', [
      reviewer('fk-a', 'openai'),
      reviewer('fk-b', 'anthropic'),
    ]);
    expect(session.finalVerdict).toBe(CouncilVerdict.ESCALATE);
  });
});
