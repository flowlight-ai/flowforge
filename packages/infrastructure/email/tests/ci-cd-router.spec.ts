/**
 * CiCdRouter 测试 — C33（CI/CD 路由核心）。
 *
 * 覆盖：settleEmptyCheckRollup（空 rollup 稳定性守卫 60s 提升 pass / 非空重置 /
 * 非 open 直接 present）；classifyCiWaitBucket（billing 全失败 → external_infrastructure）；
 * buildDeliveryDecisionCueCarrier（open+fail+billing+等 CI → merge 候选，否则 null）；
 * route（task 缺失 skipped / CI 禁用 skipNotified / notified 透传 / lifecycle 终态 +
 * terminal 副作用恢复幂等 + done 状态 / deduped）；终态副作用（prLifecycle/
 * distillation/community 各 effect 幂等收据 + completedAt）。
 */

import { describe, expect, it } from 'vitest';

import {
  buildDeliveryDecisionCueCarrier,
  CiCdRouter,
  classifyCiWaitBucket,
  EMPTY_ROLLUP_STABILITY_MS,
  settleEmptyCheckRollup,
  type CiPollResult,
  type CiTaskStorePort,
  type CiWaitLifecyclePort,
} from '../src/index.ts';

const silentLog = { warn: () => {} };

function makePoll(overrides: Partial<CiPollResult> = {}): CiPollResult {
  return {
    repoFullName: 'o/r',
    prNumber: 1,
    headSha: 'sha1',
    prState: 'open',
    aggregateBucket: 'pending',
    checks: [],
    ...overrides,
  };
}

function makeTaskStore(overrides: Partial<CiTaskStorePort> = {}): CiTaskStorePort {
  const task = {
    id: 't1',
    threadId: 'th1',
    ownerCatId: 'cat-a',
    userId: 'u1',
    subjectKey: 'pr:o/r#1',
    status: 'active',
    kind: 'pr_tracking' as const,
    title: 'F200 Phase B PR',
    automationState: {},
    updatedAt: 0,
  };
  return {
    getBySubject: async () => task as never,
    get: async () => task as never,
    update: async (_id, patch) => ({ ...task, ...patch }) as never,
    patchAutomationState: async (_id) => ({ ...task }) as never,
    getManagedWorkBinding: async () => null,
    replaceAutomationStateIfGeneration: async (_id) => {
      const prev = (await overrides.get?.(_id)) as never;
      return prev ?? (task as never);
    },
    ...overrides,
  } as CiTaskStorePort;
}

function makeWaitLifecycle(result: Partial<ReturnType<CiWaitLifecyclePort['observe']> extends Promise<infer T> ? T : never> = {}): CiWaitLifecyclePort {
  return {
    observe: async () =>
      ({
        kind: 'notified',
        task: { id: 't1', threadId: 'th1', ownerCatId: 'cat-a' } as never,
        outcome: { subjectRef: 'sha1' } as never,
        messageId: 'm1',
        content: '🔔 CI 通知',
        ...result,
      }) as never,
  };
}

// ---------------------------------------------------------------------------
// settleEmptyCheckRollup
// ---------------------------------------------------------------------------

describe('settleEmptyCheckRollup', () => {
  it('空 rollup 同 HEAD 满 60s → pass；不足 → pending', () => {
    const now = 1_000_000;
    const poll = makePoll({ prState: 'open', checkRollup: 'empty', aggregateBucket: 'pending' });
    const first = settleEmptyCheckRollup(poll, undefined, now);
    expect(first.poll.aggregateBucket).toBe('pending');
    expect(first.observation).toMatchObject({ state: 'empty', streakStartedAt: now });

    const later = settleEmptyCheckRollup(poll, first.observation, now + EMPTY_ROLLUP_STABILITY_MS + 1);
    expect(later.poll.aggregateBucket).toBe('pass');
  });

  it('非空 rollup / 非 open → present 观察', () => {
    const now = 1_000_000;
    const present = settleEmptyCheckRollup(makePoll({ checkRollup: 'present' }), undefined, now);
    expect(present.poll.aggregateBucket).toBe('pending');
    expect(present.observation.state).toBe('present');

    const closed = settleEmptyCheckRollup(makePoll({ prState: 'merged', checkRollup: 'empty' }), undefined, now);
    expect(closed.observation.state).toBe('present');
  });
});

