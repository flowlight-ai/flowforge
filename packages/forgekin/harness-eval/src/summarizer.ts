/**
 * summarizer — 每日汇总任务（F040 §3.2 DailySummarizer / §3.3 每日汇总）。
 *
 * 聚合 F018 Eval Contract + F019 三方信号 + F020 七类归因，更新每个组件的
 * lifecycle_state，并给出归因分布趋势（按时间窗口聚合）。
 *
 * @module @flowforge/forgekin-harness-eval
 */

import {
  HarnessLifecycleState,
  type DailySummary,
  type HarnessComponentStatus,
} from './types.js';
import { LifecycleJudge, type LifecycleObservation } from './lifecycle.js';
import { ActionRecommender } from './recommender.js';

/** 组件观测源——由控制面接入方注入（eval-ledger 契约/信号/归因数据的投影）。 */
export interface ComponentObservationSource {
  /** 列出全部受观测组件的观测快照。 */
  readonly listObservations: () => readonly LifecycleObservation[];
}

/** DailySummarizer 构造配置。 */
export interface DailySummarizerOptions {
  /** 组件观测源（缺省为空——调用方手动传入观测） */
  readonly source?: ComponentObservationSource | undefined;
  /** 生命周期判定器（缺省新建） */
  readonly judge?: LifecycleJudge | undefined;
  /** 行动建议器（缺省新建） */
  readonly recommender?: ActionRecommender | undefined;
}

/** 日期格式化（YYYY-MM-DD，本地时区）。 */
export function formatDate(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 每日汇总器——聚合观测 → 更新生命周期 → 派发行动 → 输出 DailySummary。 */
export class DailySummarizer {
  readonly judge: LifecycleJudge;
  readonly recommender: ActionRecommender;
  private readonly source?: ComponentObservationSource | undefined;

  constructor(options: DailySummarizerOptions = {}) {
    this.judge = options.judge ?? new LifecycleJudge();
    this.recommender = options.recommender ?? new ActionRecommender();
    this.source = options.source;
  }

  /** 执行一次汇总（F040 AC-2：正确聚合 F018/F019/F020 数据）。 */
  summarize(
    observations?: readonly LifecycleObservation[],
    now: number = Date.now(),
  ): DailySummary {
    const input = observations ?? this.source?.listObservations() ?? [];
    const components = input.map((o) => this.judge.judge(o));
    const actions = this.recommender.recommendAll(components, now);
    const attribution_trend = aggregateAttribution(input);
    const counts = countByState(components);
    return {
      date: formatDate(now),
      components,
      actions,
      attribution_trend,
      counts,
    };
  }
}

/** 归因分布趋势聚合（类别 → 近窗口总次数）。 */
export function aggregateAttribution(
  observations: readonly LifecycleObservation[],
): Readonly<Record<string, number>> {
  const trend: Record<string, number> = {};
  for (const o of observations) {
    for (const [category, count] of Object.entries(o.attribution_distribution ?? {})) {
      trend[category] = (trend[category] ?? 0) + count;
    }
  }
  return trend;
}

/** 按生命周期状态分组计数（五态全量键）。 */
export function countByState(
  components: readonly HarnessComponentStatus[],
): Readonly<Record<HarnessLifecycleState, number>> {
  const counts: Record<HarnessLifecycleState, number> = {
    [HarnessLifecycleState.APPRECIATING]: 0,
    [HarnessLifecycleState.DEPRECIATING]: 0,
    [HarnessLifecycleState.ACTION_NEEDED]: 0,
    [HarnessLifecycleState.BOTTLENECK]: 0,
    [HarnessLifecycleState.STABLE]: 0,
  };
  for (const c of components) {
    counts[c.lifecycle_state] = (counts[c.lifecycle_state] ?? 0) + 1;
  }
  return counts;
}
