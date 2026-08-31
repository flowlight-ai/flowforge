/**
 * @flowforge/infrastructure-grounding — C33 grounding 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/grounding/*`（F167 Phase O PR-O2）：
 *   - types：ClaimType/Verdict 三态/SourceRef/WaitSourceRef/ClaimGroundingEvent 契约
 *   - claim-extractors：hold_ball / register_pr_tracking / register_issue_tracking
 *     三站点的结构化 ClaimInput 提取
 *   - grounding-helpers：resolver 预算（INV-O9 per-invocation）+ INV-O3 高风险
 *     T0/T1 证据要求 + INV-O4 wouldBlock 影子信号
 *   - grounding-checker：影子模式编排（永不阻塞，wouldBlock 记录执法模式行为，
 *     INV-O7 缓存命中不耗预算 / INV-O8 not_applicable 触发下一 resolver）
 *   - grounding-sample-store：有界采样（mismatch 100% / insufficient 3 每天 /
 *     verified 1/N + 日上限）
 *
 * 插件化改造：
 *   - clowder OTel instruments → 注入式 GroundingMetrics（缺省 no-op 计数器，
 *     消费方可接 forgeTelemetry/forgeObservability）
 *   - redis-grounding-sample-store（持久化）随 PR-O4 加固再补
 *
 * @module @flowforge/infrastructure-grounding
 */

import { Context, Service } from '@flowforge/cordis';

import {
  extractHoldBallClaims,
  extractIssueTrackingClaims,
  extractPrTrackingClaims,
  type HoldBallClaimContext,
  type IssueTrackingClaimContext,
  type PrTrackingClaimContext,
} from './claim-extractors.ts';
import {
  computeOverallVerdict,
  computeWouldBlock,
  createResolverBudget,
  DEFAULT_RESOLVER_BUDGET,
  HIGH_RISK_ACTION_FAMILIES,
} from './grounding-helpers.ts';
import { GroundingSampleStore } from './grounding-sample-store.ts';
import type {
  ClaimGroundingEvent,
  ClaimInput,
  ClaimResult,
  GroundingCheckContext,
  GroundingCheckResult,
  ResolverBudget,
  ResolverResult,
  Verdict,
} from './types.ts';

export * from './types.ts';
export {
  computeOverallVerdict,
  computeWouldBlock,
  createResolverBudget,
  DEFAULT_RESOLVER_BUDGET,
  HIGH_RISK_ACTION_FAMILIES,
  INSUFFICIENT_BLOCK_RISKS,
} from './grounding-helpers.ts';
export {
  extractHoldBallClaims,
  extractIssueTrackingClaims,
  extractPrTrackingClaims,
} from './claim-extractors.ts';
export { GroundingSampleStore } from './grounding-sample-store.ts';

// ── Resolver interface ────────────────────────────────────────

export interface Resolver {
  id: string;
  /** Which claim types this resolver handles. */
  applicableClaimTypes: ReadonlySet<string>;
  /** Run the resolver. Returns outcome + metadata. */
  resolve(claim: ClaimInput, ctx: GroundingCheckContext): Promise<ResolverResult>;
}

// ── Metric counter interface (injectable for tests) ───────────

export interface GroundingCounter {
  add(v: number, attrs: Record<string, string>): void;
}

export interface GroundingMetrics {
  checkTotal: GroundingCounter;
  verdictTotal: GroundingCounter;
  resolverTotal: GroundingCounter;
  cacheHitTotal: GroundingCounter;
  budgetExhaustedTotal: GroundingCounter;
}

/** no-op 计数器（缺省；消费方可接 forgeTelemetry / forgeObservability）。 */
const noopMetrics: GroundingMetrics = {
  checkTotal: { add: () => {} },
  verdictTotal: { add: () => {} },
  resolverTotal: { add: () => {} },
  cacheHitTotal: { add: () => {} },
  budgetExhaustedTotal: { add: () => {} },
};

// ── Core checker ──────────────────────────────────────────────

export interface GroundingCheckerOpts {
  resolvers?: Resolver[];
  metrics?: GroundingMetrics;
  budgetTotal?: number;
  /** Override for testing — inject Date.now(). */
  now?: () => number;
}

/**
 * Run grounding checks for all claims in a tool-call context.
 *
 * Shadow mode (PR-O2): always returns, never throws, never blocks.
 */
