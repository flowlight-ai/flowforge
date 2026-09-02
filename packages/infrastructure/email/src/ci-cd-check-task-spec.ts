/**
 * F139 + clowder-ai#320: CiCdCheckTaskSpec — 以 poller 规格轮询已跟踪 PR 的 CI。
 *
 * Gate: 列 pr_tracking 任务 → shouldCollectTask 过滤（CI 禁用/done+需恢复/
 * F168 external-review 延续）→ 单次 tick 级批量 GraphQL 读取（fetchPrStatuses，
 * 不归首 item 所有，item 超时信号不得取消兄弟 work item 的共享事实）。
 * Execute: fetch（精确单 PR 或 tick 快照）→ CiCdRouter.route → lifecycle/notified
 * 唤醒（self-merge 跳过 / fail urgent）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/CiCdCheckTaskSpec.ts`。
 * 插件化改造：scheduler TaskSpec_P1/ExecuteContext → 本包 `CiCdCheckSpec` 契约。
 */

import type { CatId, TaskItem } from '@flowforge/cats-shared';

import { fetchPrCiStatuses, ciStatusTargetKey, type PrCiStatusTarget } from './ci-status-batch-fetcher.ts';
import type { CiCdRouter, CiRouteResult } from './ci-cd-router.ts';
import type { ConflictCheckSpec } from './conflict-check-task-spec.ts';
import type { ConnectorTriggerPolicy, InvokeTriggerPort, TaskListPort } from './conflict-check-task-spec.ts';

export interface CiCdCheckSignal {
  task: TaskItem;
  repoFullName: string;
  prNumber: number;
  /** Tick-level batch snapshot; production reads it once in admission.gate. */
  pollResult?: CiPollResultLike | null;
}

/** CiPollResult 的结构子集（gate/execute 共享，避免重导入）。 */
export interface CiPollResultLike {
  prState: 'open' | 'merged' | 'closed';
  headSha: string;
  mergedByLogin?: string;
  checks: ReadonlyArray<{ bucket: string; executionFailure?: string }>;
  aggregateBucket: string;
}

export type CiCdCheckSpec = Omit<ConflictCheckSpec, 'admission' | 'run'> & {
  admission: {
    gate(): Promise<
      | { run: false; reason: string }
      | { run: true; workItems: Array<{ signal: CiCdCheckSignal; subjectKey: string }> }
    >;
  };
  run: {
    overlap: 'skip';
    timeoutMs: number;
    execute(signal: CiCdCheckSignal, _subjectKey: string, ctx: { signal?: AbortSignal }): Promise<void>;
  };
};

export interface CiCdCheckTaskSpecOptions {
  readonly taskStore: TaskListPort;
  readonly cicdRouter: CiCdRouter;
  readonly invokeTrigger?: InvokeTriggerPort;
  readonly fetchPrStatus?: (
    repoFullName: string,
    prNumber: number,
    signal?: AbortSignal,
  ) => Promise<CiPollResultLike | null>;
  /** F304 test seam for the production one-process-per-tick GraphQL reader. */
  readonly fetchPrStatuses?: (
    targets: readonly PrCiStatusTarget[],
    signal?: AbortSignal,
  ) => Promise<ReadonlyMap<string, CiPollResultLike | null>>;
  readonly log: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  readonly pollIntervalMs?: number;
  /**
   * F168 external-case collection outlives one F280 wait generation. A done
   * wait remains collectable only when the canonical external-review policy
   * says this PR still has an open maintainer-review lifecycle.
   */
  readonly continueDoneTracking?: (repoFullName: string, prNumber: number) => Promise<boolean>;
  /** F202-2B: Override task ID for plugin-scoped schedule instances. */
  readonly id?: string;
  /** Filter self-merges: mergedByLogin === own authenticated identity → skip wake. */
  readonly isSelfMerge?: (mergedByLogin: string) => boolean;
}

function parsePrSubjectKey(key: string): { repoFullName: string; prNumber: number } | null {
  if (!key.startsWith('pr:')) return null;
  const rest = key.slice(3);
  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx < 0) return null;
  const repoFullName = rest.slice(0, hashIdx);
  const suffix = rest.slice(hashIdx + 1);
  if (!repoFullName || !/^\d+$/.test(suffix)) return null;
  return { repoFullName, prNumber: Number.parseInt(suffix, 10) };
}

/**
 * PR 终态（merged/closed）精确消费一次活动 wait。
 * 生产环境恰好触发一次：CiCdRouter 持久化 ci.prState 且 gate 过滤已完成生命周期任务。
 */
async function triggerLifecycleWake(
  opts: CiCdCheckTaskSpecOptions,
  invokeTrigger: InvokeTriggerPort,
  signal: CiCdCheckSignal,
  routeResult: Extract<CiRouteResult, { kind: 'lifecycle' }>,
): Promise<void> {
  const policy: ConnectorTriggerPolicy = {
    priority: 'normal',
    reason: routeResult.prState === 'merged' ? 'github_pr_merged' : 'github_pr_closed',
    sourceCategory: 'ci',
  };
  await invokeTrigger
    .trigger(
      routeResult.threadId,
      routeResult.catId as CatId,
      signal.task.userId ?? '',
      routeResult.content,
      routeResult.messageId,
      undefined,
      policy,
    )
    .catch((err) => opts.log.warn(`[cicd-check] lifecycle trigger failed (best-effort): ${String(err)}`));
  opts.log.info(`[cicd-check] PR ${routeResult.prState} -> wake ${routeResult.catId} (terminal lifecycle)`);
}

