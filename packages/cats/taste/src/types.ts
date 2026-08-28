/**
 * @flowforge/cats-taste — taste 域共享类型与端口（F221 Phase B）。
 *
 * TS 移植自 clowder-ai `domains/taste`：
 * `TasteProposal` 等业务类型复用 `@flowforge/cats-shared`（types/taste-proposal），
 * 本文件仅保留 store 端口契约（ITasteProposalStore + ApprovalPublicationStore
 * 三方法）、repository 端口与 writer 注入函数签名。
 *
 * @module @flowforge/cats-taste/types
 */

import type { ApprovalOriginRef, TasteDimension, TasteProposal } from '@flowforge/cats-shared';

/** Approval Publication 端口（对齐 clowder-ai approval-hub/ports/ApprovalPublicationStore）。 */
export interface ApprovalPublicationStore {
  getPublication(proposalId: string): Promise<import('@flowforge/cats-shared').ApprovalPublication | null>;
  commitEnvelope(
    proposalId: string,
    envelope: import('@flowforge/cats-shared').ApprovalEnvelope,
  ): Promise<void> | void;
  abortStaged(proposalId: string, reason: string): Promise<void> | void;
}

export interface CreateTasteProposalInput {
  /** Pre-generated proposal ID (for dedup coordination with route). When omitted, store generates one. */
  proposalId?: string;
  userId: string;
  catId: string;
  threadId: string;
  sourceMessageId?: string;
  scene: string;
  quote: string;
  tags: string[];
  dimension: TasteDimension;
  privacy: 'public' | 'sensitive';
  clientRequestId?: string;
  approvalOriginRef?: ApprovalOriginRef;
}

export interface TasteWriteCheckpoint {
  vignetteSlug: string;
  vignettePath: string;
}

export interface ITasteProposalStore extends ApprovalPublicationStore {
  /** Create a new pending proposal. */
  create(input: CreateTasteProposalInput): TasteProposal | Promise<TasteProposal>;
  /** Get a single proposal by ID. */
  get(id: string): TasteProposal | null | Promise<TasteProposal | null>;
  /** List pending proposals for a user, ordered by createdAt DESC. */
  listPending(userId: string, limit?: number): TasteProposal[] | Promise<TasteProposal[]>;
  /** List user-actionable proposals, including durable approving states that require resume. */
  listActionable(userId: string, limit?: number): TasteProposal[] | Promise<TasteProposal[]>;
  /** List settled (approved+rejected) proposals for a user, ordered by decidedAt DESC. */
  listSettledByUser(userId: string, limit?: number): TasteProposal[] | Promise<TasteProposal[]>;
  /** CAS pending → approving. Returns claimed snapshot, or null if not pending. */
  claimForApproval(id: string, approvedBy: string): TasteProposal | null | Promise<TasteProposal | null>;
  /** Persist durable writer output while status remains approving (crash-recovery checkpoint). */
  recordWriteCheckpoint(
    id: string,
    checkpoint: TasteWriteCheckpoint,
  ): TasteProposal | null | Promise<TasteProposal | null>;
  /** CAS approving → approved with writer output. Returns updated proposal or null. */
  finalizeApproval(
    id: string,
    approvedBy: string,
    slug: string,
    path: string,
  ): TasteProposal | null | Promise<TasteProposal | null>;
  /** CAS approving → pending. Used when vignette write fails after claim. */
  rollbackClaim(id: string): boolean | Promise<boolean>;
  /** CAS pending → rejected. Returns null if not pending. */
  markRejected(id: string, reason: string, rejectedBy: string): TasteProposal | null | Promise<TasteProposal | null>;
  /** Idempotency: cached proposalId for (userId, clientRequestId). */
  getDedupProposalId(userId: string, clientRequestId: string): string | null | Promise<string | null>;
  /** Idempotency: atomically reserve (userId, clientRequestId) → proposalId. */
  reserveDedup(userId: string, clientRequestId: string, proposalId: string): string | Promise<string>;
  /** Idempotency: release reservation if create failed (conditional on proposalId match). */
  releaseDedup(userId: string, clientRequestId: string, expectedProposalId: string): void | Promise<void>;
}

/**
 * git 执行端口（对齐 `@flowforge/cats-workspace` GitRunner 结构，保持包自包含）。
 * host 注入（测试 / 沙箱 / 记录器），默认 `nodeGitRunner`。
 */
export type GitResult = { ok: true; stdout: string } | { ok: false; err: unknown };

export interface GitRunner {
  exec(args: string[], cwd: string): Promise<GitResult>;
}

/** F221 Canonical Taste repository 端口。 */
export interface TasteRepository {
  canonicalRoot(): Promise<string>;
  approvalLockKey(): Promise<string>;
}

/** vignette 写入器签名（approve 管线注入）。 */
export type VignetteWriterFn = (proposal: TasteProposal) => Promise<{ slug: string; path: string }>;

/**
 * 审批锁端口（对齐 `@flowforge/cats-invocation` SessionMutexService.acquire
 * 形状，结构化兼容，保持包松耦合）。
 */
export interface ApprovalLock {
  acquire(key: string, signal?: AbortSignal): Promise<() => void>;
}
