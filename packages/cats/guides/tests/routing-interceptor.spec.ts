/**
 * C25 GuideRoutingInterceptor 测试（F155，clowder GuideRoutingInterceptor.ts 直译）。
 *
 * Three phases：
 *  1. prepareGuideContext — 解析既有 guide 状态 / bootcamp 自动 offer（循环前一次）
 *  2. guideContextForCat — per-cat 注入决策（循环内）
 *  3. ackGuideCompletion — cat 产出后消费 completionAcked（一次性）
 *
 * 覆盖：ownership 注入、selection fallback、hiddenForeign 抑制、
 *       bootcamp→guide bridge（含 dismissTracker 抑制）、completed 单次 ack。
 */

import { describe, expect, it } from 'vitest';
import type { GuideStateV1 } from '../src/models.js';
import type { GuideRegistryLoader } from '../src/registry-loader.js';
import type { GuideRouteThread } from '../src/routing-interceptor.js';
import {
  ackGuideCompletion,
  guideContextForCat,
  prepareGuideContext,
} from '../src/routing-interceptor.js';
import { InMemoryGuideSessionStore, createGuideStoreBridge } from '../src/session-repository.js';
import { createOfferedSession, transitionSession } from '../src/session-repository.js';
import type { IGuideDismissTracker } from '../src/dismiss-tracker.js';

const T0 = 1_700_000_000_000;

/** 构造最小 thread（owner=user-1）。 */
function thread(overrides: Partial<GuideRouteThread> = {}): GuideRouteThread {
  return { id: 't-1', createdBy: 'user-1', ...overrides };
}

/** registry loader stub（bootcamp-add-teammate 注册）。 */
function stubRegistry(): GuideRegistryLoader {
  const entry = {
    id: 'bootcamp-add-teammate',
    name: '添加队友',
    description: 'Bootcamp 第 7.5 阶段添加队友',
    keywords: ['队友', 'teammate'],
    category: 'bootcamp',
    priority: 'P1',
    cross_system: false,
    estimated_time: '2min',
    flow_file: 'flows/bootcamp-add-teammate.yaml',
  };
  return { getRegistryEntries: () => [entry] } as unknown as GuideRegistryLoader;
}

/** 简单 dismiss tracker（计数可控）。 */
function dismissTracker(counts: Record<string, number> = {}): IGuideDismissTracker {
  return {
    getDismissCounts: async (_userId: string, guideIds: string[]) =>
      Object.fromEntries(guideIds.map((id) => [id, counts[id] ?? 0])),
  } as unknown as IGuideDismissTracker;
}

// ─── Phase 1/2：既有 guide 状态 ────────────────────────────────────────────

