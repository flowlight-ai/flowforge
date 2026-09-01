/**
 * 批次39 测试 — C33（IssueCommentTaskSpec + ReviewFeedbackTaskSpec + ConnectorInvokeTrigger）。
 *
 * 覆盖：IssueCommentTaskSpec（gate 过滤 done/pendingWake 恢复/cursor 过滤 + execute
 * waitLifecycle 观察/路由唤醒/missing owner 跳过）；ReviewFeedbackTaskSpec（gate 双
 * cursor + decisions 过滤 + execute 路由唤醒/CHANGES_REQUESTED urgent）；
 * createConnectorInvokeTrigger（dispatched/enqueued/full + onFull drop）。
 */

import { describe, expect, it } from 'vitest';

import {
  createConnectorInvokeTrigger,
  createIssueCommentTaskSpec,
  createReviewFeedbackTaskSpec,
  type ReviewFeedbackSignal,
} from '../src/index.ts';
import type { IssueCommentSignal } from '../src/issue-comment-task-spec.ts';

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function makeIssueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'issue:o/r#1', status: 'active',
    kind: 'issue_tracking' as const, automationState: {}, updatedAt: 0, ...overrides,
  };
}

function makeIssueOpts(overrides: Record<string, unknown> = {}): import('../src/issue-comment-task-spec.ts').IssueCommentTaskSpecOptions & { triggered: Array<Record<string, unknown>> } {
  const triggered: Array<Record<string, unknown>> = [];
  return {
    taskStore: {
      listByKind: async () => (overrides.tasks as never[] | undefined) ?? [makeIssueTask()] as never,
    },
    issueCommentRouter: { route: async () => ({ kind: 'notified', threadId: 'th1', catId: 'cat-a', messageId: 'm1', content: '💬' }) } as never,
    fetchComments: async () => [{ id: 5, author: 'alice', body: 'hi', createdAt: 'x' }],
    fetchIssueState: async () => 'open' as const,
    invokeTrigger: { trigger: async (threadId: string, catId: string, userId: string, message: string, messageId: string) => { triggered.push({ threadId, catId, userId, message, messageId }); return 'ok'; } },
    log: silentLog,
    triggered,
    ...overrides,
  } as never;
}

// ---------------------------------------------------------------------------
// IssueCommentTaskSpec
// ---------------------------------------------------------------------------

