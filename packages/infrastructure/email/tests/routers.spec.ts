/**
 * 批次38 测试 — C33（CiCdCheckTaskSpec + IssueCommentRouter + ReviewFeedbackRouter + backfill）。
 *
 * 覆盖：issue-fix-evidence（FIX_CLAIM_PATTERN 判定 + PR/commit/release URL 提取 +
 * 校验拒绝 + selectIssueFixReadiness 三态）；IssueCommentRouter（无新评论跳过 +
 * notified 投递 + 外部内容包裹 + fix readiness 标注）；buildReviewFeedbackContent；
 * ReviewFeedbackRouter（wait-lifecycle notified 透传 + skipped）；CiCdCheckTaskSpec
 * （gate 过滤 done/CI 禁用/批量 GraphQL 快照 + execute lifecycle/notified 唤醒 +
 * self-merge 跳过）；backfillLegacyPrTracking（migrate/skip）。
 */

import { describe, expect, it } from 'vitest';

import {
  backfillLegacyPrTracking,
  buildIssueCommentContent,
  buildReviewFeedbackContent,
  createCiCdCheckTaskSpec,
  extractIssueFixEvidence,
  hasIssueFixClaim,
  IssueCommentRouter,
  ReviewFeedbackRouter,
  selectIssueFixReadiness,
  validateIssueFixEvidence,
  type IssueCommentSignal,
  type MessageAppender,
} from '../src/index.ts';

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

// ---------------------------------------------------------------------------
// issue-fix-evidence
// ---------------------------------------------------------------------------

describe('issue-fix-evidence', () => {
  it('hasIssueFixClaim / isCriticalIssueSignal', () => {
    expect(hasIssueFixClaim('已修复该问题')).toBe(true);
    expect(hasIssueFixClaim('fixes the bug')).toBe(true);
    expect(hasIssueFixClaim('普通评论')).toBe(false);
  });

  it('extractIssueFixEvidence：PR / commit / release URL', () => {
    expect(extractIssueFixEvidence('PR: https://github.com/o/r/pull/42'))?.toMatchObject({
      kind: 'pull_request',
      number: 42,
    });
    expect(extractIssueFixEvidence('见 https://github.com/o/r/commit/abcdef1234567'))?.toMatchObject({
      kind: 'commit',
      sha: 'abcdef1234567',
    });
    expect(extractIssueFixEvidence('https://github.com/o/r/releases/tag/v1.2.3'))?.toMatchObject({
      kind: 'release',
      tag: 'v1.2.3',
    });
  });

  it('validateIssueFixEvidence：非法拒绝', () => {
    expect(validateIssueFixEvidence({ kind: 'pull_request', url: 'https://evil.com/x', number: 1 })).toBeNull();
    expect(validateIssueFixEvidence({ kind: 'commit', sha: 'nothex' })).toBeNull();
    expect(validateIssueFixEvidence(null)).toBeNull();
  });

  it('selectIssueFixReadiness：ready（evidence）/ waiting（claim 无证据）/ ignore', () => {
    const comment = (body: string) => ({
      sourceEventId: 'x',
      subjectKey: 'issue:o/r#1',
      kind: 'issue.commented' as const,
      classification: 'informational' as const,
      payload: { body },
      at: 0,
    });
    expect(selectIssueFixReadiness({ events: [comment('已修复：https://github.com/o/r/pull/9')] }).kind).toBe('ready');
    expect(selectIssueFixReadiness({ events: [comment('已修复该问题')] })).toEqual({
      kind: 'waiting',
      reason: 'fix_claim_without_evidence',
    });
    expect(selectIssueFixReadiness({ events: [comment('普通回复')] })).toEqual({
      kind: 'ignore',
      reason: 'no_fix_claim',
    });
  });
});

// ---------------------------------------------------------------------------
// IssueCommentRouter
// ---------------------------------------------------------------------------

