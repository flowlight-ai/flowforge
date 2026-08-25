/**
 * @flowforge/forgekin-harness-eval — 控制面服务验证（control-plane）。
 *
 * 对齐 F040 §3.2 ControlPlaneAPI 验收标准：
 *   - AC-1：get_status / list_by_state
 *   - AC-2：每日汇总聚合
 *   - AC-3：四态判定
 *   - AC-4：行动建议派发
 *   - AC-5：归因趋势
 *   - 插件挂载 ctx.forgeHarnessEval
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import plugin from '../src/index.js';
import { HarnessEvalControlPlaneService } from '../src/control-plane.js';
import { HarnessLifecycleState, EvaluationMode } from '../src/types.js';
import type { LifecycleObservation } from '../src/lifecycle.js';

const obs = (componentId: string, a: number, f: number, extra: Partial<LifecycleObservation> = {}): LifecycleObservation => ({
  component_id: componentId,
  contract_id: `ct:${componentId}`,
  appreciation_score: a,
  friction_score: f,
  ...extra,
});

describe('HarnessEvalControlPlaneService 插件挂载', () => {
  it('ctx.forgeHarnessEval 为控制面服务实例', () => {
    const ctx = new Context();
    plugin(ctx, {});
    expect(ctx.forgeHarnessEval).toBeInstanceOf(HarnessEvalControlPlaneService);
  });

  it('默认配置：16 域 + 汇总 cron', () => {
    const ctx = new Context();
    plugin(ctx, {});
    expect(ctx.forgeHarnessEval.domains.list()).toHaveLength(16);
    expect(ctx.forgeHarnessEval.summarySchedule).toBe('0 2 * * *');
  });
});

describe('ControlPlaneAPI（F040 §3.2 AC-1）', () => {
  it('getStatus / listByState / listAll', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const svc = ctx.forgeHarnessEval;
    svc.observe(obs('c1', 0.8, 0.2));
    svc.observe(obs('c2', 0.1, 0.9));
    expect(svc.getStatus('c1')?.lifecycle_state).toBe(HarnessLifecycleState.APPRECIATING);
    expect(svc.listByState(HarnessLifecycleState.DEPRECIATING).map((s) => s.component_id)).toEqual(['c2']);
    expect(svc.listAll()).toHaveLength(2);
  });

  it('triggerAction 更新 last_action', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const svc = ctx.forgeHarnessEval;
    svc.observe(obs('c1', 0.8, 0.2));
    const action = svc.triggerAction('c1', 'manual_review');
    expect(action.action).toBe('manual_review');
    expect(svc.getStatus('c1')?.last_action).toBe('manual_review');
  });

  it('未观测组件 triggerAction 仍返回行动', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const action = ctx.forgeHarnessEval.triggerAction('ghost', 'x');
    expect(action.component_id).toBe('ghost');
  });
});

describe('每日汇总（AC-2/AC-3/AC-5）', () => {
  it('summarize 聚合观测 + 派发行动 + 归因趋势', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const svc = ctx.forgeHarnessEval;
    svc.observe(obs('c1', 0.8, 0.2, { attribution_distribution: { tool_failure: 2 } }));
    svc.observe(obs('c2', 0.1, 0.9));
    const summary = svc.summarize();
    expect(summary.components).toHaveLength(2);
    expect(summary.actions.some((a) => a.component_id === 'c2' && a.action === 'F012_sunset_review')).toBe(true);
    expect(summary.attribution_trend).toEqual({ tool_failure: 2 });
    expect(summary.counts[HarnessLifecycleState.APPRECIATING]).toBe(1);
    expect(summary.counts[HarnessLifecycleState.DEPRECIATING]).toBe(1);
    // 汇总结果回写状态表
    expect(svc.getStatus('c2')?.lifecycle_state).toBe(HarnessLifecycleState.DEPRECIATING);
  });

  it('连续折旧 → bottleneck（AC-3 四态判定）', () => {
    const ctx = new Context();
    plugin(ctx, { bottleneckConsecutiveDays: 3 });
    const svc = ctx.forgeHarnessEval;
    const bad = obs('c2', 0.1, 0.9, { blocks_others: true });
    for (let i = 0; i < 3; i += 1) {
      svc.observe(bad);
    }
    expect(svc.getStatus('c2')?.lifecycle_state).toBe(HarnessLifecycleState.BOTTLENECK);
    // bottleneck 行动
    const actions = svc.summarize().actions;
    expect(actions.some((a) => a.action === 'escalate_cvo_refactor')).toBe(true);
  });
});

describe('质量门控集成', () => {
  it('evaluate 走 FeedbackLoop', async () => {
    const ctx = new Context();
    plugin(ctx, {});
    const out = await ctx.forgeHarnessEval.evaluate({ content: 'too short' });
    expect(out.feedback?.gate).toBe('fail');
    expect(out.quality_warning).toBe(true);
  });

  it('evaluate 显式 skip 模式', async () => {
    const ctx = new Context();
    plugin(ctx, {});
    const out = await ctx.forgeHarnessEval.evaluate({ content: 'x' }, EvaluationMode.SKIP);
    expect(out.feedback?.gate).toBe('pass');
  });
});

describe('snapshot', () => {
  it('组件/域计数', () => {
    const ctx = new Context();
    plugin(ctx, {});
    const svc = ctx.forgeHarnessEval;
    svc.observe(obs('c1', 0.8, 0.2));
    const snap = svc.snapshot();
    expect(snap.components).toBe(1);
    expect(snap.domains).toBe(16);
    expect(snap.enabledDomains).toBe(16);
  });
});
