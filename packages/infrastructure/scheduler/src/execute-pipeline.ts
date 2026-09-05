/**
 * 执行管线（TS 移植自 clowder-ai `infrastructure/scheduler/execute-pipeline.ts`）。
 *
 * 每次 tick 的 gate→execute→ledger 管线：enabled 检查 → 治理检查（AC-D1，手动触发
 * 跳过）→ 任务级重叠守卫 → gate 出 workItems → 逐 subject 执行（超时/取消感知 +
 * 自回声抑制 AC-D2 + 触发效果结算）→ 逐 subject 台账 → 回声记录。
 *
 * 适配说明（对照 clowder）：
 *   - RunLedgerRow 沿用本包 number 时间戳形态（started_at/scheduled_at/fired_at）
 *   - IBallCustodyIngest → SchedulerBallCustodyIngest 结构化端口（types.ts）
 */

import type { RunLedger } from './stores.ts';
import type {
  ActorRole,
  CostTier,
  DeliverOpts,
  FetchResult,
  GateCtx,
  RunLedgerRow,
  RunOutcome,
  ScheduleInvokeTrigger,
  ScheduleRunTiming,
  SchedulerBallCustodyIngest,
  TaskSpec_P1,
} from './types.ts';
import type { EmissionStore, GlobalControlStore } from './stores.ts';

type AnyTaskSpec = TaskSpec_P1<unknown>;

export interface PipelineContext {
  task: AnyTaskSpec;
  ledger: RunLedger;
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
  running: Map<string, boolean>;
  tickCounts: Map<string, number>;
  lastRunAt: Map<string, number | null>;
  actorResolver?: ((role: ActorRole, costTier: CostTier) => string | null) | undefined;
  /** Phase 3B (AC-D1): governance store — optional for backwards compat */
  globalControlStore?: GlobalControlStore | undefined;
  /** Phase 3B (AC-D2): emission store for self-echo suppression */
  emissionStore?: EmissionStore | undefined;
  /** Phase 3B (AC-D1): manual triggers bypass global pause + task overrides */
  isManualTrigger?: boolean | undefined;
  /** Wall-clock schedule metadata for this fire, if known. */
  schedule?: ScheduleRunTiming | undefined;
  /** Phase 4 (AC-H1): deliver message to a thread */
  deliver?: ((opts: DeliverOpts) => Promise<string>) | undefined;
  /** Phase 4 (AC-H2): fetch web content with browser-automation routing */
  fetchContent?: ((url: string, signal?: AbortSignal) => Promise<FetchResult>) | undefined;
  /** Phase 4b: invoke a cat to handle a scheduled task (fire-and-forget) */
  invokeTrigger?: ScheduleInvokeTrigger | undefined;
  /** F233 PR3: optional ball-custody event sink for scheduler-originated events. */
  ballCustody?: SchedulerBallCustodyIngest | undefined;
  managedCommandWakeRecovery?: ((taskId: string) => Promise<'missing' | 'pending' | 'recovered'>) | undefined;
  /** #415: per-workItem outcome callback (used for failure notifications) */
  onItemOutcome?: ((taskId: string, subjectKey: string, outcome: RunOutcome, errorSummary: string | null) => void) | undefined;
}

type LedgerTiming = Pick<
  RunLedgerRow,
  'scheduled_at' | 'fired_at' | 'lateness_ms' | 'missed_slots' | 'trigger_kind' | 'misfire_policy'
>;

function ledgerTimingFields(
  task: AnyTaskSpec,
  schedule: ScheduleRunTiming | undefined,
  isManualTrigger: boolean | undefined,
): LedgerTiming {
  return {
    scheduled_at: schedule?.scheduledAt !== undefined && schedule.scheduledAt !== null
      ? Date.parse(schedule.scheduledAt)
      : null,
    fired_at: schedule?.firedAt !== undefined ? Date.parse(schedule.firedAt) : null,
    lateness_ms: schedule?.latenessMs ?? null,
    missed_slots: schedule?.missedSlots ?? null,
    trigger_kind: schedule?.triggerKind ?? (isManualTrigger ? 'manual' : task.trigger.type),
    misfire_policy: schedule?.misfirePolicy ?? null,
  };
}

