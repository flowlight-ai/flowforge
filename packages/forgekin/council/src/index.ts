/**
 * @flowforge/forgekin-council — 阶段7 T7.5 MindCouncil 跨厂商审议域 Cordis 插件
 *
 * 挂载 `ctx.forgeCouncil`：CouncilChannel 跨厂商审议（min_reviewers /
 * min_distinct_vendors / pass_threshold 强制 + 同厂商折扣 + push-back 权利）。
 * 对齐 Python `forgemind/council.py`。
 */
import { Context, Service } from '@flowforge/cordis';
import { CouncilChannel, CouncilChannelOptions } from './council-channel.js';
import {
  CouncilReview,
  CouncilReviewer,
  CouncilReviewFn,
  CouncilSession,
  CouncilVerdict,
} from './models.js';

export * from './models.js';
export * from './council-channel.js';

export interface CouncilServiceOptions extends CouncilChannelOptions {
  /** 审议通道（缺省新建） */
  readonly channel?: CouncilChannel | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 跨厂商审议域：MindCouncil 审议通道 */
    forgeCouncil: CouncilService;
  }
}

export class CouncilService extends Service {
  readonly channel: CouncilChannel;

  constructor(ctx: Context, options: CouncilServiceOptions = {}) {
    super(ctx, 'forgeCouncil');
    this.channel = options.channel ?? new CouncilChannel({
      minReviewers: options.minReviewers,
      minDistinctVendors: options.minDistinctVendors,
      passThreshold: options.passThreshold,
    });
  }

  /** 召集一次审议会期（reviewFn 缺省使用中性 stub） */
  convene(artifact: string, reviewers: CouncilReviewer[], reviewFn?: CouncilReviewFn): CouncilSession {
    return this.channel.convene(artifact, reviewers, reviewFn);
  }

  /** 聚合裁决（纯函数） */
  aggregate(reviews: CouncilReview[]): { verdict: CouncilVerdict; score: number } {
    return this.channel.aggregate(reviews);
  }

  /** 审议会期快照（trace 日志） */
  snapshot(): { minReviewers: number; minDistinctVendors: number; passThreshold: number } {
    return {
      minReviewers: this.channel.minReviewers,
      minDistinctVendors: this.channel.minDistinctVendors,
      passThreshold: this.channel.passThreshold,
    };
  }
}

export default function Plugin(ctx: Context, options?: CouncilServiceOptions) {
  return ctx.plugin(CouncilService, options);
}
