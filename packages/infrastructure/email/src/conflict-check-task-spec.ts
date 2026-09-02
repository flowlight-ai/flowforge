/**
 * F139 + F140 + clowder-ai#320: ConflictCheckTaskSpec — 经可注入 check 检测
 * PR 合并冲突的调度任务规格。
 *
 * Gate: 列 pr_tracking 任务 → 逐 PR checkMergeable → 构建 ConflictSignals。
 * Execute: ConflictRouter 处理 dedup/投递 → ConnectorInvokeTrigger 唤醒 cat。
 * KD-9: Gate 传全部 mergeState（含 MERGEABLE），让 ConflictRouter 能清指纹
 * 以便再次冲突检测。
 *
 * TS 移植自 clowder-ai `infrastructure/email/ConflictCheckTaskSpec.ts`。
 * 插件化改造：scheduler TaskSpec_P1/ExecuteContext（未移植完整契约）→ 本包
 * 定义 `ConflictCheckSpec` 结构契约；InvokeTrigger → 注入式端口。
 */

import type { CatId, TaskItem } from '@flowforge/cats-shared';

import type { AutoResolveResult, ConflictAutoExecutor } from './conflict-auto-executor.ts';
import type { ConflictRouter, ConflictSignal } from './conflict-router.ts';

export interface ConflictSignalWorkItem {
  signal: ConflictSignal;
  task: TaskItem;
}

/** 连接器唤醒端口（ConnectorInvokeTrigger 子集）。 */
export interface ConnectorTriggerPolicy {
  readonly priority?: 'urgent' | 'normal';
  readonly reason?: string;
  readonly sourceCategory?: 'ci' | 'review' | 'conflict' | 'scheduled' | 'a2a' | 'issue';
  readonly suggestedSkill?: string;
}

export interface InvokeTriggerPort {
  trigger(
    threadId: string,
    catId: string,
    userId: string,
    message: string,
    messageId: string,
    contentBlocks?: readonly unknown[],
    policy?: ConnectorTriggerPolicy,
  ): Promise<string>;
}

/** TaskStore 端口（#320 统一 TaskStore 的子集）。 */
export interface TaskListPort {
  listByKind(kind: 'pr_tracking' | 'work' | 'issue_tracking'): Promise<readonly TaskItem[]>;
}

/** ConflictCheckSpec 结构契约（对齐 scheduler TaskSpec_P1 的可测子集）。 */
export interface ConflictCheckSpec {
  id: string;
  profile: 'poller';
  trigger: { type: 'interval'; ms: number };
  admission: {
    gate(): Promise<
      | { run: false; reason: string }
      | { run: true; workItems: Array<{ signal: ConflictSignalWorkItem; subjectKey: string }> }
    >;
  };
  run: {
    overlap: 'skip';
    timeoutMs: number;
    execute(workItem: ConflictSignalWorkItem, _subjectKey: string, ctx: { signal?: AbortSignal }): Promise<void>;
  };
  state: { runLedger: 'sqlite' };
  outcome: { whenNoSignal: 'record' };
  enabled(): boolean;
  actor: { role: 'repo-watcher'; costTier: 'cheap' };
  display: {
    label: string;
    category: 'pr';
    description: string;
    subjectKind: 'pr';
  };
}

