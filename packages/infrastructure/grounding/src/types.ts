/**
 * F167 Phase O PR-O2: Claim Grounding Types — 运行时类型契约。
 *
 * TS 移植自 clowder-ai `infrastructure/grounding/types.ts`。
 *
 * @module @flowforge/infrastructure-grounding/types
 */

// ── Enums ──────────────────────────────────────────────────────

export type ClaimType = 'owner' | 'auth' | 'object' | 'wait' | 'route' | 'role' | 'freshness' | 'none';
export type AuthSubtype = 'cvo_signoff' | 'peer_instruction' | 'merge_approval';
export type IssuerStanding = 'cvo' | 'upstream_owner' | 'repo_admin' | 'pr_reviewer' | 'none';
export type SourceKind = 'cross_post' | 'mention' | 'reply_in_thread' | 'cvo_message' | 'webhook' | 'self';
export type ActionFamily =
  | 'read_intent'
  | 'wait'
  | 'register_tracking'
  | 'mutate_local'
  | 'merge'
  | 'cvo_claim'
  | 'takeover'
  | 'irreversible'
  | 'owner_reassignment';
export type ActionRisk = 'read_only' | 'mutate_local' | 'register_tracking' | 'hold_ball' | 'destructive';
export type SourceTier = 'T0' | 'T1' | 'T2';

/** Claim-level verdict (three-state terminal). */
export type Verdict = 'verified' | 'mismatch' | 'insufficient';

/** Per-resolver outcome; 'not_applicable' triggers next-resolver attempt (INV-O8). */
export type ResolverOutcome = Verdict | 'not_applicable';

// ── Source Reference ───────────────────────────────────────────

export interface SourceRef {
  kind: 'messageId' | 'pr_url' | 'issue_id' | 'feature_path' | 'task_id' | 'webhook_id' | 'commit_sha';
  value: string;
  status?: string;
  headSha?: string;
}

// ── WaitSourceRef (R3.1 OQ-5) ─────────────────────────────────

export interface WaitSourceRef {
  kind: 'github_issue' | 'github_comment' | 'thread_message' | 'task' | 'reporter_handle' | 'managed_command';
  value: string;
  /** REQUIRED when kind = 'reporter_handle' */
  anchorRef?: string;
  expectedSignal: string;
  /** REQUIRED — no SLA = no hold, route to needs-info/sweep. */
  slaUntilMs: number;
}

// ── Per-resolver result ───────────────────────────────────────

export interface ResolverResult {
  resolver: string;
  outcome: ResolverOutcome;
  sourceTier: SourceTier;
  freshnessKey?: string;
  cacheHit: boolean;
  reason?: string;
}

// ── Claim Grounding Event ─────────────────────────────────────

export interface ClaimGroundingEvent {
  invocationId: string;
  catId: string;
  threadId: string;
  sourceThreadId?: string;
  claimType: ClaimType;
  authSubtype?: AuthSubtype;
  sourceKind: SourceKind;
  sourceRef: SourceRef;
  claimSummary?: string;
  resolver: string;
  resolverSourceTier: SourceTier;
  freshnessKey?: string;
  cacheHit: boolean;
  verdict: Verdict;
  verdictReason?: string;
  actionFamily: ActionFamily;
  actionRisk: ActionRisk;
  tool: string;
  threadKind?: 'concierge' | 'gate-keeping' | null;
  waitSourceRef?: WaitSourceRef;
  ownershipState?: 'keeper_owned' | 'distributed' | 'unknown';
  issuerStanding?: IssuerStanding;
  keywordHintMatched?: string[];
  ts: number;
  resolverCallsRemaining: number;
}

// ── Grounding Check Context (input to checker) ────────────────

export interface GroundingCheckContext {
  invocationId: string;
  catId: string;
  threadId: string;
  sourceThreadId?: string;
  tool: string;
  actionFamily: ActionFamily;
  actionRisk: ActionRisk;
  threadKind?: 'concierge' | 'gate-keeping' | null;
  claims: ClaimInput[];
}

export interface ClaimInput {
  claimType: ClaimType;
  authSubtype?: AuthSubtype;
  sourceKind: SourceKind;
  sourceRef: SourceRef;
  claimSummary?: string;
  issuerStanding?: IssuerStanding;
  waitSourceRef?: WaitSourceRef;
}

// ── Grounding Check Result (output from checker) ──────────────

export interface GroundingCheckResult {
  overallVerdict: Verdict;
  claimResults: ClaimResult[];
  wouldBlock: boolean;
  resolverCallsConsumed: number;
  events: ClaimGroundingEvent[];
}

export interface ClaimResult {
  claim: ClaimInput;
  resolverResults: ResolverResult[];
  verdict: Verdict;
  verdictReason?: string;
}

// ── Resolver Budget ───────────────────────────────────────────

export interface ResolverBudget {
  total: number;
  consumed: number;
  remaining(): number;
  consume(): boolean;
  /** INV-O7: refund a consumed call (cache hits don't count against budget). */
  refund(): void;
}

// ── Resolver Cache Entry ──────────────────────────────────────

export interface ResolverCacheEntry {
  outcome: ResolverOutcome;
  sourceTier: SourceTier;
  freshnessKey?: string;
  cachedAt: number;
  ttlMs: number;
}
