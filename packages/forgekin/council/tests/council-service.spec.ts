/**
 * CouncilService — T7.5 MindCouncil 审议域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeCouncil 挂载 + 缺省选项（默认阈值 2/2/0.85）
 * - 自定义 channel / 选项注入
 * - convene / aggregate / snapshot 委托
 *
 * @module @flowforge/forgekin-council/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  CouncilChannel,
  CouncilService,
} from '../src/index.js';
import { CouncilVerdict, makeCouncilReview } from '../src/models.js';

describe('CouncilService 插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeCouncil', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeCouncil).toBeInstanceOf(CouncilService);
  });

  it('缺省选项：默认阈值 2/2/0.85', async () => {
    const ctx = new Context();
    await ctx.plugin(CouncilService);
    expect(ctx.forgeCouncil.snapshot()).toEqual({
      minReviewers: 2,
      minDistinctVendors: 2,
      passThreshold: 0.85,
    });
  });

  it('自定义 channel 注入（严格阈值）', async () => {
    const channel = new CouncilChannel({ minReviewers: 3, passThreshold: 0.9 });
    const ctx = new Context();
    await ctx.plugin(CouncilService, { channel });
    expect(ctx.forgeCouncil.channel).toBe(channel);
    expect(ctx.forgeCouncil.snapshot()).toEqual({ minReviewers: 3, minDistinctVendors: 2, passThreshold: 0.9 });
  });

  it('选项阈值透传：minReviewers=3 时 2 人召集 → ESCALATE', async () => {
    const ctx = new Context();
    await ctx.plugin(CouncilService, { minReviewers: 3 });
    const session = ctx.forgeCouncil.convene('artifact', [
      { forgekinId: 'fk-a', vendor: 'openai' },
      { forgekinId: 'fk-b', vendor: 'anthropic' },
    ]);
    expect(session.finalVerdict).toBe(CouncilVerdict.ESCALATE);
  });

  it('aggregate 纯函数委托：跨厂商全 PASS → PASS', async () => {
    const ctx = new Context();
    await ctx.plugin(CouncilService);
    const outcome = ctx.forgeCouncil.aggregate([
      makeCouncilReview({ reviewerId: 'a', reviewerVendor: 'openai', verdict: CouncilVerdict.PASS, score: 0.9 }),
      makeCouncilReview({ reviewerId: 'b', reviewerVendor: 'anthropic', verdict: CouncilVerdict.PASS, score: 0.9 }),
    ]);
    expect(outcome.verdict).toBe(CouncilVerdict.PASS);
  });
});
