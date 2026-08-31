/**
 * F139 + clowder-ai#320: CiCdRouter — PR 轮询结果 → wait-lifecycle 观察 → 路由。
 *
 * TS 移植自 clowder-ai `infrastructure/email/CiCdRouter.ts`：
 *   - settleEmptyCheckRollup：空 rollup 稳定性守卫（同一 HEAD 空满 60s 才提升 pass）
 *   - classifyCiWaitBucket：billing 全失败 → external_infrastructure
 *   - buildDeliveryDecisionCueCarrier：F280 交付决策提示载体（billing → merge 候选）
 *   - route：查 task → settle → 跳过禁用 → external-review 记账 → wait 观察 →
 *     终态副作用恢复（prLifecycle/distillation/community，幂等收据）
 *
 * 插件化改造：clowder ITaskStore/GitHubWaitLifecycleService/ICommunityEventLog/
 * ExternalReviewCoordinator → 注入式端口（cats TaskStore 由宿主适配）。
 */

import type {
  DeliveryDecisionCueCarrierV1,
  ManagedWorkBinding,
  PrAutomationState,
  TaskItem,
  WaitOutcomeV1,
} from '@flowforge/cats-shared';
import type { CiAutomationState } from '@flowforge/cats-shared';

/** clowder 扩展：空 rollup 稳定性观察（cats-shared 无此字段）。 */
export type CiAutomationStateWithRollup = CiAutomationState & {
  readonly rollupObservation?: {
    readonly headSha: string;
    readonly state: 'empty' | 'present';
    readonly streakStartedAt: number;
  };
};

import type { CiBucket, CiPollResult, CiRouteResult, TrackedTaskLike } from './index.ts';
import { buildCiMessageContent, buildLifecycleMessageContent } from './index.ts';

export { buildCiMessageContent, buildLifecycleMessageContent };
export type { CiBucket, CiCheckDetail, CiExecutionFailure, CiPollResult, CiRouteResult } from './index.ts';

// ── 端口 ─────────────────────────────────────────────────────

/** cats TaskStore 端口（CiCdRouter 需要的子集）。 */
export interface CiTaskStorePort {
  getBySubject(subjectKey: string): Promise<TaskItem | null>;
  get(taskId: string): Promise<TaskItem | null>;
  update(taskId: string, patch: Partial<Pick<TaskItem, 'status'>>): Promise<TaskItem | null>;
  patchAutomationState(taskId: string, patch: { ci: Partial<CiAutomationState> }): Promise<TaskItem | null>;
  getManagedWorkBinding(taskId: string): Promise<ManagedWorkBinding | null>;
  replaceAutomationStateIfGeneration(
    taskId: string,
    input: {
      expectedGeneration: number | null;
      expectedUpdatedAt: number;
      automationState: PrAutomationState;
    },
  ): Promise<TaskItem | null>;
}

/** GitHubWaitLifecycleService.observe 端口。 */
export interface CiWaitLifecyclePort {
  observe(input: {
    taskId: string;
    facts: {
      headSha: string;
      ci: { bucket: CiBucket; fingerprint: string; blockerCount: number };
    };
    collectorPatch: {
      ci: {
        headSha: string;
        lastFingerprint: string;
        lastBucket: CiBucket;
        rollupObservation: RollupObservation;
        prState?: 'merged' | 'closed';
      };
    };
    subjectState?: 'merged' | 'closed';
    deliveryExtra?: { memoryCue: { deliveryDecision: DeliveryDecisionCueCarrierV1 } };
  }): Promise<CiWaitLifecycleResult>;
}

export type CiWaitLifecycleResult =
  | { readonly kind: 'not_tracked' | 'state_only' | 'deduped'; readonly reason: string }
  | {
      readonly kind: 'notified';
      readonly task: TaskItem;
      readonly outcome: WaitOutcomeV1;
      readonly messageId: string;
      readonly content: string;
    };

/** community 事件日志端口。 */
export interface CiEventLogPort {
  append(event: {
    sourceEventId: string;
    subjectKey: string;
    kind: string;
    classification: string;
    payload: Record<string, unknown>;
    at: number;
  }): Promise<{ appended: boolean }>;
}