// ---------------------------------------------------------------------------
// classifyCiWaitBucket / buildDeliveryDecisionCueCarrier
// ---------------------------------------------------------------------------

describe('classifyCiWaitBucket', () => {
  it('非 fail 原样返回；全 fail 均 billing → external_infrastructure', () => {
    expect(classifyCiWaitBucket(makePoll({ aggregateBucket: 'pass' }))).toBe('pass');
    expect(
      classifyCiWaitBucket(
        makePoll({
          aggregateBucket: 'fail',
          checks: [
            { name: 'a', bucket: 'fail', executionFailure: 'billing_spending_limit_zero_step' },
            { name: 'b', bucket: 'fail', executionFailure: 'billing_spending_limit_zero_step' },
          ],
        }),
      ),
    ).toBe('external_infrastructure');
    expect(
      classifyCiWaitBucket(
        makePoll({
          aggregateBucket: 'fail',
          checks: [{ name: 'a', bucket: 'fail', executionFailure: 'billing_spending_limit_zero_step' }, { name: 'b', bucket: 'fail' }],
        }),
      ),
    ).toBe('fail');
  });
});

describe('buildDeliveryDecisionCueCarrier', () => {
  it('open+fail+billing 证据+等 CI+同 head → merge 候选', () => {
    const poll = makePoll({
      aggregateBucket: 'fail',
      checks: [{ name: 'a', bucket: 'fail', executionFailure: 'billing_spending_limit_zero_step' }],
    });
    const task = {
      automationState: {
        await: { continuation: { when: [{ kind: 'pr_ci_terminal' }] } },
        ci: { headSha: 'sha1' },
      },
    };
    const carrier = buildDeliveryDecisionCueCarrier(poll, task as never, 123);
    expect(carrier).not.toBeNull();
    expect(carrier?.candidateAction).toBe('merge');
    expect(carrier?.externalCondition).toBe('billing_spending_limit_zero_step');
  });

  it('条件不满足 → null', () => {
    const task = { automationState: { ci: { headSha: 'other' } } };
    expect(buildDeliveryDecisionCueCarrier(makePoll({ aggregateBucket: 'pass' }), task as never, 1)).toBeNull();
    expect(buildDeliveryDecisionCueCarrier(makePoll({ prState: 'merged' }), task as never, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CiCdRouter.route
// ---------------------------------------------------------------------------

describe('CiCdRouter.route', () => {
  it('task 缺失 → skipped', async () => {
    const router = new CiCdRouter({
      taskStore: { ...makeTaskStore(), getBySubject: async () => null },
      waitLifecycle: makeWaitLifecycle(),
      log: silentLog,
    });
    const r = await router.route(makePoll());
    expect(r).toMatchObject({ kind: 'skipped' });
  });

  it('CI 禁用 → skipped + 一次性 notifySkip', async () => {
    const notifies: Array<{ threadId: string; reason: string }> = [];
    const patches: Array<Record<string, unknown>> = [];
    const taskStore = makeTaskStore();
    const router = new CiCdRouter({
      taskStore: {
        ...taskStore,
        getBySubject: async () => ({
          id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#1', status: 'active', kind: 'pr_tracking',
          automationState: { ci: { enabled: false, skipNotified: false } },
        }) as never,
        patchAutomationState: async (id, patch) => {
          patches.push({ id, patch });
          return null;
        },
      },
      waitLifecycle: makeWaitLifecycle(),
      log: silentLog,
      notifySkip: (threadId, reason) => notifies.push({ threadId, reason }),
    });
    const r = await router.route(makePoll());
    expect(r).toEqual({ kind: 'skipped', reason: 'CI collection disabled' });
    expect(notifies).toEqual([{ threadId: 'th1', reason: 'ci_automation_disabled' }]);
    expect(patches.length).toBe(1);
  });

  it('open + notified → notified 透传（bucket + headSha）', async () => {
    const router = new CiCdRouter({
      taskStore: makeTaskStore(),
      waitLifecycle: makeWaitLifecycle(),
      log: silentLog,
    });
    const r = await router.route(makePoll({ aggregateBucket: 'pass' }));
    expect(r).toMatchObject({
      kind: 'notified',
      threadId: 'th1',
      catId: 'cat-a',
      messageId: 'm1',
      bucket: 'pass',
      headSha: 'sha1',
    });
  });

  it('merged + notified → lifecycle 终态 + done 不入（notified 分支）', async () => {
    const updates: string[] = [];
    const router = new CiCdRouter({
      taskStore: {
        ...makeTaskStore(),
        update: async (id, _patch) => {
          updates.push(id);
          return null;
        },
      },
      waitLifecycle: makeWaitLifecycle(),
      log: silentLog,
    });
    const r = await router.route(makePoll({ prState: 'merged', aggregateBucket: 'pending' }));
    expect(r).toMatchObject({ kind: 'lifecycle', prState: 'merged', content: '🔔 CI 通知' });
    // notified 终态 → 不标记 done
    expect(updates.length).toBe(0);
  });

  it('merged + deduped → 标记 done', async () => {
    const updates: Array<{ id: string; patch: { status: string } }> = [];
    const router = new CiCdRouter({
      taskStore: {
        ...makeTaskStore(),
        update: async (id, patch) => {
          updates.push({ id, patch: patch as { status: string } });
          return null;
        },
      },
      waitLifecycle: makeWaitLifecycle({ kind: 'deduped', reason: 'same' } as never),
      log: silentLog,
    });
    const r = await router.route(makePoll({ prState: 'closed' }));
    expect(r).toMatchObject({ kind: 'deduped' });
    expect(updates).toEqual([{ id: 't1', patch: { status: 'done' } }]);
  });

  it('终态副作用恢复：merged + F 标题 → distillation + community + completedAt 幂等', async () => {
    const distillCalls: string[] = [];
    const events: string[] = [];
    const replaces: Array<{ id: string; automationState: { ci: { terminalEffects?: { distillation?: true; communityProjection?: true } } } }> = [];

    const taskStore = makeTaskStore();
    const router = new CiCdRouter({
      taskStore: {
        ...taskStore,
        get: async () => ({
          id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#1', status: 'active', kind: 'pr_tracking',
          title: 'F200 Phase B PR', updatedAt: 0,
          automationState: { ci: { prState: 'merged' } },
        }) as never,
        replaceAutomationStateIfGeneration: async (id, input) => {
          replaces.push({ id, automationState: input.automationState as never });
          return { id, automationState: input.automationState } as never;
        },
      },
      waitLifecycle: makeWaitLifecycle(),
      log: silentLog,
      distillationCheckpoint: {
        onFeatPhaseClose: async (input) => {
          distillCalls.push(input.featureId);
          return { fired: true, sourceId: `feat-phase-close:${input.featureId}:${input.phaseLabel}` };
        },
      },
      eventLog: {
        append: async (e) => {
          events.push(e.kind);
          return { appended: true };
        },
      },
      projector: { rebuild: async () => {} },
    });
    const r = await router.route(makePoll({ prState: 'merged' }));
    expect(r.kind).toBe('lifecycle');
    expect(distillCalls).toEqual(['F200']);
    expect(events).toEqual(['pr.merged']);
    // 副作用幂等收据写入
    expect(replaces.some((x) => x.automationState.ci.terminalEffects?.distillation === true)).toBe(true);
    expect(replaces.some((x) => x.automationState.ci.terminalEffects?.communityProjection === true)).toBe(true);
  });

  it('wait 观察抛错 + 终态 → 先恢复副作用再上抛', async () => {
    const distillCalls: string[] = [];
    const router = new CiCdRouter({
      taskStore: {
        ...makeTaskStore(),
        get: async () => ({
          id: 't1', threadId: 'th1', ownerCatId: 'cat-a', userId: 'u1', subjectKey: 'pr:o/r#1', status: 'active', kind: 'pr_tracking',
          title: 'F200 Phase B PR', updatedAt: 0,
          automationState: { ci: { prState: 'merged' } },
        }) as never,
      },
      waitLifecycle: {
        observe: async () => {
          throw new Error('delivery failed');
        },
      },
      log: silentLog,
      distillationCheckpoint: {
        onFeatPhaseClose: async (input) => {
          distillCalls.push(input.featureId);
          return { fired: true, sourceId: `feat-phase-close:${input.featureId}:${input.phaseLabel}` };
        },
      },
    });
    await expect(router.route(makePoll({ prState: 'merged' }))).rejects.toThrow('delivery failed');
    expect(distillCalls).toEqual(['F200']);
  });
});
