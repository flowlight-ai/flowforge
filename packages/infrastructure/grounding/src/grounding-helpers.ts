/**
 * F167 Phase O: Grounding helpers — budget、常量、verdict 聚合。
 *
 * 移植自 clowder-ai `infrastructure/grounding/grounding-helpers.ts`。
 */

import type { ActionRisk, ClaimResult, ResolverBudget, Verdict } from './types.ts';

// ── Constants ─────────────────────────────────────────────────

/** Default resolver budget per grounding check (INV-O9: per-invocation). */
export const DEFAULT_RESOLVER_BUDGET = 15;

/** High-risk action families requiring T0/T1 evidence for 'verified' (INV-O3). */
export const HIGH_RISK_ACTION_FAMILIES: ReadonlySet<string> = new Set([
  'merge',
  'cvo_claim',
  'takeover',
  'irreversible',
  'owner_reassignment',
]);

/**
 * Action risks where insufficient evidence would trigger a block (shadow signal).
 * Not just destructive — register_tracking (ungrounded tracking) and hold_ball
 * (ungrounded wait) also need enforcement (Cloud R6 P2-2).
 */
export const INSUFFICIENT_BLOCK_RISKS: ReadonlySet<ActionRisk> = new Set([
  'destructive',
  'register_tracking',
  'hold_ball',
]);

// ── Budget implementation ─────────────────────────────────────

export function createResolverBudget(total: number = DEFAULT_RESOLVER_BUDGET): ResolverBudget {
  let consumed = 0;
  return {
    total,
    get consumed() {
      return consumed;
    },
    remaining() {
      return Math.max(0, total - consumed);
    },
    consume() {
      if (consumed >= total) return false;
      consumed++;
      return true;
    },
    /** INV-O7: refund a consumed call (cache hits don't count against budget). */
    refund() {
      if (consumed > 0) consumed--;
    },
  };
}

// ── Verdict aggregation ───────────────────────────────────────

export function computeOverallVerdict(results: ClaimResult[]): Verdict {
  if (results.some((r) => r.verdict === 'mismatch')) return 'mismatch';
  if (results.some((r) => r.verdict === 'insufficient')) return 'insufficient';
  return 'verified';
}

/** INV-O4: wouldBlock shadow signal for enforcement preview. */
export function computeWouldBlock(verdict: Verdict, actionRisk: ActionRisk): boolean {
  if (verdict === 'mismatch') return true;
  if (verdict === 'insufficient' && INSUFFICIENT_BLOCK_RISKS.has(actionRisk)) return true;
  return false;
}