export async function checkGrounding(
  ctx: GroundingCheckContext,
  opts: GroundingCheckerOpts = {},
): Promise<GroundingCheckResult> {
  const { resolvers = [], metrics = noopMetrics, budgetTotal = DEFAULT_RESOLVER_BUDGET, now = Date.now } = opts;
  const budget = createResolverBudget(budgetTotal);

  metrics.checkTotal.add(1, { 'callback.tool': ctx.tool });

  // INV-O10: read_intent actions skip grounding entirely.
  if (ctx.actionFamily === 'read_intent') {
    return { overallVerdict: 'verified', claimResults: [], wouldBlock: false, resolverCallsConsumed: 0, events: [] };
  }

  const claimResults: ClaimResult[] = [];
  const events: ClaimGroundingEvent[] = [];

  for (const claim of ctx.claims) {
    const result = await resolveClaim(claim, ctx, resolvers, budget, metrics);
    claimResults.push(result);

    // Build event per claim — pick the resolver that produced the actual verdict
    // (last non-not_applicable), not [0] which may be a skipped resolver (INV-O8).
    const bestResolver =
      [...result.resolverResults].reverse().find((r) => r.outcome !== 'not_applicable') ??
      result.resolverResults[0];
    const event: ClaimGroundingEvent = {
      invocationId: ctx.invocationId,
      catId: ctx.catId,
      threadId: ctx.threadId,
      ...(ctx.sourceThreadId !== undefined ? { sourceThreadId: ctx.sourceThreadId } : {}),
      claimType: claim.claimType,
      ...(claim.authSubtype !== undefined ? { authSubtype: claim.authSubtype } : {}),
      sourceKind: claim.sourceKind,
      sourceRef: claim.sourceRef,
      ...(claim.claimSummary !== undefined ? { claimSummary: claim.claimSummary } : {}),
      resolver: bestResolver?.resolver ?? 'none',
      resolverSourceTier: bestResolver?.sourceTier ?? 'T2',
      ...(bestResolver?.freshnessKey !== undefined ? { freshnessKey: bestResolver.freshnessKey } : {}),
      cacheHit: bestResolver?.cacheHit ?? false,
      verdict: result.verdict,
      ...(result.verdictReason !== undefined ? { verdictReason: result.verdictReason } : {}),
      actionFamily: ctx.actionFamily,
      actionRisk: ctx.actionRisk,
      tool: ctx.tool,
      threadKind: ctx.threadKind ?? null,
      ...(claim.waitSourceRef !== undefined ? { waitSourceRef: claim.waitSourceRef } : {}),
      ...(claim.issuerStanding !== undefined ? { issuerStanding: claim.issuerStanding } : {}),
      ts: now(),
      resolverCallsRemaining: budget.remaining(),
    };
    events.push(event);

    metrics.verdictTotal.add(1, {
      'grounding.claim_type': claim.claimType,
      'grounding.verdict': result.verdict,
      'callback.tool': ctx.tool,
    });
  }

  // 无 claims → insufficient（claimType 'none'，不污染 owner 遥测）。
  if (claimResults.length === 0) {
    const verdict: Verdict = 'insufficient';
    metrics.verdictTotal.add(1, {
      'grounding.claim_type': 'none',
      'grounding.verdict': verdict,
      'callback.tool': ctx.tool,
    });
    claimResults.push({
      claim: { claimType: 'none', sourceKind: 'self', sourceRef: { kind: 'messageId', value: '' } },
      resolverResults: [],
      verdict,
      verdictReason: 'no_claims_provided',
    });
  }

  const overallVerdict = computeOverallVerdict(claimResults);
  const wouldBlock = computeWouldBlock(overallVerdict, ctx.actionRisk);

  return {
    overallVerdict,
    claimResults,
    wouldBlock,
    resolverCallsConsumed: budget.consumed,
    events,
  };
}

// ── Claim resolution ──────────────────────────────────────────

