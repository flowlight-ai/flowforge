/**
 * @flowforge/forgekin-harness-eval — 生命周期判定验证（lifecycle）。
 *
 * 对齐 F040 §3.3 关键算法：
 *   - 净产出 = appreciation - friction
 *   - 增值/折旧/需要行动/瓶颈/稳定五态判定优先级
 *   - LifecycleJudge 连续折旧天数维护
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  buildStatus,
  judgeLifecycleState,
  LifecycleJudge,
  netGain,
} from '../src/lifecycle.js';
import { HarnessLifecycleState } from '../src/types.js';

describe('netGain 净产出', () => {
  it('增值-摩擦', () => {
    expect(netGain(0.8, 0.2)).toBeCloseTo(0.6);
    expect(netGain(0.2, 0.8)).toBeCloseTo(-0.6);
  });
});

describe('judgeLifecycleState 五态判定（F040 §3.3）', () => {
  const base = { component_id: 'harness:feedback_loop', contract_id: 'ct:fb' };

  it('产出>摩擦且达增值阈值 → appreciating', () => {
    expect(judgeLifecycleState({ ...base, appreciation_score: 0.8, friction_score: 0.2 })).toBe(
      HarnessLifecycleState.APPRECIATING,
    );
  });

  it('摩擦>产出且达摩擦阈值 → depreciating', () => {
    expect(judgeLifecycleState({ ...base, appreciation_score: 0.2, friction_score: 0.8 })).toBe(
      HarnessLifecycleState.DEPRECIATING,
    );
  });

  it('信号冲突 → action_needed（无论净产出）', () => {
    expect(
      judgeLifecycleState({ ...base, appreciation_score: 0.9, friction_score: 0.1, signal_conflict: true }),
    ).toBe(HarnessLifecycleState.ACTION_NEEDED);
  });

  it('归因频发（≥3 次）→ action_needed', () => {
    expect(
      judgeLifecycleState({
        ...base,
        appreciation_score: 0.5,
        friction_score: 0.5,
        attribution_distribution: { prompt_drift: 1, tool_failure: 2 },
      }),
    ).toBe(HarnessLifecycleState.ACTION_NEEDED);
  });

  it('持续折旧达窗口 + 阻塞其他 → bottleneck', () => {
    expect(
      judgeLifecycleState({
        ...base,
        appreciation_score: 0.1,
        friction_score: 0.9,
        consecutive_depreciating_days: 7,
        blocks_others: true,
      }),
    ).toBe(HarnessLifecycleState.BOTTLENECK);
  });

  it('持续折旧但未阻塞 → 仍为 depreciating', () => {
    expect(
      judgeLifecycleState({
        ...base,
        appreciation_score: 0.1,
        friction_score: 0.9,
        consecutive_depreciating_days: 7,
        blocks_others: false,
      }),
    ).toBe(HarnessLifecycleState.DEPRECIATING);
  });

  it('净产出为负但摩擦未达阈值 → depreciating（产出不足）', () => {
    expect(judgeLifecycleState({ ...base, appreciation_score: 0.3, friction_score: 0.35 })).toBe(
      HarnessLifecycleState.DEPRECIATING,
    );
  });

  it('净产出持平且无冲突 → stable', () => {
    expect(judgeLifecycleState({ ...base, appreciation_score: 0.5, friction_score: 0.5 })).toBe(
      HarnessLifecycleState.STABLE,
    );
  });
});

describe('LifecycleJudge 连续折旧维护', () => {
  it('连续折旧天数递增，恢复后重置', () => {
    const judge = new LifecycleJudge({ bottleneck_consecutive_days: 3 });
    const obs = (depreciating: boolean) => ({
      component_id: 'c1',
      contract_id: 'ct:c1',
      appreciation_score: depreciating ? 0.1 : 0.8,
      friction_score: depreciating ? 0.9 : 0.2,
      blocks_others: true,
    });
    judge.judge(obs(true));
    judge.judge(obs(true));
    expect(judge.streakOf('c1')).toBe(2);
    // 第三次达到窗口 → bottleneck
    const third = judge.judge(obs(true));
    expect(third.lifecycle_state).toBe(HarnessLifecycleState.BOTTLENECK);
    // 恢复 → streak 重置
    judge.judge(obs(false));
    expect(judge.streakOf('c1')).toBe(0);
  });
});

describe('buildStatus', () => {
  it('构建含 last_action 的状态', () => {
    const status = buildStatus(
      { component_id: 'c1', contract_id: 'ct:c1', appreciation_score: 0.1, friction_score: 0.9, blocks_others: true },
      HarnessLifecycleState.BOTTLENECK,
      3,
    );
    expect(status.component_id).toBe('c1');
    expect(status.lifecycle_state).toBe(HarnessLifecycleState.BOTTLENECK);
    expect(status.last_action).toBe('escalate_cvo_refactor');
    expect(status.updated_at).toBeGreaterThan(0);
  });
});
