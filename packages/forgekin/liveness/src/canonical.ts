/**
 * liveness 规范读模型（F42 / F023-liveness-canonical-read，TS 移植）。
 *
 * 解决 liveness split-brain：单一规范读模型按源优先级
 * durable_record > in_process_tracker > draft_cache 判定四态
 * alive / degraded / zombie / grace_waiting。宽限期内不转 zombie；
 * 持久记录为单一真相源。
 */

export type LivenessState = 'alive' | 'degraded' | 'zombie' | 'grace_waiting';

export type CanonicalSource = 'durable_record' | 'in_process_tracker' | 'draft_cache';

export interface LivenessSignal {
  /** 最近心跳时刻（epoch ms）；缺失视为失联。 */
  lastHeartbeatAt?: number;
  /** 最近已确认副作用时刻（epoch ms）；缺失视为停滞。 */
  lastConfirmedSideEffectAt?: number;
}

export interface LivenessRecord extends LivenessSignal {
  forgekinId: string;
  state: LivenessState;
  graceDeadline?: number; // epoch ms
  canonicalSource: CanonicalSource;
}

export interface LivenessThresholds {
  /** 心跳超过此间隔未更新视为失联，进入宽限。 */
  heartbeatTtlMs: number;
  /** 副作用滞后超过此值视为退化。 */
  degradedLagMs: number;
  /** 失联/滞后超过宽限期转 zombie。 */
  gracePeriodMs: number;
  /** 心跳在但副作用完全停滞超过此值 → zombie。 */
  zombieLagMs: number;
}

export const DEFAULT_LIVENESS_THRESHOLDS: LivenessThresholds = {
  heartbeatTtlMs: 60_000,
  degradedLagMs: 60_000,
  gracePeriodMs: 120_000,
  zombieLagMs: 300_000,
};

/** 规范读输入：按源优先级的信号（durable 为准）。 */
export interface CanonicalReadInput {
  durableRecord?: LivenessSignal;
  inProcessTracker?: LivenessSignal;
  draftCache?: LivenessSignal;
}

/** 选择规范源并合并信号。 */
export function resolveCanonicalSignal(input: CanonicalReadInput): {
  source: CanonicalSource;
  signal: LivenessSignal;
} {
  if (input.durableRecord) return { source: 'durable_record', signal: input.durableRecord };
  if (input.inProcessTracker) return { source: 'in_process_tracker', signal: input.inProcessTracker };
  if (input.draftCache) return { source: 'draft_cache', signal: input.draftCache };
  return { source: 'durable_record', signal: {} };
}

/** 四态判定（纯函数，now 注入）。 */
export function judgeLiveness(
  _forgekinId: string,
  signal: LivenessSignal,
  thresholds: LivenessThresholds = DEFAULT_LIVENESS_THRESHOLDS,
  now: number = Date.now(),
): { state: LivenessState; graceDeadline?: number } {
  const heartbeatLag =
    signal.lastHeartbeatAt === undefined ? Number.POSITIVE_INFINITY : now - signal.lastHeartbeatAt;

  // 心跳失联。无任何心跳参照时无从建立宽限 → 直接 zombie。
  if (signal.lastHeartbeatAt === undefined) return { state: 'zombie' };

  if (heartbeatLag > thresholds.heartbeatTtlMs) {
    const graceDeadline = signal.lastHeartbeatAt + thresholds.heartbeatTtlMs + thresholds.gracePeriodMs;
    if (now >= graceDeadline) return { state: 'zombie' };
    return { state: 'grace_waiting', graceDeadline };
  }

  const sideEffectLag =
    signal.lastConfirmedSideEffectAt === undefined
      ? Number.POSITIVE_INFINITY
      : now - signal.lastConfirmedSideEffectAt;

  // 心跳在：副作用停滞 → zombie（zombie 检查方法 confirmed_side_effect_lag）
  if (sideEffectLag > thresholds.zombieLagMs) return { state: 'zombie' };
  if (sideEffectLag > thresholds.degradedLagMs) return { state: 'degraded' };
  return { state: 'alive' };
}

export interface CanonicalReadModelOptions {
  thresholds?: LivenessThresholds;
  now?: () => number;
}

export class CanonicalReadModel {
  private readonly thresholds: LivenessThresholds;
  private readonly now: () => number;

  constructor(options: CanonicalReadModelOptions = {}) {
    this.thresholds = options.thresholds ?? DEFAULT_LIVENESS_THRESHOLDS;
    this.now = options.now ?? Date.now;
  }

  /** 规范读：按源优先级读取 + 四态判定。 */
  read(forgekinId: string, input: CanonicalReadInput): LivenessRecord {
    const { source, signal } = resolveCanonicalSignal(input);
    const { state, graceDeadline } = judgeLiveness(forgekinId, signal, this.thresholds, this.now());
    return {
      forgekinId,
      ...signal,
      state,
      ...(graceDeadline !== undefined ? { graceDeadline } : {}),
      canonicalSource: source,
    };
  }

  /** 决策用读：只返回状态。 */
  readForDecision(forgekinId: string, input: CanonicalReadInput): LivenessState {
    return this.read(forgekinId, input).state;
  }
}
