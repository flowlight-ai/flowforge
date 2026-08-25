/**
 * lifecycle — Harness 组件生命周期判定（F040 §3.3 关键算法）。
 *
 * 增值/折旧判定：appreciation_score - friction_score > 0 → appreciating；
 * < 0 → depreciating；持续 depreciating 且阻塞其他 → bottleneck；
 * 信号冲突或归因频发 → action_needed；其余 → stable。
 *
 * @module @flowforge/forgekin-harness-eval
 */

import {
  HarnessLifecycleState,
  type HarnessComponentStatus,
  type HarnessComponentStatusInit,
} from './types.js';

/** 生命周期判定配置（对齐 F040 §3.4 YAML 配置）。 */
export interface LifecycleJudgeOptions {
  /** 增值阈值：appreciation 达到此值视为有效产出（默认 0.6） */
  readonly appreciation_threshold?: number | undefined;
  /** 摩擦阈值：friction 超过此值视为高摩擦（默认 0.4） */
  readonly friction_threshold?: number | undefined;
  /** 瓶颈判定所需的连续折旧天数（默认 7） */
  readonly bottleneck_consecutive_days?: number | undefined;
}

/** 合并后的非空配置（Required 会保留 `| undefined`，需显式声明）。 */
export interface ResolvedLifecycleOptions {
  readonly appreciation_threshold: number;
  readonly friction_threshold: number;
  readonly bottleneck_consecutive_days: number;
}

export const DEFAULT_LIFECYCLE_OPTIONS: ResolvedLifecycleOptions = {
  appreciation_threshold: 0.6,
  friction_threshold: 0.4,
  bottleneck_consecutive_days: 7,
};

/** 合并配置：忽略显式 undefined 字段，避免覆盖默认值。 */
export function resolveLifecycleOptions(
  options: LifecycleJudgeOptions = {},
): ResolvedLifecycleOptions {
  return {
    appreciation_threshold:
      options.appreciation_threshold ?? DEFAULT_LIFECYCLE_OPTIONS.appreciation_threshold,
    friction_threshold: options.friction_threshold ?? DEFAULT_LIFECYCLE_OPTIONS.friction_threshold,
    bottleneck_consecutive_days:
      options.bottleneck_consecutive_days ?? DEFAULT_LIFECYCLE_OPTIONS.bottleneck_consecutive_days,
  };
}

/** 生命周期判定输入——一次观测快照。 */
export interface LifecycleObservation {
  /** 组件 ID */
  readonly component_id: string;
  /** 关联契约 */
  readonly contract_id: string;
  /** 增值分 [0,1] */
  readonly appreciation_score: number;
  /** 摩擦分 [0,1] */
  readonly friction_score: number;
  /** 归因分布（类别 → 次数） */
  readonly attribution_distribution?: Readonly<Record<string, number>> | undefined;
  /** 连续折旧天数（含本次） */
  readonly consecutive_depreciating_days?: number | undefined;
  /** 是否阻塞其他组件 */
  readonly blocks_others?: boolean | undefined;
  /** 信号是否冲突（三方信号交叉出现矛盾） */
  readonly signal_conflict?: boolean | undefined;
}

/** 净产出 = 增值分 - 摩擦分。 */
export function netGain(appreciation: number, friction: number): number {
  return appreciation - friction;
}

/**
 * 判定组件生命周期状态（F040 §3.3）。
 *
 * 优先级：bottleneck（持续折旧 + 阻塞）> action_needed（信号冲突/归因频发）>
 * appreciating/depreciating（净产出符号）> stable。
 */