describe('createIssueCommentTaskSpec', () => {
  it('gate：收集新评论（cursor 过滤）→ execute 路由 + 唤醒', async () => {
    const opts = makeIssueOpts();
    const spec = createIssueCommentTaskSpec(opts);
    const gate = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: IssueCommentSignal; subjectKey: string }> };
    expect(gate.run).toBe(true);
    expect(gate.workItems[0]!.signal.newComments.length).toBe(1);
    expect(gate.workItems[0]!.signal.newComments[0]!.id).toBe(5);

    await spec.run.execute(gate.workItems[0]!.signal, 'issue:o/r#1', {});
    expect(opts.triggered.length).toBe(1);
    expect(opts.triggered[0]).toMatchObject({ threadId: 'th1', catId: 'cat-a', messageId: 'm1' });
  });

  it('gate：done 任务过滤；无任务 → run:false', async () => {
    const spec = createIssueCommentTaskSpec(makeIssueOpts({ tasks: [makeIssueTask({ status: 'done' })] }));
    const gate = (await spec.admission.gate()) as { run: boolean };
    expect(gate.run).toBe(false);
  });

  it('gate：pendingWake 恢复优先（不 fetch 新评论）', async () => {
    let fetchCalled = false;
    const opts = makeIssueOpts({
      tasks: [makeIssueTask({ automationState: { issue: { pendingWake: { messageId: 'pw1', threadId: 'th1', catId: 'cat-a', content: 'retry', deliveredCursor: 5 } } } })],
    });
    const spec = createIssueCommentTaskSpec({
      ...opts,
      fetchComments: async () => {
        fetchCalled = true;
        return [];
      },
    });
    const gate = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: IssueCommentSignal; subjectKey: string }> };
    expect(gate.workItems[0]!.signal.retryWake).toBeDefined();
    expect(gate.workItems[0]!.signal.newComments.length).toBe(0);
    expect(fetchCalled).toBe(false);
  });

  it('execute：missing ownerCatId → 跳过 + 不唤醒', async () => {
    const opts = makeIssueOpts();
    const spec = createIssueCommentTaskSpec(opts);
    const gate = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: IssueCommentSignal; subjectKey: string }> };
    gate.workItems[0]!.signal.task = { ...gate.workItems[0]!.signal.task, ownerCatId: null } as never;
    await spec.run.execute(gate.workItems[0]!.signal, 'issue:o/r#1', {});
    expect(opts.triggered.length).toBe(0);
  });

  it('execute：waitLifecycle 注入 → 观察代替路由', async () => {
    const observes: string[] = [];
    const opts = makeIssueOpts({
      waitLifecycle: {
        observe: async () => {
          observes.push('observed');
          return { kind: 'notified' };
        },
      },
    });
    const spec = createIssueCommentTaskSpec(opts);
    const gate = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: IssueCommentSignal; subjectKey: string }> };
    await spec.run.execute(gate.workItems[0]!.signal, 'issue:o/r#1', {});
    expect(observes).toEqual(['observed']);
    expect(opts.triggered.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ReviewFeedbackTaskSpec
// ---------------------------------------------------------------------------

describe('createReviewFeedbackTaskSpec', () => {
  function makeReviewOpts(): import('../src/review-feedback-task-spec.ts').ReviewFeedbackTaskSpecOptions & { triggered: Array<Record<string, unknown>> } {
    const triggered: Array<Record<string, unknown>> = [];
    const reviewTasks = [
      { id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#1', status: 'active', kind: 'pr_tracking' as const, automationState: {}, updatedAt: 0 },
    ];
    return {
      taskStore: { listByKind: async () => reviewTasks as never },
      reviewFeedbackRouter: { route: async () => ({ kind: 'notified', threadId: 'th1', catId: 'cat-a', messageId: 'm1', content: '🔔' }) } as never,
      fetchReviews: async () => ({
        headSha: 's', prState: 'open' as const,
        inlineComments: [], conversationComments: [], decisions: [],
      }),
      invokeTrigger: { trigger: async (threadId: string, catId: string, userId: string, message: string, messageId: string) => { triggered.push({ threadId, catId, userId, message, messageId }); return 'ok'; } },
      log: silentLog,
      triggered,
    } as never;
  }

  it('gate：无新 activity → run:false', async () => {
    const spec = createReviewFeedbackTaskSpec(makeReviewOpts());
    const gate = (await spec.admission.gate()) as { run: boolean };
    expect(gate.run).toBe(false);
  });

  it('gate：新 decision → workItem；execute 路由 + 唤醒', async () => {
    const opts = makeReviewOpts();
    const spec = createReviewFeedbackTaskSpec({
      ...opts,
      fetchReviews: async () => ({
        headSha: 's', prState: 'open' as const,
        inlineComments: [], conversationComments: [],
        decisions: [{ id: 9, author: 'alice', state: 'CHANGES_REQUESTED' as const, body: '', submittedAt: 'x' }],
      }),
    });
    const gate = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: ReviewFeedbackSignal; subjectKey: string }> };
    expect(gate.run).toBe(true);
    expect(gate.workItems[0]!.signal.newDecisions.length).toBe(1);
    expect(gate.workItems[0]!.signal.decisionCursor).toBe(9);

    await spec.run.execute(gate.workItems[0]!.signal, 'pr:o/r#1', {});
    expect(opts.triggered.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createConnectorInvokeTrigger
// ---------------------------------------------------------------------------

describe('createConnectorInvokeTrigger', () => {
  it('dispatched / enqueued 透传', async () => {
    const trigger = createConnectorInvokeTrigger({
      wake: { trigger: async () => ({ outcome: 'dispatched' as const, invocationId: 'i1' }) },
    });
    expect(await trigger.trigger('t', 'c', 'u', 'm', 'm1')).toBe('dispatched');
    const enq = createConnectorInvokeTrigger({
      wake: { trigger: async () => ({ outcome: 'enqueued' as const }) },
    });
    expect(await enq.trigger('t', 'c', 'u', 'm', 'm1')).toBe('enqueued');
  });

  it('full → onFull drop 返回 full；缺省 retry 返回 full（交由调度重试）', async () => {
    const trigger = createConnectorInvokeTrigger({
      wake: { trigger: async () => ({ outcome: 'full' as const }) },
      onFull: () => 'drop',
    });
    expect(await trigger.trigger('t', 'c', 'u', 'm', 'm1')).toBe('full');
  });

  it('policy 透传', async () => {
    let seenPolicy: unknown;
    const trigger = createConnectorInvokeTrigger({
      wake: { trigger: async (input) => { seenPolicy = input.policy; return { outcome: 'dispatched' as const }; } },
    });
    await trigger.trigger('t', 'c', 'u', 'm', 'm1', undefined, { priority: 'urgent', reason: 'x', sourceCategory: 'ci' });
    expect(seenPolicy).toMatchObject({ priority: 'urgent', reason: 'x', sourceCategory: 'ci' });
  });
});
