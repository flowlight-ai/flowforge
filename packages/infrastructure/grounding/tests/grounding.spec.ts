/**
 * grounding 插件包测试 — C33（F167 Phase O PR-O2 影子核验）。
 *
 * 覆盖：resolver 预算（consume/refund/耗尽）+ verdict 聚合 + wouldBlock 风险表；
 * claim extractors（PR/Issue tracking + hold_ball 结构化/非结构化哨兵）；
 * checkGrounding 编排（read_intent 跳过 INV-O10 / 无适用 resolver /
 * not_applicable 触发下一 resolver INV-O8 / 缓存命中退款 INV-O7 / 预算耗尽 /
 * 高风险 T2-only INV-O3 / 解析器异常 / 无 claims insufficient）；
 * 采样存储（mismatch 100% / insufficient 3 每天 / verified 采样率+日上限）；
 * Cordis 插件挂载。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeGroundingService, {
  checkGrounding,
  computeOverallVerdict,
  computeWouldBlock,
  createResolverBudget,
  extractHoldBallClaims,
  extractIssueTrackingClaims,
  extractPrTrackingClaims,
  GroundingSampleStore,
  type ClaimInput,
  type GroundingCheckContext,
  type Resolver,
  type ResolverResult,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

function makeCtx(overrides: Partial<GroundingCheckContext> = {}): GroundingCheckContext {
  return {
    invocationId: 'inv-1',
    catId: 'cat-a',
    threadId: 't1',
    tool: 'hold_ball',
    actionFamily: 'wait',
    actionRisk: 'hold_ball',
    claims: [],
    ...overrides,
  };
}

function resolver(id: string, claimTypes: string[], outcome: ResolverResult['outcome'], extra: Partial<ResolverResult> = {}): Resolver {
  return {
    id,
    applicableClaimTypes: new Set(claimTypes),
    resolve: async () => ({
      resolver: id,
      outcome,
      sourceTier: 'T1',
      cacheHit: false,
      ...extra,
    }),
  };
}

describe('grounding-helpers', () => {
  it('预算：consume/refund/耗尽', () => {
    const b = createResolverBudget(2);
    expect(b.remaining()).toBe(2);
    expect(b.consume()).toBe(true);
    b.refund();
    expect(b.remaining()).toBe(2);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
  });

  it('verdict 聚合：mismatch > insufficient > verified', () => {
    const mk = (verdict: 'verified' | 'mismatch' | 'insufficient') =>
      ({ claim: {} as ClaimInput, resolverResults: [], verdict }) as never;
    expect(computeOverallVerdict([mk('verified'), mk('insufficient')])).toBe('insufficient');
    expect(computeOverallVerdict([mk('verified'), mk('mismatch')])).toBe('mismatch');
    expect(computeOverallVerdict([mk('verified')])).toBe('verified');
  });

  it('wouldBlock：mismatch 恒真；insufficient 仅限阻断类风险', () => {
    expect(computeWouldBlock('mismatch', 'read_only')).toBe(true);
    expect(computeWouldBlock('insufficient', 'destructive')).toBe(true);
    expect(computeWouldBlock('insufficient', 'hold_ball')).toBe(true);
    expect(computeWouldBlock('insufficient', 'read_only')).toBe(false);
    expect(computeWouldBlock('verified', 'destructive')).toBe(false);
  });
});

describe('claim-extractors', () => {
  it('PR / Issue tracking 单 claim', () => {
    const pr = extractPrTrackingClaims({ repoFullName: 'o/r', prNumber: 1 });
    expect(pr[0]?.sourceRef).toEqual({ kind: 'pr_url', value: 'o/r#1' });
    const issue = extractIssueTrackingClaims({ repoFullName: 'o/r', issueNumber: 2 });
    expect(issue[0]?.sourceRef).toEqual({ kind: 'issue_id', value: 'o/r#2' });
  });

  it('hold_ball：结构化 waitSourceRef 映射 + 非结构化哨兵', () => {
    const grounded = extractHoldBallClaims({
      reason: '等待 CI',
      waitSourceRef: { kind: 'github_issue', value: 'o/r#9', expectedSignal: 'closed', slaUntilMs: 1 },
    });
    expect(grounded[0]?.sourceRef.kind).toBe('issue_id');
    const narrative = extractHoldBallClaims({
      reason: '等报告人',
      waitSourceRef: { kind: 'reporter_handle', value: '@alice', anchorRef: 'msg-1', expectedSignal: 'reply', slaUntilMs: 1 },
    });
    expect(narrative[0]?.sourceRef).toMatchObject({ kind: 'messageId', value: 'msg-1' });
    const ungrounded = extractHoldBallClaims({ reason: '不知道等啥' });
    expect(ungrounded[0]?.sourceRef).toEqual({ kind: 'messageId', value: 'unstructured-wait' });
  });
});

describe('checkGrounding', () => {
  it('INV-O10：read_intent 直接 verified 跳过', async () => {
    const r = await checkGrounding(makeCtx({ actionFamily: 'read_intent', actionRisk: 'read_only', claims: [{} as ClaimInput] }));
    expect(r.overallVerdict).toBe('verified');
    expect(r.claimResults.length).toBe(0);
    expect(r.resolverCallsConsumed).toBe(0);
  });

  it('INV-O8：not_applicable 触发下一 resolver；definitive 后停止', async () => {
    const order: string[] = [];
    const r1: Resolver = { id: 'a', applicableClaimTypes: new Set(['wait']), resolve: async () => { order.push('a'); return { resolver: 'a', outcome: 'not_applicable', sourceTier: 'T2', cacheHit: false }; } };
    const r2: Resolver = { id: 'b', applicableClaimTypes: new Set(['wait']), resolve: async () => { order.push('b'); return { resolver: 'b', outcome: 'verified', sourceTier: 'T1', cacheHit: false }; } };
    const r = await checkGrounding(makeCtx({ claims: [{ claimType: 'wait', sourceKind: 'self', sourceRef: { kind: 'messageId', value: 'm1' } }] }), { resolvers: [r1, r2] });
    expect(order).toEqual(['a', 'b']);
    expect(r.overallVerdict).toBe('verified');
    expect(r.claimResults[0]?.verdictReason).toBeUndefined();
  });

  it('INV-O7：缓存命中退款；无命中预算耗尽 → insufficient', async () => {
    const cacheHit: Resolver = { id: 'c', applicableClaimTypes: new Set(['wait']), resolve: async () => ({ resolver: 'c', outcome: 'verified', sourceTier: 'T0', cacheHit: true }) };
    const r = await checkGrounding(makeCtx({ claims: [{ claimType: 'wait', sourceKind: 'self', sourceRef: { kind: 'messageId', value: 'm' } }] }), { resolvers: [cacheHit], budgetTotal: 0 });
    expect(r.overallVerdict).toBe('verified');
    expect(r.resolverCallsConsumed).toBe(0);

    // budget=1：第一个 resolver 消耗预算并返回 insufficient → 继续；第二个
    // resolver 时预算已尽且非缓存命中 → resolver_budget_exhausted
    const slow: Resolver = { id: 's', applicableClaimTypes: new Set(['wait']), resolve: async () => ({ resolver: 's', outcome: 'insufficient', sourceTier: 'T2', cacheHit: false }) };
    const slow2: Resolver = { id: 's2', applicableClaimTypes: new Set(['wait']), resolve: async () => ({ resolver: 's2', outcome: 'insufficient', sourceTier: 'T2', cacheHit: false }) };
    const r2 = await checkGrounding(makeCtx({ claims: [{ claimType: 'wait', sourceKind: 'self', sourceRef: { kind: 'messageId', value: 'm' } }] }), { resolvers: [slow, slow2], budgetTotal: 1 });
    expect(r2.overallVerdict).toBe('insufficient');
    expect(r2.claimResults[0]?.verdictReason).toBe('resolver_budget_exhausted');
  });

  it('INV-O3：高风险动作 T2-only verified → 继续 → T2_only_on_high_risk', async () => {
    const t2: Resolver = { id: 't2', applicableClaimTypes: new Set(['object']), resolve: async () => ({ resolver: 't2', outcome: 'verified', sourceTier: 'T2', cacheHit: false }) };
    const r = await checkGrounding(
      makeCtx({ actionFamily: 'merge', actionRisk: 'destructive', claims: [{ claimType: 'object', sourceKind: 'self', sourceRef: { kind: 'pr_url', value: 'o/r#1' } }] }),
      { resolvers: [t2] },
    );
    expect(r.overallVerdict).toBe('insufficient');
    expect(r.claimResults[0]?.verdictReason).toBe('T2_only_on_high_risk');
  });

  it('无 claims → insufficient(no_claims_provided)；claimType=none', async () => {
    const r = await checkGrounding(makeCtx());
    expect(r.overallVerdict).toBe('insufficient');
    expect(r.claimResults[0]?.claim.claimType).toBe('none');
    expect(r.claimResults[0]?.verdictReason).toBe('no_claims_provided');
  });

  it('resolver 异常 → not_applicable(resolver_error) → 继续', async () => {
    const boom: Resolver = { id: 'boom', applicableClaimTypes: new Set(['wait']), resolve: async () => { throw new Error('x'); } };
    const ok: Resolver = { id: 'ok', applicableClaimTypes: new Set(['wait']), resolve: async () => ({ resolver: 'ok', outcome: 'verified', sourceTier: 'T1', cacheHit: false }) };
    const r = await checkGrounding(makeCtx({ claims: [{ claimType: 'wait', sourceKind: 'self', sourceRef: { kind: 'messageId', value: 'm' } }] }), { resolvers: [boom, ok] });
    expect(r.overallVerdict).toBe('verified');
    expect(r.claimResults[0]?.resolverResults[0]?.reason).toBe('resolver_error');
  });
});

describe('GroundingSampleStore', () => {
  function event(verdict: 'verified' | 'mismatch' | 'insufficient', resolver = 'r1', ts = Date.now()) {
    return {
      invocationId: 'i', catId: 'c', threadId: 't1', claimType: 'wait' as const, sourceKind: 'self' as const,
      sourceRef: { kind: 'messageId' as const, value: 'm' }, resolver, resolverSourceTier: 'T1' as const,
      cacheHit: false, verdict, actionFamily: 'wait' as const, actionRisk: 'hold_ball' as const, tool: 'hold_ball', ts, resolverCallsRemaining: 0,
    };
  }

  it('mismatch/wouldBlock 100% 保留；insufficient 上限；verified 采样保留', () => {
    const store = new GroundingSampleStore({ maxTotal: 10, insufficientCap: 2, shouldSampleVerified: () => true });
    store.record(event('mismatch'), false); // keep
    store.record(event('verified'), true); // wouldBlock → keep
    store.record(event('insufficient'), false); // keep (1/2)
    store.record(event('insufficient'), false); // keep (2/2)
    store.record(event('insufficient'), false); // 超上限 → drop
    store.record(event('verified'), false); // 采样命中 → keep
    expect(store.getStats().stored).toBe(5);
    expect(store.getStats().dropped).toBe(1);
  });

  it('FIFO 驱逐：超 maxTotal 淘汰最旧', () => {
    const store = new GroundingSampleStore({ maxTotal: 2, shouldSampleVerified: () => true });
    store.record(event('mismatch', 'r1'), false);
    store.record(event('mismatch', 'r2'), false);
    store.record(event('mismatch', 'r3'), false);
    expect(store.getStats().stored).toBe(2);
    expect(store.getSamples()[0]?.resolver).toBe('r2');
  });

  it('verified 采样率未命中 → drop；日上限', () => {
    const store = new GroundingSampleStore({ shouldSampleVerified: () => false, verifiedDailyCap: 1 });
    store.record(event('verified'), false);
    expect(store.getStats().stored).toBe(0);
    const capStore = new GroundingSampleStore({ shouldSampleVerified: () => true, verifiedDailyCap: 1 });
    capStore.record(event('verified', 'r1'), false);
    capStore.record(event('verified', 'r2'), false);
    expect(capStore.getStats().stored).toBe(1);
    expect(capStore.getStats().dropped).toBe(1);
  });
});

describe('ForgeGroundingService（Cordis 插件）', () => {
  it('挂载 ctx.forgeGrounding + check + recordEvents + extractors', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeGroundingService, {
      resolvers: [resolver('base', ['wait'], 'verified')],
      sampleStore: { shouldSampleVerified: () => true },
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    const svc = ctx.forgeGrounding;
    const claims = svc.extractHoldBallClaims({
      reason: '等待',
      waitSourceRef: { kind: 'task', value: 'task-1', expectedSignal: 'done', slaUntilMs: 1 },
    });
    const result = await svc.check(makeCtx({ claims }));
    expect(result.overallVerdict).toBe('verified');
    expect(result.wouldBlock).toBe(false);

    svc.recordEvents(result.events, result.wouldBlock);
    expect(svc.sampleStore.getStats().stored).toBe(1);
    expect(svc.extractPrTrackingClaims({ repoFullName: 'o/r', prNumber: 1 }).length).toBe(1);
    expect(svc.extractIssueTrackingClaims({ repoFullName: 'o/r', issueNumber: 2 }).length).toBe(1);
  });
});