export function judgeLifecycleState(
  observation: LifecycleObservation,
  options: LifecycleJudgeOptions = {},
): HarnessLifecycleState {
  const opts = resolveLifecycleOptions(options);
  const { appreciation_score: a, friction_score: f } = observation;
  const net = netGain(a, f);

  // 信号冲突或归因频发 → action_needed（无论净产出符号）
  const attributionTotal =
    Object.values(observation.attribution_distribution ?? {}).reduce((s, v) => s + v, 0) ?? 0;
  if (observation.signal_conflict === true) {
    return HarnessLifecycleState.ACTION_NEEDED;
  }
  if (attributionTotal >= 3) {
    return HarnessLifecycleState.ACTION_NEEDED;
  }

  // 持续折旧（达到瓶颈窗口）+ 阻塞其他 → bottleneck
  const window = opts.bottleneck_consecutive_days;
  const consecutive = observation.consecutive_depreciating_days ?? 0;
  if (net < 0 && consecutive >= window && observation.blocks_others === true) {
    return HarnessLifecycleState.BOTTLENECK;
  }

  // 净产出符号判定
  if (net > 0 && a >= opts.appreciation_threshold) {
    return HarnessLifecycleState.APPRECIATING;
  }
  if (net < 0 && f >= opts.friction_threshold) {
    return HarnessLifecycleState.DEPRECIATING;
  }
  // 低产出低摩擦：净产出为负但摩擦未达阈值 → 视为需要行动（产出不足）
  if (net < 0) {
    return HarnessLifecycleState.DEPRECIATING;
  }
  return HarnessLifecycleState.STABLE;
}

/** 生命周期判定器——维护组件观测历史，按状态演化输出最新状态。 */
export class LifecycleJudge {
  private readonly options: ResolvedLifecycleOptions;
  /** component_id → 连续折旧天数 */
  private readonly depreciatingStreak = new Map<string, number>();

  constructor(options: LifecycleJudgeOptions = {}) {
    this.options = resolveLifecycleOptions(options);
  }

  /** 更新一个组件的观测，返回最新 HarnessComponentStatus。 */
  judge(observation: LifecycleObservation): HarnessComponentStatus {
    const prev = this.depreciatingStreak.get(observation.component_id) ?? 0;
    const state = judgeLifecycleState(observation, this.options);

    // 连续折旧天数维护：depreciating/bottleneck 递增，其余重置
    const streak =
      state === HarnessLifecycleState.DEPRECIATING || state === HarnessLifecycleState.BOTTLENECK
        ? prev + 1
        : 0;
    this.depreciatingStreak.set(observation.component_id, streak);

    // bottleneck 判定需要"连续 N 天"，但外部可能只传本次 streak；内部维护为准
    const effectiveState =
      state === HarnessLifecycleState.BOTTLENECK
        ? state
        : state === HarnessLifecycleState.DEPRECIATING &&
            observation.blocks_others === true &&
            streak >= this.options.bottleneck_consecutive_days
          ? HarnessLifecycleState.BOTTLENECK
          : state;

    return buildStatus(observation, effectiveState, streak);
  }

  /** 连续折旧天数（供外部展示）。 */
  streakOf(componentId: string): number {
    return this.depreciatingStreak.get(componentId) ?? 0;
  }

  /** 重置全部历史。 */
  reset(): void {
    this.depreciatingStreak.clear();
  }
}

/** 由观测 + 判定状态构建 HarnessComponentStatus。 */
export function buildStatus(
  observation: LifecycleObservation,
  state: HarnessLifecycleState,
  streak: number,
): HarnessComponentStatus {
  const status: HarnessComponentStatusInit = {
    component_id: observation.component_id,
    contract_id: observation.contract_id,
    appreciation_score: observation.appreciation_score,
    friction_score: observation.friction_score,
    attribution_distribution: observation.attribution_distribution ?? {},
    lifecycle_state: state,
    updated_at: Date.now(),
    last_action: state === HarnessLifecycleState.BOTTLENECK ? 'escalate_cvo_refactor' : undefined,
  };
  if (streak > 0) {
    // 连续折旧天数透出到 last_action 不可行（只读语义），以 updated_at 为准；
    // 保持与 F040 模型字段一致，不扩展模型。
    void streak;
  }
  return status as HarnessComponentStatus;
}
