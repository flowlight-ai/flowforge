/**
 * Canon Sync Protocol (F093 bridge protocol 2) — the constitutional gate.
 *
 * Iron law CL-010: "Role play dialogue never enters canon automatically." Every
 * attempt to reach canon memory must be proposed, then explicitly confirmed by
 * `operator` or `canon_driver`.
 *
 * Flow (mirrors `canon_sync.py`):
 *   1. `proposeCanon(turn, proposer)` → `proposalId`, **no canon write**
 *   2. `confirmCanon(proposalId, confirmer)` → writes canon, flags the session
 *      copy, marks the proposal `confirmed`
 *   3. `rejectCanon(proposalId, rejecter, reason)` → marks `rejected`
 *
 * Why this exists: without the gate, a Forgekin saying "我是齐天大圣" during RP
 * would silently enter memory and could later believe it really is 孙悟空
 * (identity drift CL-007) and pollute world-level truth (CL-009).
 */

import { randomUUID } from 'node:crypto';

import type { CanonMemoryPort } from '../ports/canon-memory.js';
import type { SessionMemoryPort } from '../ports/session-memory.js';
import { createCanonDecision, type Turn } from '../citizens.js';
import { isoNow, type Clock } from '../clock.js';
import { WorldEngineStateError } from '../errors.js';
import { requireNonEmpty } from '../validation.js';

/** Who may confirm a canon entry (CL-010). */
export const CANON_CONFIRMERS = ['operator', 'canon_driver'] as const;
export type CanonConfirmer = (typeof CANON_CONFIRMERS)[number];

const CONFIRMER_SET: ReadonlySet<string> = new Set(CANON_CONFIRMERS);

export type CanonProposalStatus = 'pending' | 'confirmed' | 'rejected';

/** Internal proposal record; the status is the only mutable part. */
export interface CanonProposal {
  readonly proposalId: string;
  readonly turn: Turn;
  readonly proposer: string;
  readonly createdAt: string;
  status: CanonProposalStatus;
  confirmer?: string;
  rejecter?: string;
  rejectReason?: string;
}

/** Proposal payload for diagnostics / audit. */
export interface CanonProposalSnapshot {
  readonly proposalId: string;
  readonly turnId: string;
  readonly proposer: string;
  readonly createdAt: string;
  readonly status: CanonProposalStatus;
  readonly confirmer?: string;
  readonly rejecter?: string;
  readonly rejectReason?: string;
}

/**
 * Minimal seam the runtime coordinator depends on (design D2): the coordinator
 * must delegate canon proposals without importing {@link CanonSyncProtocol},
 * which would create a module cycle with the bridge layer.
 */
export interface CanonProposer {
  proposeCanon(turn: Turn, proposer: string): Promise<string>;
}

export interface CanonSyncProtocolOptions {
  readonly canonMemory: CanonMemoryPort;
  readonly sessionMemory?: SessionMemoryPort;
  /** World the proposed decisions belong to (the source used a placeholder). */
  readonly worldId?: string;
  readonly clock?: Clock;
  /** Id generator seam; defaults to a UUID hex, matching `uuid4().hex`. */
  readonly generateId?: () => string;
}

export class CanonSyncProtocol implements CanonProposer {
  private readonly canon: CanonMemoryPort;
  private readonly session: SessionMemoryPort | undefined;
  private readonly explicitWorldId: string | undefined;
  private readonly clock: Clock | undefined;
  private readonly generateId: () => string;
  private readonly proposals = new Map<string, CanonProposal>();

  constructor(options: CanonSyncProtocolOptions) {
    this.canon = options.canonMemory;
    this.session = options.sessionMemory;
    this.explicitWorldId = options.worldId;
    this.clock = options.clock;
    this.generateId = options.generateId ?? (() => randomUUID().replace(/-/g, ''));
  }