export interface CiProjectorPort {
  rebuild(subjectKey: string): Promise<void>;
}

/** 蒸馏检查点端口。 */
export interface CiDistillationPort {
  onFeatPhaseClose(input: {
    prNumber: number;
    repoFullName: string;
    authorCatId: string;
    threadId: string;
    featureId: string;
    phaseLabel: string;
  }): Promise<{ fired: boolean; sourceId: string }>;
}

export interface CiExternalReviewPort {
  recordCi(
    poll: CiPollResult,
    ctx: { threadId: string; catId: string; userId: string },
  ): Promise<void>;
}

export interface TerminalEffectCommit {
  readonly idempotencyKey: string;
}

type TerminalPrState = 'merged' | 'closed';
type TerminalEffect = 'prLifecycle' | 'distillation' | 'communityProjection';
type TerminalEffectReceipt = NonNullable<NonNullable<PrAutomationState['ci']>['terminalEffects']>;

interface TerminalRecoveryContext {
  readonly task: TaskItem;
  readonly terminal: TerminalPrState;
  readonly effects: TerminalEffectReceipt;
}

export interface CiCdRouterOptions {
  readonly taskStore: CiTaskStorePort;
  readonly waitLifecycle: CiWaitLifecyclePort;
  readonly log: { warn: (...args: unknown[]) => void };
  readonly notifySkip?: (threadId: string, reason: string) => void;
  readonly onPrLifecycle?: (event: {
    type: 'merge' | 'revert';
    ref: string;
    outcome: 'success' | 'failure';
    threadId: string;
    idempotencyKey: string;
    attribution: { kind: 'managed_attributed'; binding: ManagedWorkBinding } | { kind: 'managed_unattributed' };
  }) => TerminalEffectCommit | Promise<TerminalEffectCommit>;
  readonly eventLog?: CiEventLogPort;
  readonly projector?: CiProjectorPort;
  readonly externalReviewCoordinator?: CiExternalReviewPort;
  readonly distillationCheckpoint?: CiDistillationPort;
  readonly now?: () => number;
}

function terminalPrState(poll: CiPollResult): TerminalPrState | undefined {
  return poll.prState === 'merged' || poll.prState === 'closed' ? poll.prState : undefined;
}

/** F280 交付决策提示载体：open+fail+billing 证据 + 等 CI → merge 候选。 */
export function buildDeliveryDecisionCueCarrier(
  poll: CiPollResult,
  task: Pick<TrackedTaskLike, 'automationState'>,
  occurredAt: number,
): DeliveryDecisionCueCarrierV1 | null {
  const waitsForCi = task.automationState?.await?.continuation.when.some(
    (predicate) => predicate.kind === 'pr_ci_terminal',
  );
  if (
    poll.prState !== 'open' ||
    poll.aggregateBucket !== 'fail' ||
    !waitsForCi ||
    task.automationState?.ci?.headSha !== poll.headSha ||
    !poll.checks.some((check) => check.executionFailure === 'billing_spending_limit_zero_step')
  ) {
    return null;
  }
  return {
    v: 1,
    producer: 'github_ci',
    producerProvenance: 'server_github_ci',
    repoFullName: poll.repoFullName,
    prNumber: poll.prNumber,
    headSha: poll.headSha,
    phase: 'merge_gate',
    gateOutcome: 'source_evidence_complete',
    externalCondition: 'billing_spending_limit_zero_step',
    candidateAction: 'merge',
    occurredAt,
  } as DeliveryDecisionCueCarrierV1;
}

/** 全部失败均为 billing → external_infrastructure，否则 fail。 */
export function classifyCiWaitBucket(poll: CiPollResult): CiBucket {
  if (poll.aggregateBucket !== 'fail') return poll.aggregateBucket;
  const failedChecks = poll.checks.filter((check) => check.bucket === 'fail');
  return failedChecks.length > 0 &&
    failedChecks.every((check) => check.executionFailure === 'billing_spending_limit_zero_step')
    ? 'external_infrastructure'
    : 'fail';
}

export const EMPTY_ROLLUP_STABILITY_MS = 60_000;

type RollupObservation = NonNullable<CiAutomationStateWithRollup['rollupObservation']>;

