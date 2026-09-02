/**
 * @flowforge/infrastructure-distillation — C33 distillation 域 Cordis 插件。
 *
 * TS 移植自 clowder-ai `infrastructure/distillation/*`（F208 Phase E AC-E2）：
 *   - DistillationCheckpoint：事件驱动检查点，检测 feat-phase-close 与
 *     review-complete 事件，记录轻量"蒸馏机会"供 cats 决策
 *   - InMemoryOpportunityStore：dev/test 内存放（生产可注入其他实现）
 *   - IOpportunityStore 端口：getBySourceId/create/listPending/dismiss/markConverted
 *
 * 插件化改造：
 *   - clowder 模块级 store 单例 → 注入式 IOpportunityStore（缺省 InMemory）
 *   - logger 抽象为 { info, warn } 接口（缺省 console）
 *   - feat-phase-close inFlight 去重保留
 *
 * @module @flowforge/infrastructure-distillation
 */

import { Context, Service } from '@flowforge/cordis';
import type { DistillationSourceEvent } from '@flowforge/cats-shared';

// ── Types ───────────────────────────────────────────────────

export interface DistillationOpportunity {
  opportunityId: string;
  sourceEvent: DistillationSourceEvent;
  sourceId: string;
  targetCatId: string;
  prNumber: number;
  repoFullName: string;
  threadId: string;
  status: 'pending' | 'converted' | 'dismissed';
  metadata: Record<string, unknown>;
  createdAt: number;
  /** Set when status = 'converted'. */
  convertedToProposalId?: string;
}

export interface FeatPhaseCloseContext {
  prNumber: number;
  repoFullName: string;
  authorCatId: string;
  threadId: string;
  featureId: string;
  phaseLabel: string;
}

export interface ReviewCompleteContext {
  prNumber: number;
  repoFullName: string;
  reviewerCatId: string;
  authorCatId: string;
  threadId: string;
}

export interface CheckpointResult {
  fired: boolean;
  sourceId: string;
}

// ── Opportunity Store Interface ─────────────────────────────

export interface IOpportunityStore {
  getBySourceId(sourceId: string): Promise<DistillationOpportunity | null>;
  create(input: Omit<DistillationOpportunity, 'opportunityId' | 'createdAt'>): Promise<DistillationOpportunity>;
  listPending(): Promise<DistillationOpportunity[]>;
  dismiss(opportunityId: string): Promise<boolean>;
  markConverted(opportunityId: string, proposalId: string): Promise<boolean>;
}

/** In-memory store（dev/test；生产注入其他实现）。 */
export class InMemoryOpportunityStore implements IOpportunityStore {
  private items: Map<string, DistillationOpportunity> = new Map();
  private sourceIndex: Map<string, string> = new Map();
  private counter = 0;

  async getBySourceId(sourceId: string): Promise<DistillationOpportunity | null> {
    const id = this.sourceIndex.get(sourceId);
    return id ? (this.items.get(id) ?? null) : null;
  }

  async create(input: Omit<DistillationOpportunity, 'opportunityId' | 'createdAt'>): Promise<DistillationOpportunity> {
    const opportunityId = `opp-${++this.counter}`;
    const item: DistillationOpportunity = { ...input, opportunityId, createdAt: Date.now() };
    this.items.set(opportunityId, item);
    this.sourceIndex.set(input.sourceId, opportunityId);
    return item;
  }

  async listPending(): Promise<DistillationOpportunity[]> {
    return [...this.items.values()].filter((o) => o.status === 'pending');
  }

  async dismiss(opportunityId: string): Promise<boolean> {
    const item = this.items.get(opportunityId);
    if (!item || item.status !== 'pending') return false;
    item.status = 'dismissed';
    return true;
  }

  async markConverted(opportunityId: string, proposalId: string): Promise<boolean> {
    const item = this.items.get(opportunityId);
    if (!item || item.status !== 'pending') return false;
    item.status = 'converted';
    item.convertedToProposalId = proposalId;
    return true;
  }
}

// ── Logger ──────────────────────────────────────────────────

export interface DistillationLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

// ── Checkpoint Service ──────────────────────────────────────

export interface DistillationCheckpointDeps {
  opportunityStore: IOpportunityStore;
  log: DistillationLogger;
}

/**
 * 事件驱动检查点：PR 合并关闭特性阶段 / review APPROVE 时记录蒸馏机会。
 * feat-phase-close inFlight 去重；同一 sourceId 幂等不重复记录。
 */
export class DistillationCheckpoint {
  private readonly store: IOpportunityStore;
  private readonly log: DistillationLogger;
  private readonly featPhaseCloseInFlight = new Map<string, Promise<CheckpointResult>>();

