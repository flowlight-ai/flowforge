/**
 * background-loop — 后台梦境循环管理器 + 顶层 API 验证。
 *
 * 覆盖：start/stop 优雅退出 / triggerNow / lastSnapshot /
 * runDreamCycle 顶层 API（sleepFn 注入即时实现）。
 *
 * @module @flowforge/forgekin-auto-dream/tests
 */

import { describe, expect, it } from 'vitest';
import { EpisodeCard } from '../src/models.js';
import {
  BackgroundDreamLoop,
  SleepFn,
  runDreamCycle,
} from '../src/background-loop.js';
import {
  InMemoryEpisodeStore,
  InMemoryMethodCardSink,
  makeDreamCycleConfig,
} from '../src/dream-cycle.js';

/** 即时睡眠（setTimeout(0) 让步，避免微任务风暴饿死事件循环） */
const instantSleep: SleepFn = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEpisode(id: string): EpisodeCard {
  return new EpisodeCard({
    episode_id: id,
    task_snapshot: '修复构建问题',
    transferable_method: 'same method text',
    non_transferable_facts: 'same facts',
    safety_boundary: 'none',
  });
}

describe('runDreamCycle 顶层 API', () => {
  it('执行单次梦境循环返回快照', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    store.addEpisode(makeEpisode('e1'));
    store.addEpisode(makeEpisode('e2'));
    const snapshot = await runDreamCycle({ episodeStore: store, methodCardSink: sink });
    expect(snapshot.clusters.length).toBe(1);
    expect(sink.drafts.length).toBe(1);
    expect(snapshot.finished_at).toBeTruthy();
  });
});

describe('BackgroundDreamLoop', () => {
  it('start 后产生快照，stop 优雅退出', async () => {
    const store = new InMemoryEpisodeStore();
    const sink = new InMemoryMethodCardSink();
    store.addEpisode(makeEpisode('e1'));
    store.addEpisode(makeEpisode('e2'));

    const loop = new BackgroundDreamLoop({
      episodeStore: store,
      methodCardSink: sink,
      config: makeDreamCycleConfig({ consolidation_interval_seconds: 0.001 }),
      sleepFn: instantSleep,
    });
    expect(loop.isRunning).toBe(false);
    loop.start();
    expect(loop.isRunning).toBe(true);

    // 等待至少一轮完成（即时睡眠下微任务轮询即可）
    for (let i = 0; i < 50 && loop.lastSnapshot === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(loop.lastSnapshot).not.toBeNull();
    expect(sink.drafts.length).toBe(1);

    await loop.stop(1000);
    expect(loop.isRunning).toBe(false);
  });

  it('triggerNow 返回快照；重复启动 start 无副作用', async () => {
    const store = new InMemoryEpisodeStore();
    store.addEpisode(makeEpisode('e1'));
    store.addEpisode(makeEpisode('e2'));
    const loop = new BackgroundDreamLoop({
      episodeStore: store,
      config: makeDreamCycleConfig({ consolidation_interval_seconds: 0.001 }),
      sleepFn: instantSleep,
    });

    const snapshot = await loop.triggerNow();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.clusters.length).toBe(1);

    loop.start();
    loop.start(); // 重复启动不产生第二个循环
    expect(loop.isRunning).toBe(true);
    await loop.stop(1000);
    expect(loop.isRunning).toBe(false);
    // stop 后再次 stop 幂等
    await loop.stop(1000);
    expect(loop.isRunning).toBe(false);
  });

  it('interruptCurrentCycle 无运行中 cycle 时安全调用', () => {
    const loop = new BackgroundDreamLoop({
      episodeStore: new InMemoryEpisodeStore(),
      sleepFn: instantSleep,
    });
    expect(() => loop.interruptCurrentCycle()).not.toThrow();
    expect(loop.lastSnapshot).toBeNull();
  });
});
