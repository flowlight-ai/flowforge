/**
 * F167 Phase O PR-O2b: Claim Extractors — 从工具调用上下文提取结构化 ClaimInput。
 *
 * 移植自 clowder-ai `infrastructure/grounding/claim-extractors.ts`。
 */

import type { ClaimInput, SourceRef, WaitSourceRef } from './types.ts';

const CLAIM_SUMMARY_MAX = 200;

/** WaitSourceRef kind → SourceRef kind mapping */
const WAIT_SOURCE_TO_SOURCE_REF: Record<WaitSourceRef['kind'], SourceRef['kind']> = {
  github_issue: 'issue_id',
  github_comment: 'issue_id',
  thread_message: 'messageId',
  task: 'task_id',
  // Narrative kinds use anchorRef as the sourceRef value.
  reporter_handle: 'messageId',
  // F167 Phase P: managed command runner — maps to webhook_id.
  managed_command: 'webhook_id',
};

/** Narrative wait kinds that use anchorRef instead of value for sourceRef. */
const NARRATIVE_WAIT_KINDS: ReadonlySet<WaitSourceRef['kind']> = new Set(['reporter_handle']);

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// ── PR Tracking ──────────────────────────────────────────────

export interface PrTrackingClaimContext {
  repoFullName: string;
  prNumber: number;
}

export function extractPrTrackingClaims(ctx: PrTrackingClaimContext): ClaimInput[] {
  const ref = `${ctx.repoFullName}#${ctx.prNumber}`;
  return [
    {
      claimType: 'object',
      sourceKind: 'self',
      sourceRef: { kind: 'pr_url', value: ref },
      claimSummary: truncate(`PR ${ref} exists and is trackable`, CLAIM_SUMMARY_MAX),
    },
  ];
}

// ── Issue Tracking ───────────────────────────────────────────

export interface IssueTrackingClaimContext {
  repoFullName: string;
  issueNumber: number;
}

export function extractIssueTrackingClaims(ctx: IssueTrackingClaimContext): ClaimInput[] {
  const ref = `${ctx.repoFullName}#${ctx.issueNumber}`;
  return [
    {
      claimType: 'object',
      sourceKind: 'self',
      sourceRef: { kind: 'issue_id', value: ref },
      claimSummary: truncate(`Issue ${ref} exists and is trackable`, CLAIM_SUMMARY_MAX),
    },
  ];
}

// ── Hold Ball ────────────────────────────────────────────────

export interface HoldBallClaimContext {
  reason: string;
  waitSourceRef?: WaitSourceRef;
}

export function extractHoldBallClaims(ctx: HoldBallClaimContext): ClaimInput[] {
  if (ctx.waitSourceRef) {
    const wsr = ctx.waitSourceRef;
    const refKind = WAIT_SOURCE_TO_SOURCE_REF[wsr.kind]!;
    // Narrative kind (reporter_handle) uses anchorRef as the sourceRef value.
    const refValue = NARRATIVE_WAIT_KINDS.has(wsr.kind) && wsr.anchorRef ? wsr.anchorRef : wsr.value;
    return [
      {
        claimType: 'wait',
        sourceKind: 'self',
        sourceRef: { kind: refKind, value: refValue },
        claimSummary: truncate(`wait: ${ctx.reason}`, CLAIM_SUMMARY_MAX),
        waitSourceRef: wsr,
      },
    ];
  }
  // 无结构化 waitSourceRef — ungrounded wait（仅 reason 文本）。
  // 哨兵值满足 INV-O1（kind + value 非空）并在 shadow 遥测中标记"无真实锚点"。
  return [
    {
      claimType: 'wait',
      sourceKind: 'self',
      sourceRef: { kind: 'messageId', value: 'unstructured-wait' },
      claimSummary: truncate(`wait: ${ctx.reason}`, CLAIM_SUMMARY_MAX),
    },
  ];
}
