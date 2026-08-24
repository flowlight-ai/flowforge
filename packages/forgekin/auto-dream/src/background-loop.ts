/**
 * auto-dream background loop — 后台梦境循环管理器（对齐 Python
 * BackgroundDreamLoop）+ 顶层 API runDreamCycle。
 *
 * 特性：可配置间隔（默认 1 小时）/ Magic Words 中断（I4）/
 * 优雅退出 / 最近一次 snapshot 缓存。
 *
 * @module @flowforge/forgekin-auto-dream
 */

import {
  DreamCycle,
  DreamCycleConfig,
  DreamSnapshot,
  EpisodeStore,
  MethodCardSink,
  makeDreamCycleConfig,
} from './dream-cycle.js';
import { SimilarityCalculator } from './similarity.js';

/** 睡眠函数注入类型（测试可替换为即时实现） */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** BackgroundDreamLoop 构造参数 */
export interface BackgroundDreamLoopOptions {
  readonly episodeStore: EpisodeStore;
  readonly methodCardSink?: MethodCardSink | undefined;
  readonly config?: DreamCycleConfig | undefined;
  readonly similarityCalculator?: SimilarityCalculator | undefined;
  /** 睡眠函数注入（测试用） */
  readonly sleepFn?: SleepFn | undefined;
}

/** 后台梦境循环管理器 — 定期触发 DreamCycle.runOnce() */
export class BackgroundDreamLoop {
  private readonly episodeStore: EpisodeStore;
  private readonly methodCardSink: MethodCardSink | null;
  private readonly config: DreamCycleConfig;
  private readonly similarityCalculator: SimilarityCalculator | undefined;
  private readonly sleepFn: SleepFn;
  private loopPromise: Promise<void> | null = null;
  private stopped = false;
  private currentCycle: DreamCycle | null = null;
  private lastSnapshotValue: DreamSnapshot | null = null;

  constructor(options: BackgroundDreamLoopOptions) {
    this.episodeStore = options.episodeStore;
    this.methodCardSink = options.methodCardSink ?? null;
    this.config = options.config ?? makeDreamCycleConfig();
    this.similarityCalculator = options.similarityCalculator;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  /** 最近一次梦境快照 */
  get lastSnapshot(): DreamSnapshot | null {
    return this.lastSnapshotValue;
  }

  get isRunning(): boolean {
    return this.loopPromise !== null;
  }

  /** 启动后台梦境循环 */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.stopped = false;
    this.loopPromise = this.runLoop();
  }

  /**
   * 优雅停止后台梦境循环。
   *
   * @param timeoutMs 等待当前 cycle 完成的超时毫秒数（默认 30s）
   */
  async stop(timeoutMs = 30_000): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.stopped = true;
    // 中断当前 cycle
    this.interruptCurrentCycle();
    const loop = this.loopPromise as Promise<void>;
    await Promise.race([
      loop,
      this.sleepFn(timeoutMs).then(() => {
        throw new Error('BackgroundDreamLoop 停止超时，强制退出');
      }),
    ]).catch(() => undefined);
    this.loopPromise = null;
  }

  /** I4: Magic Words 中断当前 cycle（不影响后台循环本身） */
  interruptCurrentCycle(): void {
    if (this.currentCycle !== null) {
      this.currentCycle.interrupt();
    }
  }

  /**
   * 立即触发一次梦境循环（不等间隔）。
   *
   * @returns DreamSnapshot（若正在执行则返回 null）
   */
  async triggerNow(): Promise<DreamSnapshot | null> {
    if (this.currentCycle !== null) {
      return null;
    }
    return this.runOnce();
  }

  /** 后台循环主逻辑 */
  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.runOnce();
      } catch {
        // 循环不退出（对齐 Python：异常记录后继续下一轮）
      }
      // 等待下一个间隔（或被 stop 打断）
      const intervalMs = this.config.consolidation_interval_seconds * 1000;
      const startedAt = Date.now();
      while (!this.stopped && Date.now() - startedAt < intervalMs) {
        await this.sleepFn(Math.min(100, intervalMs));
      }
    }
  }

  /** 执行单次 DreamCycle */
  private async runOnce(): Promise<DreamSnapshot> {
    this.currentCycle = new DreamCycle({
      episodeStore: this.episodeStore,
      methodCardSink: this.methodCardSink ?? undefined,
      config: this.config,
      similarityCalculator: this.similarityCalculator,
    });
    try {
      const snapshot = await this.currentCycle.runOnce();
      this.lastSnapshotValue = snapshot;
      return snapshot;
    } finally {
      this.currentCycle = null;
    }
  }
}

/**
 * 顶层 API：执行单次梦境循环（对齐 Python run_dream_cycle）。
 */
export async function runDreamCycle(options: {
  episodeStore: EpisodeStore;
  methodCardSink?: MethodCardSink | undefined;
  config?: DreamCycleConfig | undefined;
  similarityCalculator?: SimilarityCalculator | undefined;
}): Promise<DreamSnapshot> {
  const cycle = new DreamCycle(options);
  return cycle.runOnce();
}
