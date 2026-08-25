/**
 * @flowforge/forgekin-harness-eval — 行动建议派发验证（recommender）。
 *
 * 对齐 F040 §3.3 行动建议 + §3.4 action_routing：
 *   - depreciating → F012_sunset_review
 *   - action_needed → F020_fix_router
 *   - bottleneck → escalate_cvo_refactor
 *   - appreciating / stable → 无行动
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  ActionRecommender,
  DEFAULT_ACTION_ROUTING,
  recommendActions,
} from '../src/recommender.js';
import { HarnessLifecycleState, type HarnessComponentStatus } from '../src/types.js';

function statusOf(state: HarnessLifecycleState, componentId = 'c1'): HarnessComponentStatus {
  return {
    component_id: componentId,
    contract_id: `ct:${componentId}`,
    lifecycle_state: state,
    appreciation_score: 0.5,
    friction_score: 0.5,
    attribution_distribution: {},
    updated_at: 0,
  };
}

describe('DEFAULT_ACTION_ROUTING（F040 §3.4）', () => {
  it('三态路由对齐契约', () => {
    expect(DEFAULT_ACTION_ROUTING[HarnessLifecycleState.DEPRECIATING]).toBe('F012_sunset_review');
    expect(DEFAULT_ACTION_ROUTING[HarnessLifecycleState.ACTION_NEEDED]).toBe('F020_fix_router');
    expect(DEFAULT_ACTION_ROUTING[HarnessLifecycleState.BOTTLENECK]).toBe('escalate_cvo_refactor');
  });
});

describe('ActionRecommender.recommend', () => {
  it('depreciating → F012_sunset_review', () => {
    const actions = new ActionRecommender().recommend(statusOf(HarnessLifecycleState.DEPRECIATING), 1000);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toBe('F012_sunset_review');
    expect(actions[0]?.component_id).toBe('c1');
    expect(actions[0]?.dispatched_at).toBe(1000);
  });

  it('action_needed → F020_fix_router', () => {
    const actions = new ActionRecommender().recommend(statusOf(HarnessLifecycleState.ACTION_NEEDED));
    expect(actions[0]?.action).toBe('F020_fix_router');
  });

  it('bottleneck → escalate_cvo_refactor', () => {
    const actions = new ActionRecommender().recommend(statusOf(HarnessLifecycleState.BOTTLENECK));
    expect(actions[0]?.action).toBe('escalate_cvo_refactor');
  });

  it('appreciating / stable → 无行动', () => {
    expect(new ActionRecommender().recommend(statusOf(HarnessLifecycleState.APPRECIATING))).toHaveLength(0);
    expect(new ActionRecommender().recommend(statusOf(HarnessLifecycleState.STABLE))).toHaveLength(0);
  });

  it('自定义路由覆盖', () => {
    const recommender = new ActionRecommender({
      ...DEFAULT_ACTION_ROUTING,
      [HarnessLifecycleState.BOTTLENECK]: 'escalate_operator',
    });
    expect(recommender.recommend(statusOf(HarnessLifecycleState.BOTTLENECK))[0]?.action).toBe('escalate_operator');
  });
});

describe('recommendActions 便捷函数', () => {
  it('单组件建议', () => {
    expect(recommendActions(statusOf(HarnessLifecycleState.DEPRECIATING))[0]?.action).toBe('F012_sunset_review');
  });
});