/**
 * GitHub 对「无检查的仓库」与「新 HEAD 检查出现前」都返回 []。
 * 要求完全相同的 HEAD 空满一个轮询周期才提升 pass；任何非空观察重置计数。
 */
export function settleEmptyCheckRollup(
  poll: CiPollResult,
  previous: RollupObservation | undefined,
  now: number,
): { readonly poll: CiPollResult; readonly observation: RollupObservation } {
  if (poll.prState !== 'open' || poll.checkRollup !== 'empty') {
    return {
      poll,
      observation: { headSha: poll.headSha, state: 'present', streakStartedAt: now },
    };
  }
  const streakStartedAt =
    previous?.headSha === poll.headSha && previous.state === 'empty' ? previous.streakStartedAt : now;
  const aggregateBucket = now - streakStartedAt >= EMPTY_ROLLUP_STABILITY_MS ? 'pass' : 'pending';
  return {
    poll: { ...poll, aggregateBucket },
    observation: { headSha: poll.headSha, state: 'empty', streakStartedAt },
  };
}

function routeFromLifecycle(
  result: CiWaitLifecycleResult,
  bucket: CiBucket,
  prState?: 'merged' | 'closed',
): CiRouteResult {
  if (result.kind === 'notified') {
    if (prState) {
      return {
        kind: 'lifecycle',
        threadId: result.task.threadId,
        catId: result.task.ownerCatId ?? '',
        messageId: result.messageId,
        prState,
        content: result.content,
      };
    }
    return {
      kind: 'notified',
      threadId: result.task.threadId,
      catId: result.task.ownerCatId ?? '',
      messageId: result.messageId,
      bucket,
      content: result.content,
      headSha: result.outcome.subjectRef,
    };
  }
  return {
    kind: result.kind === 'deduped' ? 'deduped' : 'skipped',
    reason: result.reason,
  };
}

export class CiCdRouter {
  private readonly now: () => number;

  constructor(private readonly opts: CiCdRouterOptions) {
    this.now = opts.now ?? Date.now;
  }

  async route(poll: CiPollResult): Promise<CiRouteResult> {
    const sk = prSubjectKey(poll.repoFullName, poll.prNumber);
    const task = await this.opts.taskStore.getBySubject(sk);
    if (!task) return { kind: 'skipped', reason: `No tracking task for ${poll.repoFullName}#${poll.prNumber}` };

    const settled = settleEmptyCheckRollup(poll, (task.automationState?.ci as CiAutomationStateWithRollup | undefined)?.rollupObservation, this.now());
    const observedPoll = settled.poll;
    const terminal = terminalPrState(observedPoll);
    const disabled = await this.skipDisabledCi(task);
    if (disabled) return disabled;
    await this.recordExternalReviewCi(observedPoll, task, sk);

    const waitBucket = classifyCiWaitBucket(observedPoll);
    const fingerprint = `${observedPoll.headSha}:${waitBucket}`;
    const deliveryDecision = buildDeliveryDecisionCueCarrier(observedPoll, task, this.now());
    let lifecycle: CiWaitLifecycleResult;
    try {
      lifecycle = await this.observeWait(
        observedPoll,
        task,
        waitBucket,
        fingerprint,
        terminal,
        deliveryDecision,
        settled.observation,
      );
    } catch (error) {
      // wait 转换在 connector 投递前已持久化；即便投递抛错也从持久终态恢复世界真相
      if (terminal) await this.recoverTerminalSideEffects(observedPoll, task.id, sk);
      throw error;
    }

    if (terminal) {
      await this.recoverTerminalSideEffects(observedPoll, task.id, sk);
      if (lifecycle.kind !== 'notified') {
        await this.opts.taskStore.update(task.id, { status: 'done' });
      }
    }
    return routeFromLifecycle(lifecycle, waitBucket, terminal);
  }

  private async skipDisabledCi(task: TaskItem): Promise<CiRouteResult | null> {
    if (task.automationState?.ci?.enabled !== false) return null;
    if (!task.automationState.ci.skipNotified) {
      this.opts.notifySkip?.(task.threadId, 'ci_automation_disabled');
      await this.opts.taskStore.patchAutomationState(task.id, { ci: { skipNotified: true } });
    }
    return { kind: 'skipped', reason: 'CI collection disabled' };
  }

