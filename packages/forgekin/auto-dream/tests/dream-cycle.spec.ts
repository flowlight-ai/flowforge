/**
 * dream-cycle — CL-031 梦境循环执行器验证。
 *
 * 覆盖：配置默认值 / 内存存储 / runOnce 六步全链路 / 聚类过滤 /
 * max_clusters 限制 / I1 幂等 / I4 中断 / surface 浮现。
 *
 * @module @flowforge/forgekin-auto-dream/tests
 */

import { describe, expect, it } from 'vitest';
import { EpisodeCard, KnowledgeMaturityLevel, MethodCard } from '../src/models.js';
import {
  DreamCycle,
  DreamPhase,
  EpisodeStore,
  InMemoryEpisodeStore,
  InMemoryMethodCardSink,
  makeDreamCycleConfig,
} from '../src/dream-cycle.js';

function makeEpisode(
  id: string,
  method: string,
  facts: string,
  snapshot = '修复构建问题',
): EpisodeCard {
  return new EpisodeCard({
    episode_id: id,
    task_snapshot: snapshot,
    transferable_method: method,
    non_transferable_facts: facts,
    safety_boundary: 'none',
  });
}

describe('makeDreamCycleConfig', () => {
  it('默认值完整', () => {
    const config = makeDreamCycleConfig();
    expect(config.consolidation_interval_seconds).toBe(3600);
    expect(config.surface_top_k).toBe(3);
    expect(config.cluster_similarity_threshold).toBe(0.6);
    expect(config.min_episodes_per_cluster).toBe(2);
    expect(config.max_clusters_per_cycle).toBe(5);
    expect(config.enable_background_loop).toBe(true);
    expect(config.enable_foreground_surface).toBe(true);
    expect(config.archive_processed_episodes).toBe(true);
  });

  it('部分覆盖生效', () => {
    const config = makeDreamCycleConfig({ surface_top_k: 1, enable_background_loop: false });
    expect(config.surface_top_k).toBe(1);
    expect(config.enable_background_loop).toBe(false);
    expect(config.cluster_similarity_threshold).toBe(0.6);
  });
});

describe('内存存储实现', () => {
  it('InMemoryEpisodeStore 过滤未处理 + 领域过滤 + 处理标记', async () => {
    const store = new InMemoryEpisodeStore();
    const dev = makeEpisode('e1', 'a b', 'c d');
    const med = makeEpisode('e2', 'a b', 'c d', '医学诊断流程');
    store.addEpisode(dev);
    store.addEpisode(med);

    expect((await store.listEpisodes()).map((e) => e.episode_id)).toEqual(['e1', 'e2']);
    expect((await store.listEpisodes({ domain: 'medical' })).map((e) => e.episode_id)).toEqual(['e2']);

    await store.markProcessed('e1', 'cycle-x');
    expect(store.getProcessedCycle('e1')).toBe('cycle-x');
    expect((await store.listEpisodes()).map((e) => e.episode_id)).toEqual(['e2']);
    expect((await store.listEpisodes({ unprocessedOnly: false })).length).toBe(2);
  });

  it('InMemoryMethodCardSink 收集草稿并返回 method_id', async () => {
    const sink = new InMemoryMethodCardSink();
    const card = new MethodCard({ method_id: 'm-1', title: 'a', domain: 'development', content: 'x' });
    await expect(sink.saveDraft(card)).resolves.toBe('m-1');
    expect(sink.drafts).toEqual([card]);
  });
});