  constructor(deps: DistillationCheckpointDeps) {
    this.store = deps.opportunityStore;
    this.log = deps.log;
  }

  /** PR 合并关闭特性阶段 → 机会定向到 PR 作者。 */
  async onFeatPhaseClose(ctx: FeatPhaseCloseContext): Promise<CheckpointResult> {
    const sourceId = `feat-phase-close:${ctx.featureId}:${ctx.phaseLabel}`;
    const inFlight = this.featPhaseCloseInFlight.get(sourceId);
    if (inFlight) return inFlight;

    const operation = this.recordFeatPhaseClose(ctx, sourceId);
    this.featPhaseCloseInFlight.set(sourceId, operation);
    try {
      return await operation;
    } finally {
      if (this.featPhaseCloseInFlight.get(sourceId) === operation) {
        this.featPhaseCloseInFlight.delete(sourceId);
      }
    }
  }

  private async recordFeatPhaseClose(ctx: FeatPhaseCloseContext, sourceId: string): Promise<CheckpointResult> {
    const existing = await this.store.getBySourceId(sourceId);
    if (existing) {
      this.log.info(`[distillation-checkpoint] feat-phase-close already recorded: ${sourceId}`);
      return { fired: false, sourceId };
    }
    await this.store.create({
      sourceEvent: 'feat-phase-close',
      sourceId,
      targetCatId: ctx.authorCatId,
      prNumber: ctx.prNumber,
      repoFullName: ctx.repoFullName,
      threadId: ctx.threadId,
      status: 'pending',
      metadata: { featureId: ctx.featureId, phaseLabel: ctx.phaseLabel, authorCatId: ctx.authorCatId },
    });
    this.log.info(`[distillation-checkpoint] feat-phase-close opportunity created: ${sourceId} → ${ctx.authorCatId}`);
    return { fired: true, sourceId };
  }

  /** review APPROVE → 机会定向到 PR 作者（作者可蒸馏评审收获）。 */
  async onReviewComplete(ctx: ReviewCompleteContext): Promise<CheckpointResult> {
    const sourceId = `review-complete:${ctx.repoFullName}#${ctx.prNumber}:${ctx.reviewerCatId}`;
    const existing = await this.store.getBySourceId(sourceId);
    if (existing) {
      this.log.info(`[distillation-checkpoint] review-complete already recorded: ${sourceId}`);
      return { fired: false, sourceId };
    }
    await this.store.create({
      sourceEvent: 'review-complete',
      sourceId,
      targetCatId: ctx.authorCatId,
      prNumber: ctx.prNumber,
      repoFullName: ctx.repoFullName,
      threadId: ctx.threadId,
      status: 'pending',
      metadata: { reviewerCatId: ctx.reviewerCatId, authorCatId: ctx.authorCatId },
    });
    this.log.info(`[distillation-checkpoint] review-complete opportunity created: ${sourceId} → ${ctx.authorCatId}`);
    return { fired: true, sourceId };
  }
}

export interface DistillationConfig {
  /** 机会存储（缺省 InMemoryOpportunityStore）。 */
  store?: IOpportunityStore;
  /** logger（缺省 console）。 */
  log?: DistillationLogger;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** distillation 域（C33）：蒸馏机会检查点 */
    forgeDistillation: ForgeDistillationService;
  }
}

/**
 * distillation 域服务 — 挂载 `ctx.forgeDistillation`。
 * 包装 DistillationCheckpoint，暴露 onFeatPhaseClose / onReviewComplete /
 * 机会查询（listPending）/ dismiss / markConverted。
 */
export class ForgeDistillationService extends Service {
  private readonly checkpoint: DistillationCheckpoint;
  private readonly store: IOpportunityStore;

  constructor(ctx: Context, config: DistillationConfig = {}) {
    super(ctx, 'forgeDistillation');
    this.store = config.store ?? new InMemoryOpportunityStore();
    this.checkpoint = new DistillationCheckpoint({
      opportunityStore: this.store,
      log: config.log ?? console,
    });
  }

  onFeatPhaseClose(c: FeatPhaseCloseContext): Promise<CheckpointResult> {
    return this.checkpoint.onFeatPhaseClose(c);
  }

  onReviewComplete(c: ReviewCompleteContext): Promise<CheckpointResult> {
    return this.checkpoint.onReviewComplete(c);
  }

  listPending(): Promise<DistillationOpportunity[]> {
    return this.store.listPending();
  }

  dismiss(opportunityId: string): Promise<boolean> {
    return this.store.dismiss(opportunityId);
  }

  markConverted(opportunityId: string, proposalId: string): Promise<boolean> {
    return this.store.markConverted(opportunityId, proposalId);
  }
}

export default ForgeDistillationService;