export interface ConflictCheckTaskSpecOptions {
  readonly taskStore: TaskListPort;
  readonly checkMergeable: (repoFullName: string, prNumber: number) => Promise<{ mergeState: string; headSha: string }>;
  readonly conflictRouter: ConflictRouter;
  readonly invokeTrigger?: InvokeTriggerPort;
  readonly autoExecutor?: ConflictAutoExecutor;
  readonly log: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  readonly pollIntervalMs?: number;
  /** F202-2B: 插件域调度实例的任务 ID 覆盖。 */
  readonly id?: string;
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

async function tryAutoResolveBeforeWake(
  opts: ConflictCheckTaskSpecOptions,
  workItem: ConflictSignalWorkItem,
  signal?: AbortSignal,
): Promise<AutoResolveResult | null> {
  if (!opts.autoExecutor || workItem.signal.mergeState !== 'CONFLICTING' || signal?.aborted) return null;
  try {
    return await opts.autoExecutor.resolve(workItem.signal.repoFullName, workItem.signal.prNumber, signal);
  } catch (error) {
    if (!signal?.aborted) throw error;
    opts.log.warn(`[conflict-check] cancellation interrupted optional auto-resolution; waking owner: ${String(error)}`);
    return null;
  }
}

export function createConflictCheckTaskSpec(opts: ConflictCheckTaskSpecOptions): ConflictCheckSpec {
  return {
    id: opts.id ?? 'conflict-check',
    profile: 'poller',
    trigger: { type: 'interval', ms: opts.pollIntervalMs ?? 5 * 60 * 1000 },
    admission: {
      async gate() {
        // #320: 读统一 TaskStore — 排除 done 任务（PR 已 merged/closed）
        const tasks = (await opts.taskStore.listByKind('pr_tracking')).filter((t) => t.status !== 'done');
        if (tasks.length === 0) {
          return { run: false, reason: 'no tracked PRs' };
        }
        const workItems: Array<{ signal: ConflictSignalWorkItem; subjectKey: string }> = [];
        for (const task of tasks) {
          try {
            const parsed = task.subjectKey ? parsePrSubjectKey(task.subjectKey) : null;
            if (!parsed) continue;
            const { repoFullName, prNumber } = parsed;
            const { mergeState, headSha } = await opts.checkMergeable(repoFullName, prNumber);
            workItems.push({
              signal: { signal: { repoFullName, prNumber, headSha, mergeState }, task },
              subjectKey: task.subjectKey!,
            });
          } catch (err) {
            opts.log.warn(`[conflict-check] fail-open: skipping PR where check failed: ${String(err)}`);
          }
        }
        if (workItems.length === 0) {
          return { run: false, reason: 'no tracked PRs with checkable state' };
        }
        return { run: true, workItems };
      },
    },
    run: {
      overlap: 'skip',
      timeoutMs: 30_000,
      async execute(workItem: ConflictSignalWorkItem, _subjectKey: string, ctx: { signal?: AbortSignal }) {
        ctx.signal?.throwIfAborted();
        const routeResult = await opts.conflictRouter.route(workItem.signal);
        if (routeResult.kind !== 'notified') return;

        // F140 Phase C: 唤醒 cat 前先尝试自动解决
        const result = await tryAutoResolveBeforeWake(opts, workItem, ctx.signal);
        if (result?.kind === 'resolved') {
          opts.log.info(`[conflict-check] Auto-resolved conflict for ${result.branch} (${result.method})`);
          return;
        }
        if (result?.kind === 'escalated') {
          opts.log.info(`[conflict-check] Escalating: ${result.files.length} conflict file(s) in ${result.branch}`);
        }

        if (opts.invokeTrigger) {
          const policy: ConnectorTriggerPolicy = {
            priority: 'urgent',
            reason: 'github_pr_conflict',
            sourceCategory: 'conflict',
          };
          await opts.invokeTrigger
            .trigger(
              routeResult.threadId,
              routeResult.catId as CatId,
              workItem.task.userId ?? '',
              routeResult.content,
              routeResult.messageId,
              undefined,
              policy,
            )
            .catch((err) => opts.log.warn(`[conflict-check] trigger failed (best-effort): ${String(err)}`));
          opts.log.info(`[conflict-check] Triggered ${routeResult.catId} for PR conflict`);
        }
      },
    },
    state: { runLedger: 'sqlite' },
    outcome: { whenNoSignal: 'record' },
    enabled: () => true,
    actor: { role: 'repo-watcher', costTier: 'cheap' },
    display: {
      label: '冲突检测',
      category: 'pr',
      description: '检测 tracked PR 是否有合并冲突',
      subjectKind: 'pr',
    },
  };
}
