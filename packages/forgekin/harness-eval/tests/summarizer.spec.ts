/**
 * @flowforge/forgekin-harness-eval — 每日汇总验证（summarizer）。
 *
 * 对齐 F040 §3.2 DailySummarizer / §3.3 每日汇总：
 *   - 聚合观测 → 更新 lifecycle_state（AC-2）
 *   - 归因分布趋势按窗口聚合（AC-5）
 *   - 行动建议随汇总派发（AC-4）
 *   - 按状态计数
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateAttribution,
  countByState,
  DailySummarizer,
  formatDate,
  type ComponentObservationSource,
} from '../src/summarizer.js';
import type { LifecycleObservation } from '../src/lifecycle.js';
import { HarnessLifecycleState } from '../src/types.js';

const obsA: LifecycleObservation = {
  component_id: 'harness:feedback_loop',
  contract_id: 'ct:fb',
  appreciation_score: 0.8,
  friction_score: 0.2,
  attribution_distribution: { tool_failure: 1 },
};

const obsB: LifecycleObservation = {
  component_id: 'eval:memory',
  contract_id: 'ct:memory',
  appreciation_score: 0.1,
  friction_score: 0.9,
  attribution_distribution: { prompt_drift: 2 },
  blocks_others: true,
};

describe('formatDate', () => {
  it('YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 7, 24).getTime())).toBe('2026-08-24');
  });
});

describe('aggregateAttribution 趋势聚合（AC-5）', () => {
  it('类别求和', () => {
    const trend = aggregateAttribution([obsA, obsB]);
    expect(trend).toEqual({ tool_failure: 1, prompt_drift: 2 });
  });
});

describe('countByState', () => {
  it('五态全量键 + 计数', () => {
    const counts = countByState([
      { ...obsA, lifecycle_state: HarnessLifecycleState.APPRECIATING } as never,
      { ...obsB, lifecycle_state: HarnessLifecycleState.DEPRECIATING } as never,
    ]);
    expect(counts[HarnessLifecycleState.APPRECIATING]).toBe(1);
    expect(counts[HarnessLifecycleState.DEPRECIATING]).toBe(1);
    expect(counts[HarnessLifecycleState.BOTTLENECK]).toBe(0);
    expect(counts[HarnessLifecycleState.STABLE]).toBe(0);
    expect(Object.keys(counts)).toHaveLength(5);
  });
});

describe('DailySummarizer.summarize（AC-2/AC-3）', () => {
  it('手动传入观测 → 汇总组件/行动/趋势', () => {
    const summarizer = new DailySummarizer();
    const summary = summarizer.summarize([obsA, obsB], new Date(2026, 7, 24).getTime());
    expect(summary.date).toBe('2026-08-24');
    expect(summary.components).toHaveLength(2);
    // obsB 持续折旧（首日）未达窗口 → depreciating → F012 行动
    const actions = summary.actions;
    expect(actions.some((a) => a.component_id === 'eval:memory' && a.action === 'F012_sunset_review')).toBe(true);
    expect(summary.attribution_trend).toEqual({ tool_failure: 1, prompt_drift: 2 });
  });

  it('观测源注入 → summarize() 无参聚合', () => {
    const source: ComponentObservationSource = {
      listObservations: () => [obsA],
    };
    const summarizer = new DailySummarizer({ source });
    const summary = summarizer.summarize();
    expect(summary.components).toHaveLength(1);
    expect(summary.components[0]?.component_id).toBe('harness:feedback_loop');
  });

  it('同一组件跨日折旧 → 达到窗口升级 bottleneck', () => {
    const judge = new DailySummarizer();
    // 手动先喂 6 天折旧（每天一次）
    for (let i = 0; i < 6; i += 1) {
      judge.judge.judge(obsB);
    }
    const summary = judge.summarize([obsB], new Date(2026, 7, 24).getTime());
    // obsB blocks_others=true 且连续 7 天 → bottleneck
    expect(summary.components[0]?.lifecycle_state).toBe(HarnessLifecycleState.BOTTLENECK);
  });
});
