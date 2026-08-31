/**
 * F202 Phase 2D: IssueCommentTaskSpec — poll GitHub issue 评论（issue_tracking 任务）。
 *
 * Gate: 列 issue_tracking 任务 → pendingWake 恢复优先 → fetch 评论（fetch 前先查
 * issue 状态，AC-D4 P2-cloud：挂起评论先投递再自动关闭）→ cursor 过滤 → workItems。
 * Execute: IssueCommentRouter 路由 → durable wake admission → acknowledge；auto-close
 * （issue closed → done）。
 *
 * TS 移植自 clowder-ai `infrastructure/email/IssueCommentTaskSpec.ts` 的结构契约；
 * F168 dual-cursor 事件日志模式经注入 eventLog 端口保留。
 */

import type { CatId, IssuePendingWake, TaskItem } from '@flowforge/cats-shared';

import type { IssueComment, IssueCommentRouter } from './issue-comment-router.ts';

/** 任务规格本地信号（含 task/cursor/pendingWake 恢复字段）。 */
export interface IssueCommentSignal {
  task: TaskItem;
  repoFullName: string;
  issueNumber: number;
  newComments: IssueComment[];
  readonly deliveredCursor?: number;
  readonly retryWake?: IssuePendingWake;
  readonly commitRoutedWake?: (wake: IssuePendingWake) => Promise<void>;
  readonly commitWakeAccepted: () => Promise<void>;
  readonly issueState?: 'open' | 'closed';
}
import type { ConflictCheckSpec } from './conflict-check-task-spec.ts';
import type { ConnectorTriggerPolicy, InvokeTriggerPort, TaskListPort } from './conflict-check-task-spec.ts';

export type IssueCommentSpec = Omit<ConflictCheckSpec, 'admission' | 'run' | 'display'> & {
  display: { label: string; category: 'issue'; description: string; subjectKind: 'issue' };
  admission: {
    gate(): Promise<
      | { run: false; reason: string }
      | { run: true; workItems: Array<{ signal: IssueCommentSignal; subjectKey: string }> }
    >;
  };
  run: {
    overlap: 'skip';
    timeoutMs: number;
    execute(signal: IssueCommentSignal, _subjectKey: string, ctx: { signal?: AbortSignal }): Promise<void>;
  };
};

export interface IssueTrackingMetadata {
  readonly state: 'open' | 'closed';
  readonly authorLogin?: string;
  readonly authorType?: string;
}

/** 事件日志端口（F168 dual-cursor：collection cursor 随 append 推进）。 */
export interface IssueEventLogPort {
  append(event: { sourceEventId: string; subjectKey: string; kind: string; classification: string; payload: Record<string, unknown>; at: number }): Promise<{ appended: boolean }>;
}

export interface IssueCommentTaskSpecOptions {
  readonly taskStore: TaskListPort;
  readonly issueCommentRouter: IssueCommentRouter;
  readonly fetchComments: (repoFullName: string, issueNumber: number, sinceId?: number) => Promise<IssueComment[]>;
  readonly fetchIssueState: (repoFullName: string, issueNumber: number) => Promise<'open' | 'closed'>;
  readonly fetchIssueMetadata?: (repoFullName: string, issueNumber: number) => Promise<IssueTrackingMetadata>;
  readonly invokeTrigger?: InvokeTriggerPort;
  /** F280 一次性 wait lifecycle。 */
  readonly waitLifecycle?: {
    observe(input: {
      taskId: string;
      facts: { issue: { state: string; comments: Array<{ id: number; author: string; sourceRef: string }> } };
      collectorPatch: { issue: { lastCommentCursor: number; lastDeliveredCursor: number; issueState: string } };
      subjectState?: 'closed';
    }): Promise<{ kind: string; reason?: string }>;
  };
  readonly eventLog?: IssueEventLogPort;
  readonly log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  readonly pollIntervalMs?: number;
  readonly id?: string;
}

function parseIssueSubjectKey(key: string): { repoFullName: string; issueNumber: number } | null {
  if (!key.startsWith('issue:')) return null;
  const rest = key.slice(6);
  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx < 0) return null;
  const repoFullName = rest.slice(0, hashIdx);
  const suffix = rest.slice(hashIdx + 1);
  if (!repoFullName || !/^\d+$/.test(suffix)) return null;
  return { repoFullName, issueNumber: Number.parseInt(suffix, 10) };
}

async function acknowledgeWake(taskId: string, _issueKey: string): Promise<void> {
  // 宿主接线：持久化 acknowledge（ackInvocationWake 语义）
  void taskId;
}