  private async recordExternalReviewCi(poll: CiPollResult, task: TaskItem, _sk: string): Promise<void> {
    if (!task.ownerCatId) return;
    try {
      await this.opts.externalReviewCoordinator?.recordCi(poll, {
        threadId: task.threadId,
        catId: task.ownerCatId,
        userId: task.userId ?? '',
      });
    } catch (error) {
      this.opts.log.warn(`[F168] CI readiness bookkeeping failed: ${String(error)}`);
    }
  }

  private observeWait(
    poll: CiPollResult,
    task: TaskItem,
    waitBucket: CiBucket,
    fingerprint: string,
    terminal: TerminalPrState | undefined,
    deliveryDecision: DeliveryDecisionCueCarrierV1 | null,
    rollupObservation: RollupObservation,
  ): Promise<CiWaitLifecycleResult> {
    return this.opts.waitLifecycle.observe({
      taskId: task.id,
      facts: {
        headSha: poll.headSha,
        ci: {
          bucket: waitBucket,
          fingerprint,
          blockerCount: poll.checks.filter((check) => check.bucket === 'fail').length,
        },
      },
      collectorPatch: {
        ci: {
          headSha: poll.headSha,
          lastFingerprint: fingerprint,
          lastBucket: waitBucket,
          rollupObservation,
          ...(terminal ? { prState: terminal } : {}),
        },
      },
      ...(terminal ? { subjectState: terminal } : {}),
      ...(deliveryDecision ? { deliveryExtra: { memoryCue: { deliveryDecision } } } : {}),
    });
  }

  private async recoverTerminalSideEffects(poll: CiPollResult, taskId: string, sk: string): Promise<void> {
    const terminal = terminalPrState(poll);
    if (!terminal) return;
    let context = await this.loadTerminalRecoveryContext(taskId, terminal);
    if (!context || context.effects.completedAt !== undefined) return;

    const lifecycleRequired = terminal === 'merged' && this.opts.onPrLifecycle !== undefined;
    if (lifecycleRequired) {
      context = await this.applyTerminalEffect(context, 'prLifecycle', sk, (task) =>
        this.emitPrLifecycleEffect(task, sk),
      );
    }

    const featureSource = context.task.title ?? '';
    const featureMatch = featureSource.match(/\b[Ff](\d{2,4})\b/);
    const distillationRequired =
      terminal === 'merged' && this.opts.distillationCheckpoint !== undefined && featureMatch !== null;
    if (distillationRequired) {
      context = await this.applyTerminalEffect(context, 'distillation', sk, (task) =>
        this.emitDistillationEffect(poll, task, featureMatch!),
      );
    }

    const communityRequired = this.opts.eventLog !== undefined;
    if (communityRequired) {
      context = await this.applyTerminalEffect(context, 'communityProjection', sk, () =>
        this.emitCommunityEffect(poll, sk, terminal),
      );
    }

    const requiredEffects: TerminalEffect[] = [
      ...(lifecycleRequired ? (['prLifecycle'] as const) : []),
      ...(distillationRequired ? (['distillation'] as const) : []),
      ...(communityRequired ? (['communityProjection'] as const) : []),
    ];
    if (requiredEffects.every((effect) => context.effects[effect] === true)) {
      await this.markTerminalEffect(taskId, terminal, 'completedAt');
    }
  }

  private async loadTerminalRecoveryContext(
    taskId: string,
    terminal: TerminalPrState,
  ): Promise<TerminalRecoveryContext | null> {
    const task = await this.opts.taskStore.get(taskId);
    if (!task || task.automationState?.ci?.prState !== terminal) return null;
    const existing = task.automationState.ci.terminalEffects;
    return {
      task,
      terminal,
      effects: existing?.prState === terminal ? existing : { prState: terminal },
    };
  }

  private async applyTerminalEffect(
    context: TerminalRecoveryContext,
    effect: TerminalEffect,
    _sk: string,
    run: (task: TaskItem) => Promise<void>,
  ): Promise<TerminalRecoveryContext> {
    if (context.effects[effect] === true) return context;
    try {
      await run(context.task);
      const updated = await this.markTerminalEffect(context.task.id, context.terminal, effect);
      return (await this.loadTerminalRecoveryContext(updated?.id ?? context.task.id, context.terminal)) ?? context;
    } catch (error) {
      this.opts.log.warn(`[CiCdRouter] terminal world-truth effect failed: ${String(error)}`);
      return context;
    }
  }