async function withTimeout(
  promise: Promise<void>,
  ms: number,
  taskId: string,
  controller: AbortController,
): Promise<void> {
  let timeoutError: Error | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutError = new Error(`[scheduler] ${taskId}: execute timed out after ${ms}ms`);
      reject(timeoutError);
      controller.abort(timeoutError);
    }, ms);
  });

  try {
    await Promise.race([promise, timeout]);
  } catch (error) {
    if (timeoutError !== null) {
      // Cancellation is not terminal until the underlying execution has
      // observed the signal and finished its cleanup. This preserves the
      // existing task-level overlap lock without inventing another lock.
      await promise.catch(() => {});
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function executeTaskPipeline(ctx: PipelineContext): Promise<void> {
  const {
    task, ledger, logger, running, tickCounts, lastRunAt,
    actorResolver, globalControlStore, emissionStore, isManualTrigger, schedule,
    deliver, fetchContent, invokeTrigger, ballCustody, managedCommandWakeRecovery, onItemOutcome,
  } = ctx;
  const startMs = Date.now();
  const timing = ledgerTimingFields(task, schedule, isManualTrigger);
  const tickCount = (tickCounts.get(task.id) ?? 0) + 1;
  tickCounts.set(task.id, tickCount);

  const recordSkip = (subjectKey: string, outcome: RunOutcome, itemStartMs: number, signalSummary = ''): void => {
    ledger.record({
      task_id: task.id,
      subject_key: subjectKey,
      outcome,
      signal_summary: signalSummary,
      duration_ms: Date.now() - itemStartMs,
      started_at: itemStartMs,
      assigned_cat_id: null,
      error_summary: null,
      ...timing,
    });
  };

  // Step 1: Enabled check
  if (!task.enabled()) return;

  // Step 1b: Governance checks (AC-D1) — skipped for manual triggers
  if (globalControlStore && isManualTrigger !== true) {
    if (!globalControlStore.getGlobalEnabled()) {
      recordSkip(task.id, 'SKIP_GLOBAL_PAUSE', startMs);
      return;
    }
    const taskOverride = globalControlStore.getTaskOverride(task.id);
    if (taskOverride && !taskOverride.enabled) {
      recordSkip(task.id, 'SKIP_TASK_OVERRIDE', startMs);
      return;
    }
  }

  // Step 2: Overlap guard (task-level — prevents gate re-entry)
  if (running.get(task.id) === true) {
    logger.info(`[scheduler] ${task.id}: still running, skipping tick`);
    recordSkip(task.id, 'SKIP_OVERLAP', startMs);
    return;
  }
  running.set(task.id, true);

  try {
    // Step 3: Gate — returns workItems[]
    const gateCtx: GateCtx = {
      taskId: task.id,
      lastRunAt: lastRunAt.get(task.id) ?? null,
      tickCount,
    };

    const gateResult = await task.admission.gate(gateCtx);

    if (!gateResult.run) {
      if (task.outcome.whenNoSignal === 'record') {
        recordSkip(task.id, 'SKIP_NO_SIGNAL', startMs);
      }
      return;
    }

    // Phase 1b: Actor resolution — resolve once per task tick, not per workItem
    const assignedCatId = task.actor && actorResolver ? actorResolver(task.actor.role, task.actor.costTier) : null;

    // Step 4 + 5: Execute per workItem → ledger per subject
    for (const item of gateResult.workItems) {
      const itemStartMs = Date.now();

      // AC-D2: Self-echo suppression — skip thread workItems where this task recently posted
      if (emissionStore && item.subjectKey.startsWith('thread-')) {
        const threadId = item.subjectKey.slice(7);
        if (emissionStore.isSuppressed(task.id, threadId)) {
          recordSkip(item.subjectKey, 'SKIP_SELF_ECHO', itemStartMs);
          continue;
        }
      }

      let outcome: RunOutcome = 'RUN_DELIVERED';
      const executeController = new AbortController();
      const deliveredMessageIds = new Set<string>();
      const pendingTriggerEffects = new Set<Promise<unknown>>();
      const cancellationAwareDeliver = deliver
        ? async (opts: DeliverOpts): Promise<string> => {
            executeController.signal.throwIfAborted();
            const messageId = await deliver(opts);
            deliveredMessageIds.add(messageId);
            return messageId;
          }
        : undefined;
      const cancellationAwareFetch = fetchContent
        ? async (url: string): Promise<FetchResult> => {
            executeController.signal.throwIfAborted();
            const result = await fetchContent(url, executeController.signal);
            executeController.signal.throwIfAborted();
            return result;
          }
        : undefined;
      const cancellationAwareInvokeTrigger: ScheduleInvokeTrigger | undefined = invokeTrigger
        ? {
            trigger(threadId, catId, userId, message, messageId, contentBlocks, policy) {
              // A trigger carrying a message persisted by this same work item is
              // the bounded completion of that delivery, even if timeout fired
              // while the message write was settling. Unrelated new triggers
              // remain fail-fast after cancellation.
              const effect = Promise.resolve()
                .then(() => {
                  if (!deliveredMessageIds.has(messageId)) executeController.signal.throwIfAborted();
                  return invokeTrigger.trigger(threadId, catId, userId, message, messageId, contentBlocks, policy);
                })
                .finally(() => {
                  pendingTriggerEffects.delete(effect);
                });
              pendingTriggerEffects.add(effect);
              return effect;
            },
          }
        : undefined;
      const cancellationAwareWakeRecovery = managedCommandWakeRecovery
        ? async (taskId: string): Promise<'missing' | 'pending' | 'recovered'> => {
            executeController.signal.throwIfAborted();
            return await managedCommandWakeRecovery(taskId);
          }
        : undefined;
      // Phase 2: pass context spec through ExecuteContext
      const rawExecute = Promise.resolve().then(async () => {
        try {
          await task.run.execute(item.signal, item.subjectKey, {
            signal: executeController.signal,
            assignedCatId,
            ...(task.context === undefined ? {} : { context: task.context }),
            ...(schedule === undefined ? {} : { schedule }),
            ...(cancellationAwareDeliver === undefined ? {} : { deliver: cancellationAwareDeliver }),
            ...(cancellationAwareFetch === undefined ? {} : { fetchContent: cancellationAwareFetch }),
            ...(cancellationAwareInvokeTrigger === undefined ? {} : { invokeTrigger: cancellationAwareInvokeTrigger }),
            ...(ballCustody === undefined ? {} : { ballCustody }),
            ...(cancellationAwareWakeRecovery === undefined ? {} : { managedCommandWakeRecovery: cancellationAwareWakeRecovery }),
          });
        } finally {
          // Some legacy templates intentionally detach best-effort triggers.
          // They may ignore the result, but terminal truth must still wait for
          // the external dispatch attempt to settle.
          await Promise.allSettled([...pendingTriggerEffects]);
        }
      });
      let errorSummary: string | null = null;
      try {
        await withTimeout(rawExecute, task.run.timeoutMs, task.id, executeController);
      } catch (err) {
        outcome = 'RUN_FAILED';
        errorSummary = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
        logger.error(`[scheduler] ${task.id}/${item.subjectKey}: failed`, err);
      }

      ledger.record({
        task_id: task.id,
        subject_key: item.subjectKey,
        outcome,
        signal_summary: typeof item.signal === 'string' ? item.signal : JSON.stringify(item.signal).slice(0, 200),
        duration_ms: Date.now() - itemStartMs,
        started_at: itemStartMs,
        assigned_cat_id: assignedCatId,
        error_summary: errorSummary,
        ...timing,
      });

      // #415: notify on outcome (used for failure notifications)
      if (onItemOutcome) onItemOutcome(task.id, item.subjectKey, outcome, errorSummary);

      // AC-D2: Record emission after successful thread-scoped delivery for self-echo suppression
      if (outcome === 'RUN_DELIVERED' && emissionStore && item.subjectKey.startsWith('thread-')) {
        const threadId = item.subjectKey.slice(7);
        const suppressionMs = task.trigger.type === 'interval' ? Math.max(task.trigger.ms * 2, 60_000) : 300_000;
        emissionStore.record({
          originTaskId: task.id,
          threadId,
          messageId: `run-${task.id}-${Date.now()}`,
          suppressionMs,
        });
      }
    }

    lastRunAt.set(task.id, Date.now());
    logger.info(
      `[scheduler] ${task.id}: tick completed, ${gateResult.workItems.length} items (${Date.now() - startMs}ms)`,
    );
  } finally {
    running.set(task.id, false);
  }
}
