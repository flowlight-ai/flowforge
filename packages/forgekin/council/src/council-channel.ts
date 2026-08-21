/**
 * CouncilChannel — 跨厂商审议通道（对齐 Python `forgemind/council.py`）。
 *
 * 厂商感知聚合：同厂商一致意见折扣，PASS 需 ≥2 个不同厂商。
 * 裁决优先级：FAIL > NEEDS_REVISION > 加权分 ≥ pass_threshold → PASS，否则 NEEDS_REVISION。
 */
import {
  CouncilReview,
  CouncilReviewer,
  CouncilReviewFn,
  CouncilSession,
  CouncilVerdict,
  makeCouncilReview,
  makeCouncilSession,
} from './models.js';

export interface CouncilChannelOptions {
  /** 最少审议人数（不足 → ESCALATE） */
  readonly minReviewers?: number | undefined;
  /** 最少不同厂商数（不足 → ESCALATE） */
  readonly minDistinctVendors?: number | undefined;
  /** PASS 加权分数阈值 */
  readonly passThreshold?: number | undefined;
}

export interface AggregateOutcome {
  readonly verdict: CouncilVerdict;
  readonly score: number;
}

export class CouncilChannel {
  readonly minReviewers: number;
  readonly minDistinctVendors: number;
  readonly passThreshold: number;

  constructor(options: CouncilChannelOptions = {}) {
    this.minReviewers = options.minReviewers ?? 2;
    this.minDistinctVendors = options.minDistinctVendors ?? 2;
    this.passThreshold = options.passThreshold ?? 0.85;
  }

  /**
   * 召集一次审议会期。reviewFn 缺省时使用中性 stub（PASS 0.85），便于不调用真实 LLM 测试聚合逻辑。
   * 审议人数不足时记录 warning，但聚合阶段会强制 ESCALATE。
   */
  convene(artifact: string, reviewers: CouncilReviewer[], reviewFn?: CouncilReviewFn | undefined): CouncilSession {
    const session = makeCouncilSession({ artifact });
    if (reviewers.length < this.minReviewers) {
      // 审议人数不足：仍收集意见，聚合阶段裁决 ESCALATE
    }
    for (const reviewer of reviewers) {
      const review = reviewFn
        ? reviewFn(reviewer, artifact)
        : makeCouncilReview({
          reviewerId: reviewer.forgekinId,
          reviewerVendor: reviewer.vendor,
          verdict: CouncilVerdict.PASS,
          score: 0.85,
          notes: 'default stub review',
        });
      session.reviews.push(review);
    }
    const outcome = this.aggregate(session.reviews);
    return makeCouncilSession({
      ...session,
      finalVerdict: outcome.verdict,
      finalScore: outcome.score,
      closedAt: new Date().toISOString(),
    });
  }

  /**
   * 聚合裁决（纯函数，不修改输入）。
   * - 空或人数 < minReviewers → ESCALATE 0.0
   * - 不同厂商数 < minDistinctVendors → ESCALATE 0.0
   * - 厂商权重 = 1/厂商数；厂商内多个 reviewer 均分该厂商权重
   * - 任一 FAIL → FAIL；任一 NEEDS_REVISION → NEEDS_REVISION
   * - 加权分 ≥ passThreshold → PASS；否则 NEEDS_REVISION
   */
  aggregate(reviews: CouncilReview[]): AggregateOutcome {
    if (reviews.length === 0) {
      return { verdict: CouncilVerdict.ESCALATE, score: 0.0 };
    }
    if (reviews.length < this.minReviewers) {
      return { verdict: CouncilVerdict.ESCALATE, score: 0.0 };
    }
    const distinctVendors = new Set(reviews.map((r) => r.reviewerVendor));
    if (distinctVendors.size < this.minDistinctVendors) {
      return { verdict: CouncilVerdict.ESCALATE, score: 0.0 };
    }

    // 厂商权重均分：vendor_weight = 1/厂商数，厂商内 reviewer 均分该权重
    const vendorWeight = 1.0 / distinctVendors.size;
    const perVendorCount = new Map<string, number>();
    for (const r of reviews) {
      perVendorCount.set(r.reviewerVendor, (perVendorCount.get(r.reviewerVendor) ?? 0) + 1);
    }
    let weightedSum = 0.0;
    for (const r of reviews) {
      const weight = vendorWeight / (perVendorCount.get(r.reviewerVendor) ?? 1);
      weightedSum += r.score * weight;
    }

    if (reviews.some((r) => r.verdict === CouncilVerdict.FAIL)) {
      return { verdict: CouncilVerdict.FAIL, score: weightedSum };
    }
    if (reviews.some((r) => r.verdict === CouncilVerdict.NEEDS_REVISION)) {
      return { verdict: CouncilVerdict.NEEDS_REVISION, score: weightedSum };
    }
    if (weightedSum >= this.passThreshold) {
      return { verdict: CouncilVerdict.PASS, score: weightedSum };
    }
    return { verdict: CouncilVerdict.NEEDS_REVISION, score: weightedSum };
  }
}
