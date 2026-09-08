/**
 * Session handoff controller (F225) — propose / approve / reject flow.
 *
 * Rebuilds clowder `session-handoff-approve-routes.ts` +
 * `session-handoff-reject-response.ts` +
 * `callback-propose-session-handoff-routes.ts` behind the injected
 * `ISessionHandoffProposalStore`. State transitions:
 *
 *   propose  → pending (idempotent by clientRequestId)
 *   approve  → claiming (approving) → approved
 *   reject   → pending → rejected (conflict / busy / legacy guards)
 *
 * All copy externalized in `contract/messages.ts`.
 */

import { proposeHandoffSchema, generateProposalId } from '../contract/session.ts';
import type { CallbackPrincipal } from '../contract/session.ts';
import { MESSAGES } from '../contract/messages.ts';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';
import type { ISessionHandoffProposalStore, NewHandoffProposal } from '../ports/stores.ts';

/** Claim/commit state machine helpers exposed for contract tests. */
export type HandoffDecision = 'claim' | 'commit' | 'reject';

export interface HandoffClaimResult {
  status: 'claimed' | 'not_found' | 'busy';
  proposalStatus?: string;
}

export interface HandoffCommitResult {
  status: 'committed' | 'not_found' | 'not_claiming';
  proposalStatus?: string;
}

export interface HandoffRejectResult {
  status: 'rejected' | 'not_found' | 'conflict' | 'busy' | 'legacy' | 'invariant';
  proposalStatus?: string;
}

export class MemoryHandoffStateMachine {
  constructor(private readonly proposalStore: ISessionHandoffProposalStore) {}

  /** Claim a pending proposal for approval. */
  async claim(proposalId: string): Promise<HandoffClaimResult> {
    const proposal = await this.proposalStore.get(proposalId);
    if (!proposal) return { status: 'not_found' };
    if (proposal.status === 'approving' || proposal.status === 'approved') {
      return { status: 'busy', proposalStatus: proposal.status };
    }
    if (proposal.status !== 'pending') return { status: 'busy', proposalStatus: proposal.status };
    await this.proposalStore.updateStatus(proposalId, 'approving');
    return { status: 'claimed', proposalStatus: 'approving' };
  }

  /** Commit an approving proposal to approved. */
  async commit(proposalId: string): Promise<HandoffCommitResult> {
    const proposal = await this.proposalStore.get(proposalId);
    if (!proposal) return { status: 'not_found' };
    if (proposal.status !== 'approving') return { status: 'not_claiming', proposalStatus: proposal.status };
    await this.proposalStore.updateStatus(proposalId, 'approved');
    return { status: 'committed' };
  }

  /** Reject a pending proposal with feedback. */
  async reject(proposalId: string): Promise<HandoffRejectResult> {
    const proposal = await this.proposalStore.get(proposalId);
    if (!proposal) return { status: 'not_found' };
    if (proposal.status === 'approved') return { status: 'conflict', proposalStatus: proposal.status };
    if (proposal.status === 'approving') return { status: 'busy', proposalStatus: proposal.status };
    if (proposal.status !== 'pending') return { status: 'legacy', proposalStatus: proposal.status };
    await this.proposalStore.updateStatus(proposalId, 'rejected');
    return { status: 'rejected' };
  }
}

export interface SessionHandoffControllerOptions {
  proposalStore: ISessionHandoffProposalStore;
  identity: RequestContextResolver;
  /** Optional proposal-id generator (host crypto in EP2). */
  generateId?: (seed: string) => string;
}

interface ProposeRouteContext {
  threadId: string;
  catId: string;
  userId: string;
}

export class SessionHandoffController extends RestControllerBase {
  private readonly stateMachine: MemoryHandoffStateMachine;

  constructor(private readonly opts: SessionHandoffControllerOptions) {
    super();
    this.stateMachine = new MemoryHandoffStateMachine(opts.proposalStore);
    this.registerRoutes();
  }

  private idFor(seed: string): string {
    return this.opts.generateId ? this.opts.generateId(seed) : generateProposalId(seed);
  }

