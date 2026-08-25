/**
 * recommender — 行动建议派发（F040 §3.2 ActionRecommender / §3.3 行动建议）。
 *
 * 状态 → 处理方路由（对齐 F040 §3.4 action_routing）：
 * - depreciating  → F012_sunset_review（Entropy Control 退役评审）
 * - action_needed → F020_fix_router（七类归因修复路由）
 * - bottleneck    → escalate_cvo_refactor（升级 CVO 重构）
 * - appreciating / stable → 无行动（记录观察）
 *
 * @module @flowforge/forgekin-harness-eval
 */

import { HarnessLifecycleState, type HarnessAction, type HarnessComponentStatus } from './types.js';

/** 行动路由表——状态 → 处理方（对齐 F040 §3.4 action_routing）。 */
export interface ActionRouting {
  readonly [HarnessLifecycleState.DEPRECIATING]: string;
  readonly [HarnessLifecycleState.ACTION_NEEDED]: string;
  readonly [HarnessLifecycleState.BOTTLENECK]: string;
}

export const DEFAULT_ACTION_ROUTING: ActionRouting = {
  [HarnessLifecycleState.DEPRECIATING]: 'F012_sunset_review',
  [HarnessLifecycleState.ACTION_NEEDED]: 'F020_fix_router',
  [HarnessLifecycleState.BOTTLENECK]: 'escalate_cvo_refactor',
};

/** 行动建议器——按组件生命周期状态派发行动。 */
export class ActionRecommender {
  private readonly routing: ActionRouting;

  constructor(routing: ActionRouting = DEFAULT_ACTION_ROUTING) {
    this.routing = routing;
  }

  /** 对一个组件状态给出行动建议（无行动返回空数组）。 */
  recommend(status: HarnessComponentStatus, now: number = Date.now()): HarnessAction[] {
    const target = (this.routing as Readonly<Partial<Record<HarnessLifecycleState, string>>>)[
      status.lifecycle_state
    ];
    if (!target) {
      return [];
    }
    return [
      {
        action: target,
        component_id: status.component_id,
        reason: this.reasonFor(status.lifecycle_state, status),
        dispatched_at: now,
      },
    ];
  }

  /** 批量建议。 */
  recommendAll(statuses: readonly HarnessComponentStatus[], now: number = Date.now()): HarnessAction[] {
    return statuses.flatMap((s) => this.recommend(s, now));
  }

  private reasonFor(state: HarnessLifecycleState, status: HarnessComponentStatus): string {
    const net = status.appreciation_score - status.friction_score;
    switch (state) {
      case HarnessLifecycleState.DEPRECIATING:
        return `friction ${status.friction_score.toFixed(2)} exceeds appreciation ${status.appreciation_score.toFixed(2)} (net ${net.toFixed(2)})`;
      case HarnessLifecycleState.ACTION_NEEDED:
        return `signal conflict or frequent attribution (${Object.keys(status.attribution_distribution).length} categories)`;
      case HarnessLifecycleState.BOTTLENECK:
        return `sustained depreciation (net ${net.toFixed(2)}) blocking other components`;
      default:
        return `state ${state}`;
    }
  }
}

/** 便捷函数：单组件建议。 */
export function recommendActions(
  status: HarnessComponentStatus,
  routing: ActionRouting = DEFAULT_ACTION_ROUTING,
): HarnessAction[] {
  return new ActionRecommender(routing).recommend(status);
}