async function resolveClaim(
  claim: ClaimInput,
  ctx: GroundingCheckContext,
  resolvers: Resolver[],
  budget: ResolverBudget,
  metrics: GroundingMetrics,
): Promise<ClaimResult> {
  const applicableResolvers = resolvers.filter((r) => r.applicableClaimTypes.has(claim.claimType));

  if (applicableResolvers.length === 0) {
    return { claim, resolverResults: [], verdict: 'insufficient', verdictReason: 'no_applicable_resolver' };
  }

  const resolverResults: ResolverResult[] = [];

  for (const resolver of applicableResolvers) {
    // INV-O7: cache hits bypass budget — try resolver even when budget exhausted.
    const budgetConsumed = budget.consume();

    try {
      const result = await resolver.resolve(claim, ctx);
      resolverResults.push(result);

      metrics.resolverTotal.add(1, { 'grounding.source_tier': result.sourceTier, status: resolver.id });

      if (result.cacheHit) {
        metrics.cacheHitTotal.add(1, { status: resolver.id });
        // INV-O7: cache hits don't consume budget — refund the pre-debit.
        if (budgetConsumed) budget.refund();
      } else if (!budgetConsumed) {
        // Not a cache hit and budget was already exhausted — truly exhausted.
        metrics.budgetExhaustedTotal.add(1, { 'callback.tool': ctx.tool, 'grounding.action_family': ctx.actionFamily });
        return { claim, resolverResults, verdict: 'insufficient', verdictReason: 'resolver_budget_exhausted' };
      }

      // INV-O8: not_applicable → try next resolver
      if (result.outcome === 'not_applicable') continue;

      if (result.outcome === 'verified' || result.outcome === 'mismatch') {
        // INV-O3: high-risk actions with T2-only verified → keep trying for T0/T1.
        if (
          result.outcome === 'verified' &&
          HIGH_RISK_ACTION_FAMILIES.has(ctx.actionFamily) &&
          result.sourceTier === 'T2'
        ) {
          const hasHighTierEvidence = resolverResults.some(
            (r) => r.outcome === 'verified' && (r.sourceTier === 'T0' || r.sourceTier === 'T1'),
          );
          if (!hasHighTierEvidence) continue;
        }
        const claimResult: ClaimResult = { claim, resolverResults, verdict: result.outcome };
        if (result.reason !== undefined) claimResult.verdictReason = result.reason;
        return claimResult;
      }
      // 'insufficient' from a single resolver — continue trying others
    } catch {
      // Resolver threw — treat as not_applicable, try next
      resolverResults.push({
        resolver: resolver.id,
        outcome: 'not_applicable',
        sourceTier: 'T2',
        cacheHit: false,
        reason: 'resolver_error',
      });
      metrics.resolverTotal.add(1, { 'grounding.source_tier': 'T2', status: resolver.id });
      if (!budgetConsumed) {
        metrics.budgetExhaustedTotal.add(1, { 'callback.tool': ctx.tool, 'grounding.action_family': ctx.actionFamily });
        return { claim, resolverResults, verdict: 'insufficient', verdictReason: 'resolver_budget_exhausted' };
      }
    }
  }

  // All resolvers exhausted without definitive answer.
  const hasT2VerifiedHighRisk =
    HIGH_RISK_ACTION_FAMILIES.has(ctx.actionFamily) &&
    resolverResults.some((r) => r.outcome === 'verified' && r.sourceTier === 'T2');

  return {
    claim,
    resolverResults,
    verdict: 'insufficient',
    verdictReason: hasT2VerifiedHighRisk
      ? 'T2_only_on_high_risk'
      : resolverResults.every((r) => r.outcome === 'not_applicable')
        ? 'no_applicable_resolver'
        : 'all_resolvers_inconclusive',
  };
}

// ── Cordis 插件 ─────────────────────────────────────────────

export interface GroundingConfig {
  /** 有界采样存储配置。 */
  sampleStore?: ConstructorParameters<typeof GroundingSampleStore>[0];
  /** 注入式 metrics（缺省 no-op）。 */
  metrics?: GroundingMetrics;
  /** 注入式 resolvers（缺省 []）。 */
  resolvers?: Resolver[];
}

declare module '@flowforge/cordis' {
  interface Context {
    /** grounding 域（C33）：claim 影子核验编排 + 采样存储 */
    forgeGrounding: ForgeGroundingService;
  }
}

/**
 * grounding 域服务 — 挂载 `ctx.forgeGrounding`。
 * 影子模式（PR-O2）：只产出 verdict + wouldBlock + 采样事件，永不阻塞。
 */
export class ForgeGroundingService extends Service {
  readonly sampleStore: GroundingSampleStore;
  private readonly metrics: GroundingMetrics;
  private readonly resolvers: Resolver[];

  constructor(ctx: Context, config: GroundingConfig = {}) {
    super(ctx, 'forgeGrounding');
    this.sampleStore = new GroundingSampleStore(config.sampleStore);
    this.metrics = config.metrics ?? noopMetrics;
    this.resolvers = config.resolvers ?? [];
  }

  /** 运行 claim 影子核验（永不抛出/阻塞）。 */
  check(ctx: GroundingCheckContext, opts: Omit<GroundingCheckerOpts, 'metrics' | 'resolvers'> = {}): Promise<GroundingCheckResult> {
    return checkGrounding(ctx, {
      ...opts,
      resolvers: this.resolvers,
      metrics: this.metrics,
    });
  }

  /** 记录核验事件到采样存储（应用采样规则）。 */
  recordEvents(events: readonly ClaimGroundingEvent[], wouldBlock: boolean): void {
    for (const event of events) this.sampleStore.record(event, wouldBlock);
  }

  extractPrTrackingClaims(c: PrTrackingClaimContext): ClaimInput[] {
    return extractPrTrackingClaims(c);
  }

  extractIssueTrackingClaims(c: IssueTrackingClaimContext): ClaimInput[] {
    return extractIssueTrackingClaims(c);
  }

  extractHoldBallClaims(c: HoldBallClaimContext): ClaimInput[] {
    return extractHoldBallClaims(c);
  }
}

export default ForgeGroundingService;
