/**
 * Session family contracts/types + zod schemas (self-contained).
 *
 * Rebuilds the subset of `@cat-cafe/shared` + clowder api-local schemas used by
 * the session REST controllers, with zero references to the original packages.
 */

import { z } from 'zod';

/** Opaque category/system identifier. */
export type CatId = string;

export type SessionStatus = 'active' | 'sealed' | 'completed';

export interface SessionRecord {
  id: string;
  threadId: string;
  catId: CatId;
  userId: string;
  cliSessionId?: string;
  seq: number;
  status: SessionStatus;
  messageCount?: number;
}

export const restoreSessionSchema = z
  .object({
    expectedActiveSessionId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

export type RestoreSessionBody = z.infer<typeof restoreSessionSchema>;

export const bindSessionSchema = z.object({
  cliSessionId: z.string().min(1).max(500),
});

export const sealSchema = z.object({
  cliSessionId: z.string().min(1).max(500),
  reason: z.string().min(1).max(200),
});

export const sopBookmarkSchema = z.object({
  cliSessionId: z.string().min(1).max(500),
  skill: z.string().min(1).max(100),
  sopStage: z.string().min(1).max(100),
});

/** Result of an atomic restore of a historical session as the active one. */
export type RestoreActiveSessionResult =
  | { status: 'restored'; session: SessionRecord; displacedSessionId?: string }
  | { status: 'target_missing' }
  | { status: 'target_not_restorable'; targetStatus: string }
  | { status: 'active_changed'; activeSessionId?: string }
  | { status: 'already_active'; session: SessionRecord };

/** Runtime session metadata (used in session summaries). */
export interface RuntimeSessionMetadata {
  runtime: string;
  runtimeSessionId: string;
  runtimeConversationId?: string;
  lifecycle: {
    state: string;
    lastObservedAt: number;
    retryFragment?: string;
    unexpectedRuntimeSessionSwitch?: number;
  };
}

export interface SessionStrategyConfig {
  /** zod-parsed effective strategy; kept structural for the config controller. */
  strategy: Record<string, any>;
  source: string;
}

/** Agent context capability probe consumed by strategy-config + compaction. */
export interface AgentContextCapability {
  provider: string;
  carrier: string;
  reportsRuntimeWindow: boolean;
  authoritativeUsage: boolean;
  usageTelemetry: 'unavailable' | 'available';
  nativeWindowControl: boolean;
  nativeCompressionControl: boolean;
  observesCompression: boolean;
  reason: string;
}

export interface SessionHandoffProposal {
  proposalId: string;
  catId: CatId;
  threadId: string;
  sourceSessionId?: string;
  status: 'pending' | 'approving' | 'approved' | 'rejected';
  persistedAt?: number;
  done?: string;
  nextSteps?: string;
  worktreeBranch?: string;
  commits?: string[];
  gotchas?: string;
  clientRequestId?: string;
}

export interface ApprovalEnvelope {
  [key: string]: any;
}

export type CallbackPrincipal =
  | { kind: 'agent_key'; agentKey: string }
  | { kind: 'invocation'; userId: string; threadId: string; invocationId: string; catId: CatId };

/** 五件套留盐：handoff propose callback body schema（逐字语义移植）。 */
export const proposeHandoffSchema = z.object({
  done: z.string().trim().min(1).max(2000),
  nextSteps: z.string().trim().min(1).max(2000),
  worktreeBranch: z.string().trim().max(200).optional(),
  commits: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  gotchas: z.string().trim().max(2000).optional(),
  clientRequestId: z.string().min(1).max(200).optional(),
});

export const externalRuntimeListQuerySchema = z.object({
  runtime: z.literal('antigravity-desktop').optional(),
  catId: z.string().min(1).optional(),
  surface: z.enum(['cat-cafe-dispatch', 'ide-direct']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const EXTERNAL_RUNTIME_SESSION_LIST_PAGE_SIZE = 200;

/** Generate a stable proposal id from a seed (host provides crypto in EP2). */
export function generateProposalId(seed: string): string {
  return `proposal_${seed}`;
}