describe('DreamCycle.runOnce 全链路', () => {
  it('空 store → IDLE 快照 + 零值 telemetry', async () => {
    const cycle = new DreamCycle({ episodeStore: new InMemoryEpisodeStore() });
    const snapshot = await cycle.runOnce();
    expect(snapshot.phase).toBe(DreamPhase.IDLE);
    expect(snapshot.clusters).toEqual([]);
    expect(snapshot.telemetry?.consolidation_rate).toBe(0);
    expect(snapshot.finished_at).toBeTruthy();
  });

  it('两相似 episode → 单簇蒸馏为 L2 草稿 + 归档 + surface', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    store.addEpisode(makeEpisode('e1', 'run tests fix errors', 'uses pnpm'));
    store.addEpisode(makeEpisode('e2', 'run tests fix errors', 'uses pnpm'));

    const cycle = new DreamCycle({ episodeStore: store, methodCardSink: sink });
    const snapshot = await cycle.runOnce();

    expect(snapshot.phase).toBe(DreamPhase.IDLE);
    expect(snapshot.clusters.length).toBe(1);
    expect(snapshot.clusters[0]?.episode_ids).toEqual(['e1', 'e2']);
    expect(snapshot.clusters[0]?.domain).toBe('development');
    expect(snapshot.distilled_method_cards.length).toBe(1);
    const card = snapshot.distilled_method_cards[0];
    expect(card?.maturity_level).toBe(KnowledgeMaturityLevel.L2_DRAFT);
    expect(card?.method_id).toBe(`method-${snapshot.clusters[0]?.cluster_id}`);
    expect(card?.source_refs).toEqual(['e1', 'e2']);
    expect(sink.drafts.length).toBe(1);

    // 归档：两 episode 被标记已处理
    expect(store.getProcessedCycle('e1')).toBe(cycle.cycleId);
    expect(store.getProcessedCycle('e2')).toBe(cycle.cycleId);

    // surface 载荷
    expect(snapshot.surface_payload).not.toBeNull();
    expect(snapshot.surface_payload?.items.length).toBe(1);
    expect(snapshot.surface_payload?.total_distilled).toBe(1);
    expect(snapshot.telemetry?.consolidation_rate).toBe(1);
    expect(snapshot.telemetry?.integration_depth).toBe(1);
  });

  it('I1 幂等：已处理 episodes 不再参与第二次循环', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    store.addEpisode(makeEpisode('e1', 'same method text', 'same facts'));
    store.addEpisode(makeEpisode('e2', 'same method text', 'same facts'));

    const first = new DreamCycle({ episodeStore: store, methodCardSink: sink });
    await first.runOnce();

    const second = new DreamCycle({ episodeStore: store, methodCardSink: sink });
    const snapshot = await second.runOnce();
    expect(snapshot.phase).toBe(DreamPhase.IDLE);
    expect(snapshot.clusters).toEqual([]);
    expect(sink.drafts.length).toBe(1); // 未重复蒸馏
  });

  it('不相交 episode 各成单元素簇 → 被 min_episodes 过滤，不蒸馏', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    store.addEpisode(makeEpisode('e1', 'alpha beta', 'one two'));
    store.addEpisode(makeEpisode('e2', 'gamma delta', 'three four'));

    const cycle = new DreamCycle({ episodeStore: store, methodCardSink: sink });
    const snapshot = await cycle.runOnce();
    expect(snapshot.clusters).toEqual([]);
    expect(snapshot.distilled_method_cards).toEqual([]);
    expect(sink.drafts).toEqual([]);
    // 未入簇的 episode 不归档
    expect(store.getProcessedCycle('e1')).toBeUndefined();
    expect(snapshot.telemetry?.consolidation_rate).toBe(0);
  });

  it('max_clusters_per_cycle 限制蒸馏簇数', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    // 三对互不相似的 episode → 三个 2 元素簇
    store.addEpisode(makeEpisode('a1', 'pair one method words', 'pair one facts'));
    store.addEpisode(makeEpisode('a2', 'pair one method words', 'pair one facts'));
    store.addEpisode(makeEpisode('b1', 'second group totally', 'second group facts'));
    store.addEpisode(makeEpisode('b2', 'second group totally', 'second group facts'));
    store.addEpisode(makeEpisode('c1', 'third cluster content', 'third cluster facts'));
    store.addEpisode(makeEpisode('c2', 'third cluster content', 'third cluster facts'));

    const cycle = new DreamCycle({
      episodeStore: store,
      methodCardSink: sink,
      config: makeDreamCycleConfig({ max_clusters_per_cycle: 2 }),
    });
    const snapshot = await cycle.runOnce();
    expect(snapshot.clusters.length).toBe(2);
    expect(snapshot.distilled_method_cards.length).toBe(2);
    expect(sink.drafts.length).toBe(2);
    expect(snapshot.telemetry?.integration_depth).toBe(1);
  });

  it('I4 中断：扫描阶段收到中断信号 → INTERRUPTED 快照', async () => {
    const episodes = [
      makeEpisode('e1', 'same method text', 'same facts'),
      makeEpisode('e2', 'same method text', 'same facts'),
    ];
    const holder: { cycle: DreamCycle | null } = { cycle: null };
    const store: EpisodeStore = {
      async listEpisodes() {
        holder.cycle?.interrupt();
        return episodes;
      },
      async markProcessed() {},
    };
    const cycle = new DreamCycle({ episodeStore: store });
    holder.cycle = cycle;
    const snapshot = await cycle.runOnce();
    expect(snapshot.interrupted).toBe(true);
    expect(snapshot.phase).toBe(DreamPhase.INTERRUPTED);
    expect(snapshot.clusters).toEqual([]);
    expect(snapshot.distilled_method_cards).toEqual([]);
  });

  it('enable_foreground_surface 关闭时不生成 surface 载荷', async () => {
    const store = new InMemoryEpisodeStore();
    store.addEpisode(makeEpisode('e1', 'same method text', 'same facts'));
    store.addEpisode(makeEpisode('e2', 'same method text', 'same facts'));
    const cycle = new DreamCycle({
      episodeStore: store,
      config: makeDreamCycleConfig({ enable_foreground_surface: false }),
    });
    const snapshot = await cycle.runOnce();
    expect(snapshot.surface_payload).toBeNull();
    expect(snapshot.distilled_method_cards.length).toBe(1);
  });
});