function needsCiLifecycleRecovery(task: TaskItem): boolean {
  const reviewTerminalState = task.automationState?.review?.prState;
  const ciTerminalState = task.automationState?.ci?.prState;
  const terminalEffects = task.automationState?.ci?.terminalEffects;
  const worldTruthPending =
    (ciTerminalState === 'merged' || ciTerminalState === 'closed') &&
    (terminalEffects?.prState !== ciTerminalState || terminalEffects.completedAt === undefined);
  return (
    task.status === 'done' &&
    (worldTruthPending || ((reviewTerminalState === 'merged' || reviewTerminalState === 'closed') && !ciTerminalState))
  );
}

async function shouldCollectTask(
  opts: CiCdCheckTaskSpecOptions,
  task: TaskItem,
  repoFullName: string,
  prNumber: number,
  _subjectKey: string,
): Promise<boolean> {
  if (task.automationState?.ci?.enabled === false) return false;
  if (task.status !== 'done' || needsCiLifecycleRecovery(task)) return true;
  if (!opts.continueDoneTracking) return false;
  try {
    return await opts.continueDoneTracking(repoFullName, prNumber);
  } catch (error) {
    opts.log.warn(`[F168] external-review CI continuation check failed; deferring collection: ${String(error)}`);
    return false;
  }
}

export function createCiCdCheckTaskSpec(opts: CiCdCheckTaskSpecOptions): CiCdCheckSpec {
  const fetchPrStatuses =
    opts.fetchPrStatuses ??
    ((targets: readonly PrCiStatusTarget[], signal?: AbortSignal) =>
      fetchPrCiStatuses(targets, opts.log, { ...(signal !== undefined ? { signal } : {}) }));

  return {
    id: opts.id ?? 'cicd-check',
    profile: 'poller',
    trigger: { type: 'interval', ms: opts.pollIntervalMs ?? 60_000 },
    admission: {
      async gate() {
        // #320: 读统一 TaskStore — CI 生命周期完成后排除 done 任务。
        // Review feedback 可能先观察终态 PR；保留这些 done 任务可达，
        // 直到 CiCdRouter 交付/记录 CI 生命周期标记。
        const allTasks = await opts.taskStore.listByKind('pr_tracking');
        const workItems: Array<{ signal: CiCdCheckSignal; subjectKey: string }> = [];
        for (const task of allTasks) {
          const subjectKey = task.subjectKey;
          if (!subjectKey) continue;
          const parsed = parsePrSubjectKey(subjectKey);
          if (!parsed) continue;
          if (!(await shouldCollectTask(opts, task, parsed.repoFullName, parsed.prNumber, subjectKey))) continue;
          workItems.push({
            signal: { task, repoFullName: parsed.repoFullName, prNumber: parsed.prNumber },
            subjectKey,
          });
        }
        if (workItems.length === 0) {
          return { run: false, reason: 'no parseable PR tasks' };
        }

        if (!opts.fetchPrStatus) {
          // 一次 tick 级读取，非首 item 私有；item 超时信号不得取消兄弟共享事实
          const targets = workItems.map(({ signal }) => ({
            repoFullName: signal.repoFullName,
            prNumber: signal.prNumber,
          }));
          const results = await fetchPrStatuses(targets);
          for (const workItem of workItems) {
            workItem.signal.pollResult =
              results.get(ciStatusTargetKey(workItem.signal.repoFullName, workItem.signal.prNumber)) ?? null;
          }
        }
        return { run: true, workItems };
      },
    },
    run: {
      overlap: 'skip',
      timeoutMs: 30_000,
      async execute(signal: CiCdCheckSignal, _subjectKey: string, ctx: { signal?: AbortSignal }) {
        ctx.signal?.throwIfAborted();
        const pollResult = opts.fetchPrStatus
          ? await opts.fetchPrStatus(signal.repoFullName, signal.prNumber, ctx.signal)
          : signal.pollResult;
        ctx.signal?.throwIfAborted();
        if (!pollResult) return;

        const routeResult = await opts.cicdRouter.route(pollResult as never);
        if (!opts.invokeTrigger) return;

        if (routeResult.kind === 'lifecycle') {
          // self-merge：合并者已知 PR 状态，跳过唤醒省 token；
          // 消息投递已在 CiCdRouter 内完成
          if (pollResult.mergedByLogin && opts.isSelfMerge?.(pollResult.mergedByLogin)) {
            opts.log.info(`[cicd-check] PR ${routeResult.prState} by self (${pollResult.mergedByLogin}) -> skip wake`);
            return;
          }
          await triggerLifecycleWake(opts, opts.invokeTrigger, signal, routeResult);
          return;
        }

        if (routeResult.kind !== 'notified') return;

        const policy: ConnectorTriggerPolicy = {
          priority: routeResult.bucket === 'fail' ? 'urgent' : 'normal',
          reason: 'github_wait_satisfied',
          sourceCategory: 'ci',
        };
        await opts.invokeTrigger
          .trigger(
            routeResult.threadId,
            routeResult.catId as CatId,
            signal.task.userId ?? '',
            routeResult.content,
            routeResult.messageId,
            undefined,
            policy,
          )
          .catch((err) => opts.log.warn(`[cicd-check] wait trigger failed (best-effort): ${String(err)}`));
        opts.log.info(`[cicd-check] Typed wait satisfied → wake ${routeResult.catId}`);
      },
    },
    state: { runLedger: 'sqlite' },
    outcome: { whenNoSignal: 'record' },
    enabled: () => true,
    actor: { role: 'repo-watcher', costTier: 'cheap' },
    display: {
      label: 'CI/CD 检查',
      category: 'pr',
      description: '监控 tracked PR 的 CI 状态变化',
      subjectKind: 'pr',
    },
  };
}
