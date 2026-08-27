/**
 * @flowforge/cats-taste — Locked, checkpointed F221 approval pipeline。
 *
 * TS 移植自 clowder-ai `domains/taste/services/approveTasteProposal.ts`（原样保留）：
 * durable Git 提交与提案终态是两套系统，writer 结果在提案保持 `approving` 时
 * checkpoint；重试要么检测到已提交的 vignette，要么跳过 writer 直接恢复，
 * 对齐 F231 的 crash-recovery 形状。
 *
 * 插件化改造：`SessionMutex` 替换为本地 `ApprovalLock` 端口（结构化兼容
 * `@flowforge/cats-invocation` SessionMutexService.acquire），`ITasteProposalStore`
 * 与 `VignetteWriterFn` 均走端口注入。
 *
 * @module @flowforge/cats-taste/approve-taste-proposal
 */

import type { TasteProposal } from '@flowforge/cats-shared';
import type { ApprovalLock, ITasteProposalStore, VignetteWriterFn } from './types.js';

export type ApproveTasteProposalResult =
  | { ok: true; proposal: TasteProposal; recovered: boolean }
  | {
      ok: false;
      reason: 'not_found' | 'rejected' | 'claim_lost' | 'write_failed';
      error?: string;
      proposal?: TasteProposal;
    };

export interface ApproveTasteProposalDeps {
  store: ITasteProposalStore;
  lock: ApprovalLock;
  lockKey: () => string;
  writeVignette: VignetteWriterFn;
}

type PreparedApproval = { ok: true; proposal: TasteProposal; recovered: boolean };
type CheckpointedApproval = { ok: true; proposal: TasteProposal };
type StageExit = { ok: false; result: ApproveTasteProposalResult };

export async function approveTasteProposal(
  proposalId: string,
  approvedBy: string,
  deps: ApproveTasteProposalDeps,
  signal?: AbortSignal,
): Promise<ApproveTasteProposalResult> {
  const peek = await deps.store.get(proposalId);
  if (!peek) return { ok: false, reason: 'not_found' };
  if (peek.status === 'approved') return { ok: true, proposal: peek, recovered: false };
  if (peek.status === 'rejected') return { ok: false, reason: 'rejected', proposal: peek };

  let lockKey: string;
  try {
    lockKey = deps.lockKey();
  } catch (err) {
    return { ok: false, reason: 'write_failed', error: errMessage(err), proposal: peek };
  }

  const release = await deps.lock.acquire(lockKey, signal);
  try {
    return await approveInsideLock(proposalId, approvedBy, deps);
  } finally {
    release();
  }
}

async function approveInsideLock(
  proposalId: string,
  approvedBy: string,
  deps: ApproveTasteProposalDeps,
): Promise<ApproveTasteProposalResult> {
  const prepared = await prepareApproval(proposalId, approvedBy, deps.store);
  if (!prepared.ok) return prepared.result;

  const checkpointed = await ensureWriteCheckpoint(proposalId, prepared.proposal, deps);
  if (!checkpointed.ok) return checkpointed.result;

  return finalizeApproval(proposalId, approvedBy, checkpointed.proposal, prepared.recovered, deps.store);
}

async function prepareApproval(
  proposalId: string,
  approvedBy: string,
  store: ITasteProposalStore,
): Promise<PreparedApproval | StageExit> {
  const proposal = await store.get(proposalId);
  if (!proposal) return exitStage({ ok: false, reason: 'not_found' });
  if (proposal.status === 'approved') return exitStage({ ok: true, proposal, recovered: false });
  if (proposal.status === 'rejected') return exitStage({ ok: false, reason: 'rejected', proposal });
  if (proposal.status === 'approving') return { ok: true, proposal, recovered: true };

  const claimed = await store.claimForApproval(proposalId, approvedBy);
  if (!claimed) return exitStage({ ok: false, reason: 'claim_lost', proposal });
  return { ok: true, proposal: claimed, recovered: false };
}

async function ensureWriteCheckpoint(
  proposalId: string,
  proposal: TasteProposal,
  deps: ApproveTasteProposalDeps,
): Promise<CheckpointedApproval | StageExit> {
  const checkpointIsPartial = Boolean(proposal.vignetteSlug) !== Boolean(proposal.vignettePath);
  if (checkpointIsPartial) {
    return exitStage({
      ok: false,
      reason: 'write_failed',
      error: 'Taste write checkpoint is incomplete; refusing to guess durable output',
      proposal,
    });
  }
  if (proposal.vignetteSlug && proposal.vignettePath) return { ok: true, proposal };

  let writerResult: { slug: string; path: string };
  try {
    writerResult = await deps.writeVignette(proposal);
  } catch (err) {
    await deps.store.rollbackClaim(proposalId);
    return exitStage({ ok: false, reason: 'write_failed', error: errMessage(err) });
  }

  const durableProposal = { ...proposal, vignetteSlug: writerResult.slug, vignettePath: writerResult.path };
  try {
    const checkpointed = await deps.store.recordWriteCheckpoint(proposalId, {
      vignetteSlug: writerResult.slug,
      vignettePath: writerResult.path,
    });
    if (!checkpointed) {
      return exitStage({
        ok: false,
        reason: 'claim_lost',
        error: 'Taste proposal changed after its vignette was committed',
        proposal: durableProposal,
      });
    }
    return { ok: true, proposal: checkpointed };
  } catch (err) {
    return exitStage({ ok: false, reason: 'write_failed', error: errMessage(err), proposal: durableProposal });
  }
}

async function finalizeApproval(
  proposalId: string,
  approvedBy: string,
  proposal: TasteProposal,
  recovered: boolean,
  store: ITasteProposalStore,
): Promise<ApproveTasteProposalResult> {
  const { vignetteSlug, vignettePath } = proposal;
  if (!vignetteSlug || !vignettePath) {
    return { ok: false, reason: 'write_failed', error: 'Taste write checkpoint is missing', proposal };
  }
  try {
    const approved = await store.finalizeApproval(proposalId, approvedBy, vignetteSlug, vignettePath);
    return approved ? { ok: true, proposal: approved, recovered } : { ok: false, reason: 'claim_lost', proposal };
  } catch (err) {
    return { ok: false, reason: 'write_failed', error: errMessage(err), proposal };
  }
}

function exitStage(result: ApproveTasteProposalResult): StageExit {
  return { ok: false, result };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