  /**
   * Propose a turn for canon. Nothing is written to canon memory here.
   *
   * @throws {WorldEngineStateError} the turn is already canon.
   * @throws {WorldEngineValidationError} the proposer is blank.
   */
  async proposeCanon(turn: Turn, proposer: string): Promise<string> {
    if (turn.isCanon) {
      throw new WorldEngineStateError(
        `Turn '${turn.turnId}' is already canon; nothing to propose (CL-010)`,
      );
    }
    const proposerId = requireNonEmpty(proposer, 'proposer', 'CanonSyncProtocol');
    const proposalId = this.generateId();
    this.proposals.set(proposalId, {
      proposalId,
      turn,
      proposer: proposerId,
      createdAt: isoNow(this.clock),
      status: 'pending',
    });
    return proposalId;
  }

  /**
   * Confirm a proposal. Only {@link CANON_CONFIRMERS} may do so; anything else
   * (unknown confirmer, unknown proposal, already closed) returns `false` —
   * the legacy implementation returned a boolean rather than raising.
   */
  async confirmCanon(proposalId: string, confirmer: string): Promise<boolean> {
    if (!CONFIRMER_SET.has(confirmer)) return false;
    const proposal = this.proposals.get(proposalId);
    if (proposal === undefined || proposal.status !== 'pending') return false;

    const { turn } = proposal;
    const decision = createCanonDecision({
      decisionId: `canon-${turn.turnId}`,
      worldId: this.resolveWorldId(turn),
      decision: turn.content,
      decidedBy: confirmer,
      timestamp: isoNow(this.clock),
    });
    const written = await this.canon.write(decision, confirmer);
    if (!written) return false;

    if (this.session !== undefined) {
      await this.session.markTurnCanon(turn.turnId);
    }
    proposal.status = 'confirmed';
    proposal.confirmer = confirmer;
    return true;
  }

  /**
   * Reject a proposal. Anyone may reject (including the proposer withdrawing);
   * a reason is mandatory.
   *
   * @throws {WorldEngineValidationError} reason or rejecter is blank.
   */
  async rejectCanon(proposalId: string, rejecter: string, reason: string): Promise<boolean> {
    const reasonText = requireNonEmpty(reason, 'reject reason', 'CanonSyncProtocol');
    const rejecterId = requireNonEmpty(rejecter, 'rejecter', 'CanonSyncProtocol');
    const proposal = this.proposals.get(proposalId);
    if (proposal === undefined || proposal.status !== 'pending') return false;
    proposal.status = 'rejected';
    proposal.rejecter = rejecterId;
    proposal.rejectReason = reasonText;
    return true;
  }

  /** Proposal snapshot for diagnostics / audit; `undefined` when unknown. */
  async getProposal(proposalId: string): Promise<CanonProposalSnapshot | undefined> {
    const proposal = this.proposals.get(proposalId);
    if (proposal === undefined) return undefined;
    return {
      proposalId: proposal.proposalId,
      turnId: proposal.turn.turnId,
      proposer: proposal.proposer,
      createdAt: proposal.createdAt,
      status: proposal.status,
      ...(proposal.confirmer !== undefined ? { confirmer: proposal.confirmer } : {}),
      ...(proposal.rejecter !== undefined ? { rejecter: proposal.rejecter } : {}),
      ...(proposal.rejectReason !== undefined ? { rejectReason: proposal.rejectReason } : {}),
    };
  }

  /** Canon confirmation whitelist (CL-010). */
  canonConfirmers(): readonly string[] {
    return [...CANON_CONFIRMERS];
  }

  /**
   * Resolve the world a decision belongs to.
   *
   * The source fell back to a `world-of-<roundId>` placeholder because a Turn
   * does not carry `worldId` (it is reachable only via round → scene → world).
   * The placeholder is preserved so ported call sites behave identically; hosts
   * should pass an explicit `worldId` and query the world layer instead.
   */
  private resolveWorldId(turn: Turn): string {
    if (this.explicitWorldId !== undefined && this.explicitWorldId.trim().length > 0) {
      return this.explicitWorldId.trim();
    }
    return `world-of-${turn.roundId}`;
  }
}
