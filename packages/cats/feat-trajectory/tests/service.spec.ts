/**
 * C26 FeatTrajectoryService 插件挂载测试（Cordis 服务生命周期）。
 *
 * 覆盖：
 *  - ctx.plugin(CatsFeatTrajectory) → ctx.catsFeatTrajectory 挂载
 *  - 工厂：createStore / createProjector / createGitRefCollector /
 *    createThreadSplitCollector / createCrossPostCollector / createScheduler
 *  - 默认参数：branchPatterns / multiCandidatePolicy / now 注入
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@flowforge/cordis';
import CatsFeatTrajectory, {
  FeatTrajectoryCollectorScheduler,
  FeatTrajectoryProjector,
  GitRefSnapshotCollector,
  InMemoryFeatTrajectoryStore,
  type FeatTrajectoryService,
  type FeatTrajectoryServiceOptions,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withFeatTrajectory(options?: FeatTrajectoryServiceOptions): Promise<Context> {
  const ctx = new Context();
  const fiber = await ctx.plugin(CatsFeatTrajectory, options) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

describe('C26 FeatTrajectoryService — Cordis 服务生命周期', () => {
  it('mounts at ctx.catsFeatTrajectory after ctx.plugin(CatsFeatTrajectory)', async () => {
    const ctx = await withFeatTrajectory();
    expect(ctx.catsFeatTrajectory).toBeInstanceOf(CatsFeatTrajectory);
  });

  it('默认参数：branchPatterns fix/*+feat/*、policy skip-low-confidence、now 注入', async () => {
    const now = () => 12345;
    const ctx = await withFeatTrajectory({ now });
    const svc: FeatTrajectoryService = ctx.catsFeatTrajectory;
    expect(svc.branchPatterns).toEqual(['fix/*', 'feat/*']);
    expect(svc.multiCandidatePolicy).toBe('skip-low-confidence');
    expect(svc.now()).toBe(12345);
  });

  it('工厂：createStore → createProjector 端到端 applyBallCustodyEvent', async () => {
    const ctx = await withFeatTrajectory();
    const svc = ctx.catsFeatTrajectory;
    const store = svc.createStore();
    expect(store).toBeInstanceOf(InMemoryFeatTrajectoryStore);
    const projector = svc.createProjector(store);
    expect(projector).toBeInstanceOf(FeatTrajectoryProjector);
    await projector.applyBallCustodyEvent(
      {
        sourceEventId: 'route:msg-1',
        subjectKey: 'ball:thread:t-1',
        kind: 'ball.handed_cvo',
        classification: 'state-changing',
        payload: { intent: 'done_notify' },
        at: 1_700_000_000_000,
      },
      'F233',
    );
    expect((await store.get('F233'))?.countsByKind.closed).toBe(1);
  });

  it('工厂：createGitRefCollector 注入 IO deps（默认 patterns/policy 生效）', async () => {
    const ctx = await withFeatTrajectory();
    const svc = ctx.catsFeatTrajectory;
    const gitRunner = {
      prefetch: vi.fn(async () => {}),
      lsRemote: vi.fn(async () => []),
      getCommitMeta: vi.fn(),
    };
    const collector = svc.createGitRefCollector({
      gitRunner,
      ghClient: { findPrByBranch: vi.fn() },
      featIndexLookup: { findByBranch: vi.fn() },
      threadSearch: { findByFeatId: vi.fn() },
    });
    expect(collector).toBeInstanceOf(GitRefSnapshotCollector);
    await collector.collectAll(1_700_000_000_000);
    expect(gitRunner.lsRemote).toHaveBeenCalledWith(['fix/*', 'feat/*']);
  });

  it('工厂：createScheduler 注入 now（服务级 now 透传）', async () => {
    const now = () => 999;
    const ctx = await withFeatTrajectory({ now });
    const svc = ctx.catsFeatTrajectory;
    const store = svc.createStore();
    const scheduler = svc.createScheduler({
      collector: svc.createGitRefCollector({
        gitRunner: { lsRemote: vi.fn(async () => []), getCommitMeta: vi.fn() },
        ghClient: { findPrByBranch: vi.fn() },
        featIndexLookup: { findByBranch: vi.fn() },
        threadSearch: { findByFeatId: vi.fn() },
      }),
      projector: svc.createProjector(store),
      store,
    });
    expect(scheduler).toBeInstanceOf(FeatTrajectoryCollectorScheduler);
    const result = await scheduler.tick();
    expect(result.featsInStore).toBe(0);
    expect(await store.getLastCollectorTickAt()).toBe(999); // service now 生效
  });
});