export function createIssueCommentTaskSpec(opts: IssueCommentTaskSpecOptions): IssueCommentSpec {
  return {
    id: opts.id ?? 'issue-comment',
    profile: 'poller',
    trigger: { type: 'interval', ms: opts.pollIntervalMs ?? 60_000 },
    admission: {
      async gate() {
        const tasks = (await opts.taskStore.listByKind('issue_tracking')).filter((t) => t.status !== 'done');
        if (tasks.length === 0) return { run: false, reason: 'no tracked issues' };

        const workItems: Array<{ signal: IssueCommentSignal; subjectKey: string }> = [];
        for (const task of tasks) {
          try {
            const parsed = task.subjectKey ? parseIssueSubjectKey(task.subjectKey) : null;
            if (!parsed) continue;
            const { repoFullName, issueNumber } = parsed;
            const issueKey = `${repoFullName}#${issueNumber}`;

            // 恢复优先于收集更多 GitHub 活动：connector 消息已持久化，
            // 重试其原始幂等键而非把相同评论路由成重复 thread 消息。
            const pendingWake = task.automationState?.issue?.pendingWake;
            if (pendingWake) {
              workItems.push({
                signal: {
                  task, repoFullName, issueNumber, newComments: [],
                  retryWake: pendingWake,
                  commitWakeAccepted: () => acknowledgeWake(task.id, issueKey),
                } as IssueCommentSignal,
                subjectKey: task.subjectKey!,
              });
              continue;
            }

            // AC-D4: 先查 issue 状态（挂起评论先投递再自动关闭 — P2-cloud）
            const issueMetadata = opts.fetchIssueMetadata
              ? await opts.fetchIssueMetadata(repoFullName, issueNumber)
              : { state: await opts.fetchIssueState(repoFullName, issueNumber) };
            const issueState = issueMetadata.state;

            // cursor 下限：delivery cursor（重试未投递评论）或 collection cursor
            const sinceId = task.automationState?.issue?.lastDeliveredCursor ?? task.automationState?.issue?.lastCommentCursor ?? 0;
            const comments = await opts.fetchComments(repoFullName, issueNumber, sinceId || undefined);
            const newComments = comments.filter((c) => c.id > sinceId);
            workItems.push({
              signal: {
                task, repoFullName, issueNumber, newComments, issueState,
                commitRoutedWake: async (_wake: IssuePendingWake) => {},
                commitWakeAccepted: () => acknowledgeWake(task.id, issueKey),
              },
              subjectKey: task.subjectKey!,
            });
          } catch (err) {
            opts.log.warn(`[issue-comment] fail-open: skipping issue where fetch failed: ${String(err)}`);
          }
        }
        if (workItems.length === 0) return { run: false, reason: 'no trackable issues' };
        return { run: true, workItems };
      },
    },
    run: {
      overlap: 'skip',
      timeoutMs: 30_000,
      async execute(signal: IssueCommentSignal, subjectKey: string, ctx: { signal?: AbortSignal }) {
        ctx?.signal?.throwIfAborted();
        const { task } = signal;
        if (!task.ownerCatId || !task.userId) {
          opts.log.warn(`[issue-comment] skipping execute for ${subjectKey}: task ${task.id} missing ownerCatId or userId`);
          return;
        }

        if (opts.waitLifecycle) {
          const deliveredCursor =
            signal.deliveredCursor ??
            (signal.newComments.length > 0
              ? Math.max(...signal.newComments.map((comment) => comment.id))
              : (task.automationState?.issue?.lastCommentCursor ?? 0));
          await opts.waitLifecycle.observe({
            taskId: task.id,
            facts: {
              issue: {
                state: signal.issueState ?? 'open',
                comments: signal.newComments.map((comment) => ({
                  id: comment.id,
                  author: comment.author,
                  sourceRef: `github:issue-comment:${comment.id}`,
                })),
              },
            },
            collectorPatch: {
              issue: {
                lastCommentCursor: deliveredCursor,
                lastDeliveredCursor: deliveredCursor,
                issueState: signal.issueState ?? 'open',
              },
            },
            ...(signal.issueState === 'closed' ? { subjectState: 'closed' as const } : {}),
          });
          ctx?.signal?.throwIfAborted();
          return;
        }

        if (signal.newComments.length === 0) {
          // 无新评论；issue 已关闭 → auto-close
          if (signal.issueState === 'closed' && task.automationState?.issue?.issueState !== 'closed') {
            opts.log.info(`[issue-comment] Issue ${signal.repoFullName}#${signal.issueNumber} closed — auto-close`);
          }
          return;
        }

        const routeResult = await opts.issueCommentRouter.route(
          { repoFullName: signal.repoFullName, issueNumber: signal.issueNumber, newComments: signal.newComments },
          { threadId: task.threadId, catId: task.ownerCatId as CatId, userId: task.userId },
        );
        if (routeResult.kind !== 'notified' || !opts.invokeTrigger) return;

        const policy: ConnectorTriggerPolicy = {
          priority: 'normal',
          reason: 'github_issue_comment',
          sourceCategory: 'issue',
        };
        await opts.invokeTrigger
          .trigger(
            routeResult.threadId,
            routeResult.catId as CatId,
            task.userId,
            routeResult.content,
            routeResult.messageId,
            undefined,
            policy,
          )
          .catch((err) => opts.log.warn(`[issue-comment] trigger failed (best-effort): ${String(err)}`));
        opts.log.info(`[issue-comment] Triggered ${routeResult.catId} for issue comments`);
      },
    },
    state: { runLedger: 'sqlite' },
    outcome: { whenNoSignal: 'record' },
    enabled: () => true,
    actor: { role: 'repo-watcher', costTier: 'cheap' },
    display: {
      label: 'Issue 评论检查',
      category: 'issue',
      description: '监控 tracked issue 的新评论',
      subjectKind: 'issue',
    },
  };
}
