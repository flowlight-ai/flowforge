/**
 * F140: ReviewFeedbackTaskSpec — poll GitHub review 评论/决策（pr_tracking 任务）。
 *
 * Gate: 列 pr_tracking 任务 → fetch review 事件（inline/conversation 双 cursor +
 * decisions）→ cursor 过滤 → workItems。
 * Execute: ReviewFeedbackRouter 路由 → 终态（merged/closed）投影 →
 * durable wake trigger。
 *
 * TS 移植自 clowder-ai `infrastructure/email/ReviewFeedbackTaskSpec.ts` 的结构契约；
 * 收集（fetchReviews）与唤醒（InvokeTriggerPort）注入式。
 */

import type { CatId } from '@flowforge/cats-shared';

import type { ReviewFeedbackRouter, ReviewFeedbackSignal } from './review-feedback-router.ts';
import type { ConflictCheckSpec } from './conflict-check-task-spec.ts';
import type { ConnectorTriggerPolicy, InvokeTriggerPort, TaskListPort } from './conflict-check-task-spec.ts';

export type ReviewFeedbackSpec = Omit<ConflictCheckSpec, 'admission' | 'run'> & {
  admission: {
    gate(): Promise<
      | { run: false; reason: string }
      | { run: true; workItems: Array<{ signal: ReviewFeedbackSignal; subjectKey: string }> }
    >;
  };
  run: {
    overlap: 'skip';
    timeoutMs: number;
    execute(signal: ReviewFeedbackSignal, _subjectKey: string, ctx: { signal?: AbortSignal }): Promise<void>;
  };
};

/** GitHub review 事件收集结果。 */
export interface ReviewFetchResult {
  readonly inlineComments: readonly import('./review-feedback-router.ts').PrFeedbackComment[];
  readonly conversationComments: readonly import('./review-feedback-router.ts').PrFeedbackComment[];
  readonly decisions: readonly import('./review-feedback-router.ts').PrReviewDecision[];
  readonly headSha: string;
  readonly prState: 'open' | 'merged' | 'closed';
}

export interface ReviewFeedbackTaskSpecOptions {
  readonly taskStore: TaskListPort;
  readonly reviewFeedbackRouter: ReviewFeedbackRouter;
  /** 收集 review 事件（inline/conversation cursor + decisions）。 */
  readonly fetchReviews: (
    repoFullName: string,
    prNumber: number,
    cursors: { inlineCommentCursor: number; conversationCommentCursor: number; decisionCursor: number },
    signal?: AbortSignal,
  ) => Promise<ReviewFetchResult | null>;
  readonly invokeTrigger?: InvokeTriggerPort;
  readonly log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  readonly pollIntervalMs?: number;
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

export function createReviewFeedbackTaskSpec(opts: ReviewFeedbackTaskSpecOptions): ReviewFeedbackSpec {
  return {
    id: opts.id ?? 'review-feedback',
    profile: 'poller',
    trigger: { type: 'interval', ms: opts.pollIntervalMs ?? 60_000 },
    admission: {
      async gate() {
        const tasks = (await opts.taskStore.listByKind('pr_tracking')).filter((t) => t.status !== 'done');
        if (tasks.length === 0) return { run: false, reason: 'no tracked PRs' };

        const workItems: Array<{ signal: ReviewFeedbackSignal; subjectKey: string }> = [];
        for (const task of tasks) {
          try {
            const parsed = task.subjectKey ? parsePrSubjectKey(task.subjectKey) : null;
            if (!parsed) continue;
            const { repoFullName, prNumber } = parsed;

            const review = task.automationState?.review;
            const result = await opts.fetchReviews(
              repoFullName,
              prNumber,
              {
                inlineCommentCursor: review?.lastInlineCommentCursor ?? 0,
                conversationCommentCursor: review?.lastConversationCommentCursor ?? 0,
                decisionCursor: review?.lastDecisionCursor ?? 0,
              },
            );
            if (!result) continue;

            const newInline = result.inlineComments.filter((c) => c.id > (review?.lastInlineCommentCursor ?? 0));
            const newConversation = result.conversationComments.filter((c) => c.id > (review?.lastConversationCommentCursor ?? 0));
            const newDecisions = result.decisions.filter((d) => d.id > (review?.lastDecisionCursor ?? 0));
            if (newInline.length === 0 && newConversation.length === 0 && newDecisions.length === 0) continue;

            workItems.push({
              signal: {
                repoFullName,
                prNumber,
                headSha: result.headSha,
                newComments: [...newInline, ...newConversation],
                newDecisions,
                inlineCommentCursor: Math.max(...result.inlineComments.map((c) => c.id), 0),
                conversationCommentCursor: Math.max(...result.conversationComments.map((c) => c.id), 0),
                decisionCursor: Math.max(...result.decisions.map((d) => d.id), 0),
                subjectState: result.prState === 'open' ? undefined : result.prState,
              } as ReviewFeedbackSignal,
              subjectKey: task.subjectKey!,
            });
          } catch (err) {
            opts.log.warn(`[review-feedback] fail-open: skipping PR where fetch failed: ${String(err)}`);
          }
        }
        if (workItems.length === 0) return { run: false, reason: 'no review activity' };
        return { run: true, workItems };
      },
    },
    run: {
      overlap: 'skip',
      timeoutMs: 30_000,
      async execute(signal: ReviewFeedbackSignal, subjectKey: string, ctx: { signal?: AbortSignal }) {
        ctx?.signal?.throwIfAborted();
        const task = await opts.taskStore.listByKind('pr_tracking').then((tasks) =>
          tasks.find((t) => t.subjectKey === subjectKey),
        );
        if (!task?.id) {
          opts.log.warn(`[review-feedback] task not found for ${subjectKey}`);
          return;
        }

        const routeResult = await opts.reviewFeedbackRouter.route(signal, { taskId: task.id });
        if (routeResult.kind !== 'notified' || !opts.invokeTrigger) return;

        const policy: ConnectorTriggerPolicy = {
          priority: signal.newDecisions.some((d) => d.state === 'CHANGES_REQUESTED') ? 'urgent' : 'normal',
          reason: 'github_review_feedback',
          sourceCategory: 'review',
        };
        await opts.invokeTrigger
          .trigger(
            routeResult.threadId,
            routeResult.catId as CatId,
            task.userId ?? '',
            routeResult.content,
            routeResult.messageId,
            undefined,
            policy,
          )
          .catch((err) => opts.log.warn(`[review-feedback] trigger failed (best-effort): ${String(err)}`));
        opts.log.info(`[review-feedback] Triggered ${routeResult.catId} for review feedback`);
      },
    },
    state: { runLedger: 'sqlite' },
    outcome: { whenNoSignal: 'record' },
    enabled: () => true,
    actor: { role: 'repo-watcher', costTier: 'cheap' },
    display: {
      label: 'Review 反馈检查',
      category: 'pr',
      description: '监控 tracked PR 的 review 评论与决策',
      subjectKind: 'pr',
    },
  };
}
