/**
 * Conflict 层测试 — C33（ConflictRouter + ConflictAutoExecutor + TaskSpec + Effects）。
 *
 * 覆盖：ConflictRouter（task 缺失跳过 / UNKNOWN 跳过 / wait-lifecycle notified
 * 透传 / dedup/skipped 归并）；buildConflictMessageContent；ConflictAutoExecutor
 * （非 feat/ 分支拒绝 / 无 worktree 跳过 / runtime worktree 拒绝 / clean-rebase
 * push resolved / 冲突升级含文件清单 / push 拒绝跳过 / rebase 失败无冲突跳过）；
 * createConflictCheckTaskSpec（gate 过滤 done/解析 subjectKey/fail-open、
 * execute 路由 + auto-resolve 后唤醒 / resolved 不再唤醒）；ReviewFeedback
 * 终态效应（community event + distillation merged-only）。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ForgeDistillationService from '@flowforge/infrastructure-distillation';
import type { TaskItem } from '@flowforge/cats-shared';

import {
  buildConflictMessageContent,
  ConflictAutoExecutor,
  ConflictRouter,
  createConflictCheckTaskSpec,
  deliverConnectorMessage,
  projectReviewFeedbackTerminalEffects,
  type ConflictSignal,
  type ConflictSignalWorkItem,
  type InvokeTriggerPort,
  type MessageAppender,
  type TaskListPort,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 't1',
    threadId: 'th1',
    ownerCatId: 'cat-a',
    userId: 'u1',
    subjectKey: 'pr:o/r#1',
    status: 'active',
    kind: 'pr_tracking',
    title: 'PR #1',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as TaskItem;
}

// ---------------------------------------------------------------------------
// ConflictRouter
// ---------------------------------------------------------------------------

describe('ConflictRouter', () => {
  const signal: ConflictSignal = { repoFullName: 'o/r', prNumber: 1, headSha: 'sha1', mergeState: 'CONFLICTING' };

  it('task 缺失 → skipped(No tracking task)', async () => {
    const router = new ConflictRouter({
      taskLookup: { getBySubject: async () => null },
      waitLifecycle: { observe: async () => ({ kind: 'notified', task: { id: 'x', threadId: 't', ownerCatId: 'c' }, messageId: 'm', content: 'c' }) },
      log: silentLog,
    });
    const r = await router.route(signal);
    expect(r.kind).toBe('skipped');
    expect((r as { reason: string }).reason).toContain('No tracking task');
  });

  it('mergeState UNKNOWN → skipped', async () => {
    const router = new ConflictRouter({
      taskLookup: { getBySubject: async () => makeTask() },
      waitLifecycle: { observe: async () => ({ kind: 'notified', task: { id: 'x', threadId: 't', ownerCatId: 'c' }, messageId: 'm', content: 'c' }) },
      log: silentLog,
    });
    const r = await router.route({ ...signal, mergeState: 'UNKNOWN' });
    expect(r).toEqual({ kind: 'skipped', reason: 'mergeState UNKNOWN' });
  });

  it('wait-lifecycle notified → 透传 thread/cat/messageId/content', async () => {
    const router = new ConflictRouter({
      taskLookup: { getBySubject: async () => makeTask() },
      waitLifecycle: {
        observe: async () => ({ kind: 'notified', task: { id: 't1', threadId: 'th1', ownerCatId: 'cat-a' }, messageId: 'm1', content: '🔔 冲突' }),
      },
      log: silentLog,
    });
    const r = await router.route(signal);
    expect(r).toEqual({ kind: 'notified', threadId: 'th1', catId: 'cat-a', messageId: 'm1', content: '🔔 冲突' });
  });

  it('wait-lifecycle deduped/skipped → 归并', async () => {
    const dedup = new ConflictRouter({
      taskLookup: { getBySubject: async () => makeTask() },
      waitLifecycle: { observe: async () => ({ kind: 'deduped', reason: 'same fingerprint' }) },
      log: silentLog,
    });
    expect((await dedup.route(signal)).kind).toBe('deduped');
  });

  it('buildConflictMessageContent 含 mergeState', () => {
    const content = buildConflictMessageContent(signal);
    expect(content).toContain('o/r#1');
    expect(content).toContain('conflicting');
  });
});

// ---------------------------------------------------------------------------
// deliverConnectorMessage
// ---------------------------------------------------------------------------

describe('deliverConnectorMessage', () => {
  it('append 落库（catId → mentions）+ socket 广播 → messageId', async () => {
    const appended: Array<Record<string, unknown>> = [];
    const broadcasts: string[] = [];
    const appender: MessageAppender = {
      append: async (input) => {
        appended.push(input as unknown as Record<string, unknown>);
        return { id: 'msg-1', timestamp: 123 };
      },
    };
    const result = await deliverConnectorMessage(
      { messageStore: appender, socketManager: { broadcastToRoom: (room, event) => broadcasts.push(`${room}:${event}`) } },
      { threadId: 'th1', userId: 'u1', catId: 'cat-a', content: 'hi', source: 'github' as never },
    );
    expect(result.messageId).toBe('msg-1');
    expect(appended[0]).toMatchObject({ threadId: 'th1', mentions: ['cat-a'], content: 'hi' });
    expect(broadcasts).toEqual(['thread:th1:connector_message']);
  });
});

// ---------------------------------------------------------------------------
// ConflictAutoExecutor
// ---------------------------------------------------------------------------

describe('ConflictAutoExecutor', () => {
  function runnerFor(script: (file: string, args: readonly string[]) => { stdout: string } | Error) {
    return {
      exec: async (file: string, args: readonly string[]) => {
        const r = script(file, args);
        if (r instanceof Error) throw r;
        return r;
      },
    };
  }

  it('非 feat/ 分支 → skipped', async () => {
    const exec = new ConflictAutoExecutor({
      log: silentLog,
      runner: runnerFor(() => ({ stdout: 'main\n' })),
      worktreeLister: { list: async () => [] },
    });
    const r = await exec.resolve('o/r', 1);
    expect(r).toMatchObject({ kind: 'skipped', reason: 'branch main is not feat/* — refusing auto-rebase' });
  });

  it('无本地 worktree → skipped', async () => {
    const exec = new ConflictAutoExecutor({
      log: silentLog,
      runner: runnerFor(() => ({ stdout: 'feat/x\n' })),
      worktreeLister: { list: async () => [] },
    });
    const r = await exec.resolve('o/r', 1);
    expect(r).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('no local worktree') });
  });

  it('runtime worktree → 拒绝', async () => {
    const exec = new ConflictAutoExecutor({
      log: silentLog,
      runner: runnerFor(() => ({ stdout: 'feat/x\n' })),
      worktreeLister: { list: async () => [{ branch: 'feat/x', root: '/repo-runtime' }] },
    });
    const r = await exec.resolve('o/r', 1);
    expect(r).toMatchObject({ kind: 'skipped', reason: 'refusing to touch runtime worktree' });
  });

  it('clean rebase → push --force-with-lease → resolved', async () => {
    const calls: string[][] = [];
    const exec = new ConflictAutoExecutor({
      log: silentLog,
      runner: runnerFor((file, args) => {
        calls.push([file, ...args]);
        if (file === 'gh') return { stdout: 'feat/x\n' };
        return { stdout: '' };
      }),
      worktreeLister: { list: async () => [{ branch: 'feat/x', root: '/repo/x' }] },
    });
    const r = await exec.resolve('o/r', 1);
    expect(r).toEqual({ kind: 'resolved', method: 'clean-rebase', branch: 'feat/x' });
    expect(calls.some((c) => c.includes('push') && c.includes('--force-with-lease'))).toBe(true);
  });

  it('rebase 冲突 → abort + 升级（文件清单）', async () => {
    const calls: string[][] = [];
    const exec = new ConflictAutoExecutor({
      log: silentLog,
      runner: runnerFor((file, args) => {
        calls.push([file, ...args]);
        if (file === 'gh') return { stdout: 'feat/x\n' };
        if (args[0] === 'fetch') throw new Error('conflict');
        if (args[0] === 'rebase') throw new Error('conflict');
        if (args[0] === 'diff') return { stdout: 'src/a.ts\nsrc/b.ts\n' };
        if (args[0] === 'rebase' && args[1] === '--abort') return { stdout: '' };
        return { stdout: '' };
      }),
      worktreeLister: { list: async () => [{ branch: 'feat/x', root: '/repo/x' }] },
    });
    const r = await exec.resolve('o/r', 1);
    expect(r).toMatchObject({ kind: 'escalated', files: ['src/a.ts', 'src/b.ts'], branch: 'feat/x' });
    expect(calls.some((c) => c.includes('--abort'))).toBe(true);
  });

  it('push 被拒 → skipped（不升级）', async () => {
    const exec = new ConflictAutoExecutor({
      log: silentLog,
      runner: runnerFor((file, args) => {
        if (file === 'gh') return { stdout: 'feat/x\n' };
        if (args[0] === 'push') throw new Error('rejected');
        return { stdout: '' };
      }),
      worktreeLister: { list: async () => [{ branch: 'feat/x', root: '/repo/x' }] },
    });
    const r = await exec.resolve('o/r', 1);
    expect(r).toMatchObject({ kind: 'skipped', reason: 'push --force-with-lease rejected' });
  });
});

// ---------------------------------------------------------------------------
// createConflictCheckTaskSpec
// ---------------------------------------------------------------------------

describe('createConflictCheckTaskSpec', () => {
  function makeOpts(overrides: Record<string, unknown> = {}) {
    const tasks = [makeTask({ id: 't1', subjectKey: 'pr:o/r#1' }), makeTask({ id: 't2', subjectKey: 'pr:o/r#2', status: 'done' })];
    const taskStore: TaskListPort = {
      listByKind: async () => (overrides.tasks as readonly TaskItem[] | undefined) ?? tasks,
    };
    const conflictRouter = new ConflictRouter({
      taskLookup: { getBySubject: async () => makeTask() },
      waitLifecycle: { observe: async () => ({ kind: 'notified', task: { id: 't1', threadId: 'th1', ownerCatId: 'cat-a' }, messageId: 'm1', content: '🔔' }) },
      log: silentLog,
    });
    const triggered: Array<Record<string, unknown>> = [];
    const invokeTrigger: InvokeTriggerPort = {
      trigger: async (threadId, catId, userId, message, messageId) => {
        triggered.push({ threadId, catId, userId, message, messageId });
        return 'ok';
      },
    };
    return {
      taskStore,
      checkMergeable: async () => ({ mergeState: 'CONFLICTING', headSha: 'sha1' }),
      conflictRouter,
      invokeTrigger,
      log: silentLog,
      triggered,
    };
  }

  it('shape：id/profile/trigger/actor/display + enabled', () => {
    const spec = createConflictCheckTaskSpec(makeOpts());
    expect(spec.id).toBe('conflict-check');
    expect(spec.profile).toBe('poller');
    expect(spec.trigger).toMatchObject({ type: 'interval' });
    expect(spec.actor).toEqual({ role: 'repo-watcher', costTier: 'cheap' });
    expect(spec.enabled()).toBe(true);
  });

  it('gate：过滤 done + 解析 subjectKey + fail-open', async () => {
    const opts = makeOpts();
    // t2 为 done → 过滤；t1 有效 subjectKey → 1 workItem
    const gate = createConflictCheckTaskSpec(opts).admission.gate;
    const r = (await gate()) as { run: true; workItems: Array<{ signal: ConflictSignalWorkItem; subjectKey: string }> };
    expect(r.run).toBe(true);
    expect(r.workItems.length).toBe(1);
    expect(r.workItems[0]?.subjectKey).toBe('pr:o/r#1');
    expect(r.workItems[0]?.signal.signal.mergeState).toBe('CONFLICTING');
  });

  it('gate：无任务 → 不运行', async () => {
    const opts = makeOpts({ tasks: [] });
    const r = await createConflictCheckTaskSpec(opts).admission.gate();
    expect(r).toEqual({ run: false, reason: 'no tracked PRs' });
  });

  it('execute：路由 notified → auto-resolve(escalated) → 唤醒 cat', async () => {
    const opts = makeOpts();
    const spec = createConflictCheckTaskSpec(opts);
    const workItem = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: ConflictSignalWorkItem; subjectKey: string }> };
    await spec.run.execute(workItem.workItems[0]!.signal, workItem.workItems[0]!.subjectKey, {});
    expect(opts.triggered.length).toBe(1);
    expect(opts.triggered[0]).toMatchObject({ threadId: 'th1', catId: 'cat-a', messageId: 'm1' });
  });

  it('execute：auto-resolve resolved → 不再唤醒', async () => {
    const opts = makeOpts();
    const autoExecutor = {
      resolve: async () => ({ kind: 'resolved' as const, method: 'clean-rebase' as const, branch: 'feat/x' }),
    } as unknown as ConflictAutoExecutor;
    const spec = createConflictCheckTaskSpec({ ...opts, autoExecutor });
    const workItem = (await spec.admission.gate()) as { run: true; workItems: Array<{ signal: ConflictSignalWorkItem; subjectKey: string }> };
    await spec.run.execute(workItem.workItems[0]!.signal, workItem.workItems[0]!.subjectKey, {});
    expect(opts.triggered.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ReviewFeedback 终态效应
// ---------------------------------------------------------------------------

describe('projectReviewFeedbackTerminalEffects', () => {
  it('merged → community event + projector；distillation 仅当标题含 F 编号', async () => {
    const events: Array<Record<string, unknown>> = [];
    const projected: Array<Record<string, unknown>> = [];

    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDistillationService, {})) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);

    // 用真实 distillation checkpoint 的 onFeatPhaseClose 由调用方 stub 更简单；
    // 此处验证 community 路径 + distillation 被调用（F 标题）
    const checkpoint = ctx.forgeDistillation;
    const spy = vi.spyOn(checkpoint, 'onFeatPhaseClose').mockImplementation(async (c) => ({ fired: true, sourceId: c.featureId }));

    await projectReviewFeedbackTerminalEffects({
      opts: {
        eventLog: {
          append: async (event) => {
            events.push(event as unknown as Record<string, unknown>);
            return { appended: true };
          },
        },
        projector: {
          apply: async (event) => {
            projected.push(event as Record<string, unknown>);
          },
        },
        distillationCheckpoint: checkpoint,
        log: silentLog,
      },
      task: makeTask(),
      subjectKey: 'pr:o/r#1',
      repoFullName: 'o/r',
      prNumber: 1,
      terminalState: 'merged',
      prTitle: 'F200 Phase B feature',
    });

    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe('pr.merged');
    expect(projected.length).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ featureId: 'F200', phaseLabel: 'B' }));
  });

  it('closed → pr.closed 事件；无 F 标题 → 不触发蒸馏', async () => {
    const events: string[] = [];
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeDistillationService, {})) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    const spy = vi.spyOn(ctx.forgeDistillation, 'onFeatPhaseClose');

    await projectReviewFeedbackTerminalEffects({
      opts: {
        eventLog: { append: async (e) => { events.push(e.kind); return { appended: false }; } },
        distillationCheckpoint: ctx.forgeDistillation,
        log: silentLog,
      },
      task: makeTask(),
      subjectKey: 'pr:o/r#1',
      repoFullName: 'o/r',
      prNumber: 1,
      terminalState: 'closed',
      prTitle: '普通 PR',
    });
    expect(events).toEqual(['pr.closed']);
    expect(spy).not.toHaveBeenCalled();
  });
});