describe('IssueCommentRouter', () => {
  const deliveryDeps = (capture: Array<Record<string, unknown>>) => ({
    messageStore: {
      append: async (input: Record<string, unknown>) => {
        capture.push(input);
        return { id: 'msg-1', timestamp: 1 };
      },
    } as MessageAppender,
  });

  it('无新评论 → skipped', async () => {
    const router = new IssueCommentRouter({ deliveryDeps: deliveryDeps([]), log: silentLog });
    const r = await router.route({ repoFullName: 'o/r', issueNumber: 1, newComments: [] } as IssueCommentSignal, {
      threadId: 't', catId: 'c', userId: 'u',
    });
    expect(r).toEqual({ kind: 'skipped', reason: 'no new comments' });
  });

  it('通知投递：外部内容包裹 + source 元数据', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const router = new IssueCommentRouter({ deliveryDeps: deliveryDeps(captured), log: silentLog });
    const r = await router.route(
      { repoFullName: 'o/r', issueNumber: 7, newComments: [{ id: 1, author: 'alice', body: 'hello', createdAt: '2026-01-01' }] } as IssueCommentSignal,
      { threadId: 't1', catId: 'cat-a', userId: 'u1' },
    );
    expect(r.kind).toBe('notified');
    expect(captured[0]).toMatchObject({ threadId: 't1', catId: null, mentions: ['cat-a'] });
    expect((captured[0]!.content as string)).toContain('[UNTRUSTED EXTERNAL CONTENT]');
    expect((captured[0]!.source as { connector: string }).connector).toBe('github-issue-comment');
  });

  it('buildIssueCommentContent：fix readiness 标注', () => {
    const content = buildIssueCommentContent({
      repoFullName: 'o/r', issueNumber: 7,
      newComments: [{ id: 1, author: 'alice', body: '已修复：https://github.com/o/r/pull/9', createdAt: '2026-01-01' }],
    } as IssueCommentSignal);
    expect(content).toContain('🚦 **Fix evidence — ready for re-review**');
  });
});

// ---------------------------------------------------------------------------
// ReviewFeedbackRouter
// ---------------------------------------------------------------------------

describe('ReviewFeedbackRouter', () => {
  it('wait-lifecycle notified → 透传', async () => {
    const router = new ReviewFeedbackRouter({
      waitLifecycle: {
        observe: async () => ({ kind: 'notified', task: { threadId: 'th1', ownerCatId: 'cat-a' }, messageId: 'm1', content: '🔔' }),
      },
      log: silentLog,
    });
    const r = await router.route(
      { headSha: 's', inlineCommentCursor: 0, conversationCommentCursor: 0, decisionCursor: 0, newComments: [], newDecisions: [] } as never,
      { taskId: 't1' },
    );
    expect(r).toEqual({ kind: 'notified', threadId: 'th1', catId: 'cat-a', messageId: 'm1', content: '🔔' });
  });

  it('wait-lifecycle skipped → skipped', async () => {
    const router = new ReviewFeedbackRouter({
      waitLifecycle: { observe: async () => ({ kind: 'deduped', reason: 'same' }) },
      log: silentLog,
    });
    const r = await router.route({ headSha: 's', inlineCommentCursor: 0, conversationCommentCursor: 0, decisionCursor: 0, newComments: [], newDecisions: [] } as never, { taskId: 't1' });
    expect(r.kind).toBe('skipped');
  });

  it('buildReviewFeedbackContent：decision 行 / frontier 行', () => {
    const withDecision = buildReviewFeedbackContent({ repoFullName: 'o/r', prNumber: 1, newComments: [], newDecisions: [{ id: 5, author: 'alice', state: 'APPROVED', body: '', submittedAt: 'x' }] });
    expect(withDecision).toContain('review result: APPROVED (alice)');
    const noDecision = buildReviewFeedbackContent({ repoFullName: 'o/r', prNumber: 1, newComments: [{ id: 1, author: 'a', body: 'b', createdAt: 'c', commentType: 'conversation' }], newDecisions: [] });
    expect(noDecision).toContain('frontier advanced (1 item)');
  });
});

// ---------------------------------------------------------------------------
// CiCdCheckTaskSpec
// ---------------------------------------------------------------------------

