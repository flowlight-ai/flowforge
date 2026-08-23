/**
 * service — T7.19 Auto Dream 域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeAutoDream 挂载 / runDreamCycle 门面 /
 * enable_background_loop 关闭时 startLoop no-op / getStatus。
 *
 * @module @flowforge/forgekin-auto-dream/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  AutoDreamService,
  EpisodeCard,
  InMemoryEpisodeStore,
  InMemoryMethodCardSink,
} from '../src/index.js';

function makeEpisode(id: string): EpisodeCard {
  return new EpisodeCard({
    episode_id: id,
    task_snapshot: '修复构建问题',
    transferable_method: 'same method text',
    non_transferable_facts: 'same facts',
    safety_boundary: 'none',
  });
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeAutoDream', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { config: { enable_background_loop: false } });
    expect(ctx.forgeAutoDream).toBeInstanceOf(AutoDreamService);
    expect(ctx.forgeAutoDream.config.enable_background_loop).toBe(false);
    expect(ctx.forgeAutoDream.config.consolidation_interval_seconds).toBe(3600);
  });
});

describe('门面：梦境循环', () => {
  it('runDreamCycle 蒸馏注入的 episodes 为 L2 草稿', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    store.addEpisode(makeEpisode('e1'));
    store.addEpisode(makeEpisode('e2'));

    const ctx = new Context();
    await ctx.plugin(Plugin, {
      episodeStore: store,
      methodCardSink: sink,
      config: { enable_background_loop: false },
    });
    const snapshot = await ctx.forgeAutoDream.runDreamCycle();
    expect(snapshot.clusters.length).toBe(1);
    expect(snapshot.distilled_method_cards.length).toBe(1);
    expect(sink.drafts.length).toBe(1);
  });

  it('triggerNow 返回快照；interrupt 安全调用', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { config: { enable_background_loop: false } });
    const snapshot = await ctx.forgeAutoDream.triggerNow();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.phase).toBe('idle');
    expect(() => ctx.forgeAutoDream.interrupt()).not.toThrow();
  });

  it('enable_background_loop=false 时 startLoop 为 no-op', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { config: { enable_background_loop: false } });
    ctx.forgeAutoDream.startLoop();
    expect(ctx.forgeAutoDream.loop.isRunning).toBe(false);
    const status = ctx.forgeAutoDream.getStatus();
    expect(status['running']).toBe(false);
    expect(status['last_snapshot']).toBeNull();
    await ctx.forgeAutoDream.stopLoop(100);
  });

  it('getStatus 反映配置与快照状态', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      config: { enable_background_loop: false, surface_top_k: 2 },
    });
    await ctx.forgeAutoDream.runDreamCycle();
    const status = ctx.forgeAutoDream.getStatus();
    expect(status['surface_top_k']).toBe(2);
    expect(status['cluster_similarity_threshold']).toBe(0.6);
  });
});