describe('C25 prepareGuideContext：既有 guide 状态', () => {
  it('无 guide 状态 → candidate undefined，hiddenForeign false', async () => {
    const ctx = await prepareGuideContext({
      thread: thread(),
      targetCats: ['cat-a'],
      message: '你好',
      userId: 'user-1',
      threadId: 't-1',
    });
    expect(ctx.candidate).toBeUndefined();
    expect(ctx.hiddenForeign).toBe(false);
  });

  it('offered + owner 在 target 内 → 仅 owner 注入', async () => {
    const store = new InMemoryGuideSessionStore();
    await store.save(createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' }));
    const ctx = await prepareGuideContext({
      thread: thread(),
      guideSessionStore: store,
      targetCats: ['cat-a', 'cat-b'],
      message: '没选',
      userId: 'user-1',
      threadId: 't-1',
    });
    expect(ctx.candidate?.id).toBe('g-1');
    expect(ctx.candidate?.status).toBe('offered');
    expect(ctx.offerOwner).toBe('cat-a');
    // owner 注入；其他 cat 不注入
    expect(guideContextForCat(ctx, 'cat-a', new Set(['cat-a', 'cat-b']), 't-1').guideCandidate).toBeDefined();
    expect(guideContextForCat(ctx, 'cat-b', new Set(['cat-a', 'cat-b']), 't-1')).toEqual({});
  });

  it('offered + 用户选择（引导流程：xxx）+ owner 不在 target → fallback 到 targetCats[0]', async () => {
    const store = new InMemoryGuideSessionStore();
    await store.save(createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-owner' }));
    const ctx = await prepareGuideContext({
      thread: thread(),
      guideSessionStore: store,
      targetCats: ['cat-a', 'cat-b'],
      message: '引导流程：g-1',
      userId: 'user-1',
      threadId: 't-1',
    });
    expect(ctx.candidate?.userSelection).toBe('g-1');
    expect(ctx.offerSelectionFallback).toBe('cat-a');
    // 仅 fallback cat 注入
    expect(guideContextForCat(ctx, 'cat-a', new Set(['cat-a', 'cat-b']), 't-1').guideCandidate).toBeDefined();
    expect(guideContextForCat(ctx, 'cat-b', new Set(['cat-a', 'cat-b']), 't-1')).toEqual({});
  });

  it('awaiting_choice → allowFallback 生效（无选择也 fallback）', async () => {
    const store = new InMemoryGuideSessionStore();
    const offered = createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-owner' });
    await store.save(transitionSession(offered, 'awaiting_choice'));
    const ctx = await prepareGuideContext({
      thread: thread(),
      guideSessionStore: store,
      targetCats: ['cat-a', 'cat-b'],
      message: '再想想',
      userId: 'user-1',
      threadId: 't-1',
    });
    expect(ctx.offerSelectionFallback).toBe('cat-a');
    expect(guideContextForCat(ctx, 'cat-a', new Set(['cat-a', 'cat-b']), 't-1').guideCandidate).toBeDefined();
    expect(guideContextForCat(ctx, 'cat-b', new Set(['cat-a', 'cat-b']), 't-1')).toEqual({});
  });

  it('active → 所有 target cat 注入', async () => {
    const store = new InMemoryGuideSessionStore();
    const offered = createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' });
    await store.save(transitionSession(offered, 'active'));
    const ctx = await prepareGuideContext({
      thread: thread(),
      guideSessionStore: store,
      targetCats: ['cat-a', 'cat-b'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
    });
    expect(ctx.candidate?.status).toBe('active');
    expect(guideContextForCat(ctx, 'cat-a', new Set(['cat-a', 'cat-b']), 't-1').guideCandidate).toBeDefined();
    expect(guideContextForCat(ctx, 'cat-b', new Set(['cat-a', 'cat-b']), 't-1').guideCandidate).toBeDefined();
  });

  it('无 guideSessionStore → thread.guideState fallback（旧路径兼容）', async () => {
    const gs: GuideStateV1 = {
      v: 1,
      guideId: 'g-1',
      status: 'offered',
      userId: 'user-1',
      offeredAt: T0,
      offeredBy: 'cat-a',
    };
    const ctx = await prepareGuideContext({
      thread: thread({ guideState: gs }),
      targetCats: ['cat-a'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
    });
    expect(ctx.candidate?.id).toBe('g-1');
    expect(ctx.offerOwner).toBe('cat-a');
  });
});

// ─── hiddenForeign：他人非终态 guide 抑制 ─────────────────────────────────

describe('C25 hiddenForeign：他人非终态 guide', () => {
  it('共享默认线程中他人非终态 guide → 不注入 candidate + hiddenForeign', async () => {
    const store = new InMemoryGuideSessionStore();
    await store.save(createOfferedSession({ threadId: 'default', userId: 'other-user', guideId: 'g-1', offeredBy: 'cat-a' }));
    const sharedThread: GuideRouteThread = { id: 'default', createdBy: 'system' };
    const ctx = await prepareGuideContext({
      thread: sharedThread,
      guideSessionStore: store,
      targetCats: ['cat-a'],
      message: '',
      userId: 'user-1', // 非 owner
      threadId: 'default',
    });
    expect(ctx.candidate).toBeUndefined();
    expect(ctx.hiddenForeign).toBe(true);
  });

  it('owner 访问自己的 guide → 正常注入（hiddenForeign false）', async () => {
    const store = new InMemoryGuideSessionStore();
    await store.save(createOfferedSession({ threadId: 'default', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' }));
    const sharedThread: GuideRouteThread = { id: 'default', createdBy: 'system' };
    const ctx = await prepareGuideContext({
      thread: sharedThread,
      guideSessionStore: store,
      targetCats: ['cat-a'],
      message: '',
      userId: 'user-1',
      threadId: 'default',
    });
    expect(ctx.candidate?.id).toBe('g-1');
    expect(ctx.hiddenForeign).toBe(false);
  });
});

// ─── Bootcamp → Guide bridge ───────────────────────────────────────────────

describe('C25 bootcamp→guide bridge：自动 offer', () => {
  it('phase-7.5-add-teammate → 自动 offer bootcamp-add-teammate（isNewOffer）', async () => {
    const ctx = await prepareGuideContext({
      thread: thread({ bootcampState: { phase: 'phase-7.5-add-teammate' } }),
      targetCats: ['cat-a', 'cat-b'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
      registryLoader: stubRegistry(),
    });
    expect(ctx.candidate?.id).toBe('bootcamp-add-teammate');
    expect(ctx.candidate?.status).toBe('offered');
    expect(ctx.candidate?.isNewOffer).toBe(true);
    expect(ctx.offerOwner).toBe('cat-a'); // targetCats[0] 为 owner
    expect(guideContextForCat(ctx, 'cat-a', new Set(['cat-a', 'cat-b']), 't-1').guideCandidate).toBeDefined();
    expect(guideContextForCat(ctx, 'cat-b', new Set(['cat-a', 'cat-b']), 't-1')).toEqual({});
  });

  it('dismissTracker 计数 > 0 → 抑制 re-offer', async () => {
    const ctx = await prepareGuideContext({
      thread: thread({ bootcampState: { phase: 'phase-10-retro' } }),
      targetCats: ['cat-a'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
      registryLoader: stubRegistry(),
      dismissTracker: dismissTracker({ 'bootcamp-farewell': 1 }),
    });
    expect(ctx.candidate).toBeUndefined();
  });

  it('未注册 guide（registry 缺失）→ 不 offer', async () => {
    const ctx = await prepareGuideContext({
      thread: thread({ bootcampState: { phase: 'phase-7.5-add-teammate' } }),
      targetCats: ['cat-a'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
      // 无 registryLoader → name 回退也因 entry 缺失而不 offer
    });
    expect(ctx.candidate).toBeUndefined();
  });

  it('非 bootcamp 阶段 → 不 offer', async () => {
    const ctx = await prepareGuideContext({
      thread: thread({ bootcampState: { phase: 'phase-1-hello' } }),
      targetCats: ['cat-a'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
      registryLoader: stubRegistry(),
    });
    expect(ctx.candidate).toBeUndefined();
  });
});

// ─── Phase 3：completion ack ───────────────────────────────────────────────

describe('C25 ackGuideCompletion：一次性消费 completionAcked', () => {
  async function completedCtx() {
    const store = new InMemoryGuideSessionStore();
    let offered = createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' });
    offered = transitionSession(offered, 'active');
    offered = transitionSession(offered, 'completed');
    await store.save(offered);
    const ctx = await prepareGuideContext({
      thread: thread(),
      guideSessionStore: store,
      targetCats: ['cat-a', 'cat-b'],
      message: '',
      userId: 'user-1',
      threadId: 't-1',
    });
    return { store, ctx, bridge: createGuideStoreBridge(store) };
  }

  it('owner cat 产出 → completionAcked 写入；其他 cat 产出 → 不写', async () => {
    const { store, ctx, bridge } = await completedCtx();
    expect(ctx.candidate?.status).toBe('completed');
    expect(ctx.completionOwner).toBe('cat-a');

    // 非 owner 产出 → 不 ack
    await ackGuideCompletion({
      ctx, catId: 'cat-b', catProducedOutput: true,
      targetCatIds: new Set(['cat-a', 'cat-b']), threadId: 't-1', userId: 'user-1',
      guideStore: bridge, threadStore: { get: async () => thread() },
    });
    expect((await store.getByThread('t-1'))?.completionAcked).toBe(false);

    // owner 产出 → ack
    await ackGuideCompletion({
      ctx, catId: 'cat-a', catProducedOutput: true,
      targetCatIds: new Set(['cat-a', 'cat-b']), threadId: 't-1', userId: 'user-1',
      guideStore: bridge, threadStore: { get: async () => thread() },
    });
    expect((await store.getByThread('t-1'))?.completionAcked).toBe(true);
  });

  it('catProducedOutput=false → 不 ack（无产出不消费）', async () => {
    const { store, ctx, bridge } = await completedCtx();
    await ackGuideCompletion({
      ctx, catId: 'cat-a', catProducedOutput: false,
      targetCatIds: new Set(['cat-a', 'cat-b']), threadId: 't-1', userId: 'user-1',
      guideStore: bridge, threadStore: { get: async () => thread() },
    });
    expect((await store.getByThread('t-1'))?.completionAcked).toBe(false);
  });

  it('非 completed 状态 → 不 ack', async () => {
    const store = new InMemoryGuideSessionStore();
    await store.save(createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' }));
    const ctx = await prepareGuideContext({
      thread: thread(), guideSessionStore: store, targetCats: ['cat-a'],
      message: '', userId: 'user-1', threadId: 't-1',
    });
    await ackGuideCompletion({
      ctx, catId: 'cat-a', catProducedOutput: true,
      targetCatIds: new Set(['cat-a']), threadId: 't-1', userId: 'user-1',
      guideStore: createGuideStoreBridge(store), threadStore: { get: async () => thread() },
    });
    expect((await store.getByThread('t-1'))?.completionAcked).toBe(false);
  });

  it('第二次 prepare 时 completed+acked → 不再注入 completion（一次性）', async () => {
    const store = new InMemoryGuideSessionStore();
    let offered = createOfferedSession({ threadId: 't-1', userId: 'user-1', guideId: 'g-1', offeredBy: 'cat-a' });
    offered = transitionSession(offered, 'active');
    offered = transitionSession(offered, 'completed');
    await store.save({ ...offered, completionAcked: true });
    const next = await prepareGuideContext({
      thread: thread(), guideSessionStore: store, targetCats: ['cat-a'],
      message: '', userId: 'user-1', threadId: 't-1',
    });
    expect(next.candidate).toBeUndefined();
  });
});