  private registerRoutes(): void {
    // POST /api/threads/:threadId/sessions/:catId/handoff/propose
    this.post('/api/threads/:threadId/sessions/:catId/handoff/propose', async (req) => {
      const context = this.resolveContext(req);
      if (!context) return { status: 401, body: { error: MESSAGES.identityRequired } };
      const parsed = proposeHandoffSchema.safeParse(req.body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid handoff proposal', details: parsed.error.flatten() } };
      }
      const input = parsed.data;
      if (input.clientRequestId) {
        const existing = await this.opts.proposalStore.getByClientRequestId(
          input.clientRequestId,
          context.catId,
          context.threadId,
        );
        if (existing && existing.status !== 'rejected') {
          return { status: 200, body: { ...existing, idempotent: true } };
        }
      }
      const proposalId = this.idFor(`${context.threadId}:${context.catId}:${Date.now()}`);
      const record: NewHandoffProposal = {
        proposalId,
        catId: context.catId,
        threadId: context.threadId,
        done: input.done,
        nextSteps: input.nextSteps,
        ...(input.worktreeBranch ? { worktreeBranch: input.worktreeBranch } : {}),
        ...(input.commits ? { commits: input.commits } : {}),
        ...(input.gotchas ? { gotchas: input.gotchas } : {}),
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      };
      const proposal = await this.opts.proposalStore.create(record);
      return { status: 201, body: proposal };
    });

    // POST /api/threads/:threadId/sessions/:catId/handoff/:proposalId/approve
    this.post('/api/threads/:threadId/sessions/:catId/handoff/:proposalId/approve', async (req) => {
      const context = this.resolveContext(req);
      if (!context) return { status: 401, body: { error: MESSAGES.identityRequired } };
      const proposalId = req.params?.proposalId ?? '';
      const claimed = await this.stateMachine.claim(proposalId);
      if (claimed.status === 'not_found') {
        return { status: 404, body: { error: MESSAGES.handoffProposalNotFound } };
      }
      if (claimed.status === 'busy') {
        return { status: 409, body: { error: MESSAGES.handoffRejectBusy, proposalStatus: claimed.proposalStatus } };
      }
      const committed = await this.stateMachine.commit(proposalId);
      if (committed.status !== 'committed') {
        return { status: 409, body: { error: MESSAGES.handoffInvariantFailure, proposalStatus: committed.proposalStatus } };
      }
      const finalized = await this.opts.proposalStore.get(proposalId);
      return { status: 200, body: finalized };
    });

    // POST /api/threads/:threadId/sessions/:catId/handoff/:proposalId/reject
    this.post('/api/threads/:threadId/sessions/:catId/handoff/:proposalId/reject', async (req) => {
      const context = this.resolveContext(req);
      if (!context) return { status: 401, body: { error: MESSAGES.identityRequired } };
      const proposalId = req.params?.proposalId ?? '';
      const rejected = await this.stateMachine.reject(proposalId);
      if (rejected.status === 'not_found') {
        return { status: 404, body: { error: MESSAGES.handoffProposalNotFound } };
      }
      if (rejected.status === 'conflict') {
        return { status: 409, body: { error: MESSAGES.handoffRejectConflict, proposalStatus: rejected.proposalStatus } };
      }
      if (rejected.status === 'busy') {
        return { status: 409, body: { error: MESSAGES.handoffRejectBusy, proposalStatus: rejected.proposalStatus } };
      }
      if (rejected.status === 'legacy') {
        return { status: 409, body: { error: MESSAGES.handoffLegacyUnmigrated, proposalStatus: rejected.proposalStatus } };
      }
      return { status: 200, body: { ok: true } };
    });
  }

  private resolveContext(req: { body?: unknown; params?: Record<string, string> }): ProposeRouteContext | null {
    const userId = this.opts.identity.resolveUserId(req as never);
    if (!userId) return null;
    return { threadId: req.params?.threadId ?? '', catId: req.params?.catId ?? '', userId };
  }
}

export type { CallbackPrincipal };