  private async emitPrLifecycleEffect(task: TaskItem, sk: string): Promise<void> {
    if (!this.opts.onPrLifecycle) return;
    const binding = await this.opts.taskStore.getManagedWorkBinding(task.id);
    const idempotencyKey = `pr:merge:${sk}:success`;
    const committed = await this.opts.onPrLifecycle({
      type: 'merge',
      ref: sk,
      outcome: 'success',
      threadId: task.threadId,
      idempotencyKey,
      attribution: binding ? { kind: 'managed_attributed', binding } : { kind: 'managed_unattributed' },
    });
    if (committed.idempotencyKey !== idempotencyKey) {
      throw new Error(`PR lifecycle sink committed unexpected key ${committed.idempotencyKey}`);
    }
  }

  private async emitDistillationEffect(
    poll: CiPollResult,
    task: TaskItem,
    featureMatch: RegExpMatchArray,
  ): Promise<void> {
    if (!this.opts.distillationCheckpoint) return;
    const phaseMatch = task.title.match(/[Pp]hase\s+([A-Z])/i);
    const committed = await this.opts.distillationCheckpoint.onFeatPhaseClose({
      prNumber: poll.prNumber,
      repoFullName: poll.repoFullName,
      authorCatId: task.ownerCatId ?? 'unknown',
      threadId: task.threadId,
      featureId: `F${featureMatch[1]}`,
      phaseLabel: phaseMatch?.[1] ?? 'unknown',
    });
    const expectedSourceId = `feat-phase-close:F${featureMatch[1]}:${phaseMatch?.[1] ?? 'unknown'}`;
    if (committed.sourceId !== expectedSourceId) {
      throw new Error(`Distillation checkpoint committed unexpected source ${committed.sourceId}`);
    }
  }

  private async emitCommunityEffect(poll: CiPollResult, sk: string, terminal: TerminalPrState): Promise<void> {
    if (!this.opts.eventLog) return;
    const communityEvent = {
      sourceEventId: `lifecycle:${sk}:${terminal}`,
      subjectKey: sk,
      kind: (terminal === 'merged' ? 'pr.merged' : 'pr.closed') as 'pr.merged' | 'pr.closed',
      classification: 'state-changing' as const,
      payload: {
        prState: terminal,
        repoFullName: poll.repoFullName,
        prNumber: poll.prNumber,
      },
      at: Date.now(),
    };
    await this.opts.eventLog.append(communityEvent);
    // 从幂等事件日志重建投影，而非在 append 胜利但上次投影崩溃时重复 apply
    if (this.opts.projector) await this.opts.projector.rebuild(sk);
  }

  private async markTerminalEffect(
    taskId: string,
    terminal: TerminalPrState,
    effect: TerminalEffect | 'completedAt',
  ): Promise<TaskItem | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.opts.taskStore.get(taskId);
      const state = current?.automationState as PrAutomationState | undefined;
      if (!current || state?.ci?.prState !== terminal) return null;
      const existing =
        state.ci.terminalEffects?.prState === terminal ? state.ci.terminalEffects : { prState: terminal };
      const terminalEffects = {
        ...existing,
        ...(effect === 'completedAt' ? { completedAt: Date.now() } : { [effect]: true as const }),
      };
      const updatedState: PrAutomationState = {
        ...state,
        ci: { ...state.ci, terminalEffects },
      };
      const installed = await this.opts.taskStore.replaceAutomationStateIfGeneration(taskId, {
        expectedGeneration: state.await?.generation ?? state.waitOutcome?.generation ?? null,
        expectedUpdatedAt: current.updatedAt,
        automationState: updatedState,
      });
      if (installed) return installed;
    }
    return null;
  }
}

/** `pr:owner/repo#123` 标准格式。 */
export function prSubjectKey(repoFullName: string, prNumber: number): string {
  return `pr:${repoFullName.toLowerCase()}#${prNumber}`;
}
