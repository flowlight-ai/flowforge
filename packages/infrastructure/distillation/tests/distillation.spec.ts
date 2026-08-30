/**
 * distillation 插件包测试 — C33（F208 Phase E AC-E2）。
 *
 * 覆盖：feat-phase-close 机会创建 + 幂等 + inFlight 去重；
 * review-complete 机会创建 + 幂等；listPending/dismiss/markConverted；
 * Cordis 插件挂载 ctx.forgeDistillation。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeDistillationService, {
  InMemoryOpportunityStore,
  type IOpportunityStore,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('DistillationCheckpoint', () => {
  it('feat-phase-close → 创建机会 + 幂等不重复 + inFlight 去重', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDistillationService, {})) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const svc = ctx.forgeDistillation;

    const featCtx = {
      prNumber: 42,
      repoFullName: 'flowlight/flowforge',
      authorCatId: 'cat-a',
      threadId: 't1',
      featureId: 'F100',
      phaseLabel: 'dev',
    };
    const r1 = await svc.onFeatPhaseClose(featCtx);
    expect(r1.fired).toBe(true);
    // 幂等：相同 sourceId 不重复
    const r2 = await svc.onFeatPhaseClose(featCtx);
    expect(r2.fired).toBe(false);
    // inFlight 去重：并发同 sourceId 返回同一 promise
    const p1 = svc.onFeatPhaseClose({ ...featCtx, featureId: 'F200' });
    const p2 = svc.onFeatPhaseClose({ ...featCtx, featureId: 'F200' });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toEqual(b);
    expect(a.fired).toBe(true);

    const pending = await svc.listPending();
    expect(pending.length).toBe(2);
  });

  it('review-complete → 创建机会 + 幂等', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDistillationService, {})) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const svc = ctx.forgeDistillation;

    const revCtx = {
      prNumber: 7,
      repoFullName: 'flowlight/flowforge',
      reviewerCatId: 'reviewer-x',
      authorCatId: 'cat-b',
      threadId: 't2',
    };
    const r1 = await svc.onReviewComplete(revCtx);
    expect(r1.fired).toBe(true);
    const r2 = await svc.onReviewComplete(revCtx);
    expect(r2.fired).toBe(false);
    expect((await svc.listPending()).length).toBe(1);
  });

  it('dismiss / markConverted 状态流转', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDistillationService, {})) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const svc = ctx.forgeDistillation;

    await svc.onReviewComplete({
      prNumber: 1,
      repoFullName: 'r',
      reviewerCatId: 'rv',
      authorCatId: 'au',
      threadId: 't',
    });
    const pending = await svc.listPending();
    expect(pending.length).toBe(1);
    const opp = pending[0]!;
    expect(await svc.dismiss(opp.opportunityId)).toBe(true);
    expect((await svc.listPending()).length).toBe(0);
    // 已 dismiss 不可再转换
    expect(await svc.markConverted(opp.opportunityId, 'p1')).toBe(false);
  });

  it('注入式 IOpportunityStore 替换缺省 InMemory', async () => {
    const custom: IOpportunityStore = {
      getBySourceId: async () => null,
      create: async (input) => ({ ...input, opportunityId: 'custom-1', createdAt: 0 }),
      listPending: async () => [],
      dismiss: async () => false,
      markConverted: async () => false,
    };
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDistillationService, { store: custom })) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const r = await ctx.forgeDistillation.onReviewComplete({
      prNumber: 1,
      repoFullName: 'r',
      reviewerCatId: 'rv',
      authorCatId: 'au',
      threadId: 't',
    });
    expect(r.fired).toBe(true);
    expect((await ctx.forgeDistillation.listPending()).length).toBe(0);
  });
});

describe('InMemoryOpportunityStore', () => {
  it('create + getBySourceId + listPending + dismiss + markConverted', async () => {
    const store = new InMemoryOpportunityStore();
    const created = await store.create({
      sourceEvent: 'feat-phase-close',
      sourceId: 's1',
      targetCatId: 'c',
      prNumber: 1,
      repoFullName: 'r',
      threadId: 't',
      status: 'pending',
      metadata: {},
    });
    expect(created.opportunityId).toMatch(/^opp-/);
    expect(await store.getBySourceId('s1')).toBeDefined();
    expect((await store.listPending()).length).toBe(1);
    expect(await store.dismiss(created.opportunityId)).toBe(true);
    expect(await store.dismiss(created.opportunityId)).toBe(false);
  });
});