describe('createCiCdCheckTaskSpec', () => {
  function makeOpts(
    overrides: Record<string, unknown> = {},
  ): import('../src/index.ts').CiCdCheckTaskSpecOptions & { triggered: Array<Record<string, unknown>> } {
    const tasks = [
      { id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#1', status: 'active', kind: 'pr_tracking', automationState: {}, updatedAt: 0 },
      { id: 't2', threadId: 'th2', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#2', status: 'done', kind: 'pr_tracking', automationState: {}, updatedAt: 0 },
    ];
    const triggered: Array<Record<string, unknown>> = [];
    return {
      taskStore: { listByKind: async () => (overrides.tasks as never[] | undefined) ?? tasks } as never,
      cicdRouter: { route: async () => ({ kind: 'notified', threadId: 'th1', catId: 'cat-a', messageId: 'm1', content: '🔔', bucket: 'fail', headSha: 's' }) } as never,
      invokeTrigger: { trigger: async (threadId: string, catId: string, userId: string, message: string, messageId: string) => { triggered.push({ threadId, catId, userId, message, messageId }); return 'ok'; } },
      fetchPrStatuses: async () => new Map() as never,
      fetchPrStatus: async () => ({ prState: 'open' as const, headSha: 's', aggregateBucket: 'fail' as const, checks: [] }),
      log: silentLog,
      triggered,
    };
  }

  it('gate：批量快照 + workItems；execute notified → 唤醒（fail → urgent）', async () => {
    const opts = makeOpts();
    const spec = createCiCdCheckTaskSpec(opts);
    const gate = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: { repoFullName: string; prNumber: number; pollResult: unknown } }> };
    expect(gate.run).toBe(true);
    expect(gate.workItems.length).toBe(1);
    // t2 done 但无 CI 终态收据 → needsCiLifecycleRecovery false（无 review prState）→ 仍收集? done 且非恢复 → 仅 continueDoneTracking；未提供 → false
    // t1 active → 收集
    await spec.run.execute(gate.workItems[0]!.signal as never, 'pr:o/r#1', {});
    expect(opts.triggered.length).toBe(1);
  });

  it('gate：CI 禁用任务被过滤', async () => {
    const opts = makeOpts({
      tasks: [
        { id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#1', status: 'active', kind: 'pr_tracking', automationState: { ci: { enabled: false } }, updatedAt: 0 },
      ],
    });
    const spec = createCiCdCheckTaskSpec(opts);
    const gate = (await spec.admission.gate()) as { run: boolean; workItems?: unknown[] };
    // CI 禁用 → shouldCollectTask false → 无 workItems → run:false
    expect(gate.run).toBe(false);
  });

  it('execute：lifecycle + self-merge → 跳过唤醒', async () => {
    const opts = makeOpts();
    const spec = createCiCdCheckTaskSpec({
      ...opts,
      fetchPrStatus: async () => ({ prState: 'merged', headSha: 's', mergedByLogin: 'me' }) as never,
      isSelfMerge: () => true,
      cicdRouter: { route: async () => ({ kind: 'lifecycle', threadId: 'th1', catId: 'cat-a', messageId: 'm1', content: '🎉', prState: 'merged' }) } as never,
    });
    await spec.run.execute({ task: {} as never, repoFullName: 'o/r', prNumber: 1, pollResult: null }, 'pr:o/r#1', {});
    expect(opts.triggered.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// backfillLegacyPrTracking
// ---------------------------------------------------------------------------

describe('backfillLegacyPrTracking', () => {
  it('migrate 新条目 + skip 已存在 + automationState 映射', async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const result = await backfillLegacyPrTracking({
      legacyStore: {
        listAll: async () => [
          { repoFullName: 'o/r', prNumber: 1, catId: 'cat-a', threadId: 'th1', userId: 'u1', registeredAt: 0, headSha: 'sha1', lastCiBucket: 'fail' },
          { repoFullName: 'o/r', prNumber: 2, catId: 'cat-a', threadId: 'th2', userId: 'u1', registeredAt: 0 },
        ],
      } as never,
      taskStore: {
        getBySubject: async (sk) => (sk === 'pr:o/r#2' ? ({} as never) : null),
        upsertBySubject: async (input) => {
          upserts.push(input as unknown as Record<string, unknown>);
          return null;
        },
      },
      log: silentLog,
    });
    expect(result).toEqual({ migrated: 1, skipped: 1 });
    expect(upserts[0]).toMatchObject({
      kind: 'pr_tracking',
      subjectKey: 'pr:o/r#1',
      automationState: { ci: { headSha: 'sha1', lastBucket: 'fail', enabled: true } },
    });
  });
});
