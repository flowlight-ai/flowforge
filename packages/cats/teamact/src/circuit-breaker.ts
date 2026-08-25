/**
 * @flowforge/cats-teamact — T7.17 PingPongCircuitBreaker 乒乓球熔断器（roleagent.md §2.4）。
 *
 * TS 重写自 `core/teamact/circuit_breaker.py`：
 * 检测 Forgekin 间的"乒乓球"模式——两个 Forgekin 互相传球却没有实质进展。
 * 当 N > threshold（默认 3）时触发熔断，建议"该换路了"（不是"再来一个就好了"）。
 * 给数据不给结论：返回失败次数和原因，不直接决策下一步。
 *
 * @module @flowforge/cats-teamact
 */

/** PingPongCircuitBreaker 构造选项（阈值/冷却通过配置注入，铁律 5）。 */
export interface PingPongCircuitBreakerOptions {
  /** 绝对上限轮数（硬熔断，超过则强制中断；默认 5）。 */
  readonly maxRounds?: number | undefined;
  /** 软阈值（N > threshold 时建议换路；默认 3）。 */
  readonly threshold?: number | undefined;
  /** 冷却时间（秒），熔断后需等待冷却才能重置（默认 60）。 */
  readonly cooldown?: number | undefined;
  /** 诊断日志回调（可注入 TraceLogger；缺省 console.debug）。 */
  readonly logger?: ((message: string) => void) | undefined;
}

/** 单个 Forgekin 的失败诊断数据（给数据不给结论）。 */
export interface PingPongFailureData {
  readonly agentId: string;
  readonly roundsCount: number;
  readonly threshold: number;
  readonly maxRounds: number;
  readonly shouldBreak: boolean;
  readonly lastFailureTime: string | null;
  readonly lastFailureReason: string | null;
}

/** 乒乓球熔断器 — 检测 Forgekin 间无进展的来回传球模式。 */
export class PingPongCircuitBreaker {
  readonly maxRounds: number;
  readonly threshold: number;
  readonly cooldown: number;

  private readonly roundsCount = new Map<string, number>();
  private readonly lastFailure = new Map<string, { time: Date; reason: string }>();
  private readonly logger: (message: string) => void;

  constructor(options: PingPongCircuitBreakerOptions = {}) {
    this.maxRounds = options.maxRounds ?? 5;
    this.threshold = options.threshold ?? 3;
    this.cooldown = options.cooldown ?? 60;
    this.logger = options.logger ?? ((message: string) => console.debug(message));
  }

  /** 记录一次失败（乒乓球来回）：计数 +1 并记录最近失败原因。 */
  recordFailure(agentId: string, reason: string): void {
    this.roundsCount.set(agentId, (this.roundsCount.get(agentId) ?? 0) + 1);
    this.lastFailure.set(agentId, { time: new Date(), reason });
    const count = this.roundsCount.get(agentId) ?? 0;
    this.logger(`PingPong failure recorded: agent=${agentId} count=${count} reason=${reason}`);
  }

  /**
   * 检查是否应触发熔断（roleagent.md §2.4）：
   *   - N > maxRounds → True（硬上限）
   *   - N > threshold → True（"该换路了"）
   *   - 否则 → False（继续尝试）
   */
  shouldBreak(agentId: string): boolean {
    const count = this.roundsCount.get(agentId) ?? 0;
    if (count > this.maxRounds) return true;
    return count > this.threshold;
  }

  /** 重置 Forgekin 的失败计数（取得实质进展/通过 review 时调用）。 */
  reset(agentId: string): void {
    this.roundsCount.delete(agentId);
    this.lastFailure.delete(agentId);
    this.logger(`PingPong counter reset: agent=${agentId}`);
  }

  /** 获取失败数据（给数据不给结论，由 CVO/operator 决定下一步）。 */
  getFailureData(agentId: string): PingPongFailureData {
    const count = this.roundsCount.get(agentId) ?? 0;
    const last = this.lastFailure.get(agentId);
    return {
      agentId,
      roundsCount: count,
      threshold: this.threshold,
      maxRounds: this.maxRounds,
      shouldBreak: this.shouldBreak(agentId),
      lastFailureTime: last?.time.toISOString() ?? null,
      lastFailureReason: last?.reason ?? null,
    };
  }
}
