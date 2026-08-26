/**
 * @flowforge/external-agent guardrails/cost-ceiling — L6 成本上限（EX-006）。
 *
 * TS 重写自 flowforge/core/external_agent/guardrails/cost_ceiling.py：
 *   - CostStore Protocol（DI 注入点）：getUsage / addUsage / resetUsage
 *   - CostCeilingConfig: default_token_quota=1M / default_call_quota=1000 /
 *     default_cost_quota=100 / warn_threshold=0.8 / critical_threshold=1.0 /
 *     per_forgekin_quota
 *   - CostCheckResult: allowed / current_* / *_quota / warning / usage_ratio
 *   - CostCeilingGuardrail: check（三维配额 + 预估）/ recordUsage /
 *     getUsageReport / resetQuota
 */

/** 成本存储后端协议（cost_ceiling.py CostStore）。 */
export interface CostStore {
  /** 获取某 Forgekin 的累计成本使用量。 */
  getUsage(forgekinId: string): Promise<Record<string, unknown>>;
  /** 累加使用量。 */
  addUsage(forgekinId: string, tokens: number, calls: number, cost: number): Promise<void>;
  /** 重置使用量（如配额周期重置）。 */
  resetUsage(forgekinId: string): Promise<void>;
}

/** 成本上限配置（cost_ceiling.py CostCeilingConfig）。 */
export interface CostCeilingConfig {
  /** 默认 token 配额。 */
  readonly default_token_quota: number;
  /** 默认调用次数配额。 */
  readonly default_call_quota: number;
  /** 默认货币成本配额（美元）。 */
  readonly default_cost_quota: number;
  /** 告警阈值（占配额百分比，80%）。 */
  readonly warn_threshold: number;
  /** 临界阈值（占配额百分比，100%）。 */
  readonly critical_threshold: number;
  /** 按 Forgekin 覆盖配额（key=forgekin_id）。 */
  readonly per_forgekin_quota: Readonly<Record<string, Record<string, unknown>>>;
}

/** 默认成本上限配置。 */
export const DEFAULT_COST_CEILING_CONFIG: CostCeilingConfig = {
  default_token_quota: 1_000_000,
  default_call_quota: 1000,
  default_cost_quota: 100.0,
  warn_threshold: 0.8,
  critical_threshold: 1.0,
  per_forgekin_quota: {},
};

/** 成本检查结果（cost_ceiling.py CostCheckResult）。 */
export interface CostCheckResult {
  /** 是否允许调用。 */
  readonly allowed: boolean;
  /** Forgekin ID。 */
  readonly forgekin_id: string;
  /** 当前 token 使用量。 */
  readonly current_tokens: number;
  /** 当前调用次数。 */
  readonly current_calls: number;
  /** 当前货币成本。 */
  readonly current_cost: number;
  /** token 配额。 */
  readonly token_quota: number;
  /** 调用次数配额。 */
  readonly call_quota: number;
  /** 货币成本配额。 */
  readonly cost_quota: number;
  /** 告警信息。 */
  readonly warning: string;
  /** 使用率（0.0-1.0+）。 */
  readonly usage_ratio: number;
}

/** L6 成本上限 Guardrail（cost_ceiling.py CostCeilingGuardrail，EX-006）。 */
export class CostCeilingGuardrail {
  private readonly _store: CostStore;
  private readonly _config: CostCeilingConfig;

  constructor(store: CostStore, config?: Partial<CostCeilingConfig>) {
    this._store = store;
    this._config = {
      ...DEFAULT_COST_CEILING_CONFIG,
      ...config,
      per_forgekin_quota: config?.per_forgekin_quota ?? {},
    };
  }

  /**
   * 检查是否允许调用（配额未超；含本次预估）。
   */
  async check(
    forgekinId: string,
    estimatedTokens = 0,
    estimatedCost = 0.0,
  ): Promise<CostCheckResult> {
    const usage = await this._store.getUsage(forgekinId);
    const currentTokens = Number(usage['tokens'] ?? 0);
    const currentCalls = Number(usage['calls'] ?? 0);
    const currentCost = Number(usage['cost'] ?? 0.0);

    // 获取配额（per_forgekin 优先，否则 default）
    const quota = this._config.per_forgekin_quota[forgekinId] ?? {};
    const tokenQuota = Number(
      quota['token_quota'] ?? this._config.default_token_quota,
    );
    const callQuota = Number(
      quota['call_quota'] ?? this._config.default_call_quota,
    );
    const costQuota = Number(
      quota['cost_quota'] ?? this._config.default_cost_quota,
    );

    // 预估使用量
    const projectedTokens = currentTokens + estimatedTokens;
    const projectedCalls = currentCalls + 1;
    const projectedCost = currentCost + estimatedCost;

    // 计算使用率（取三者最大值）
    const tokenRatio = tokenQuota > 0 ? projectedTokens / tokenQuota : 0;
    const callRatio = callQuota > 0 ? projectedCalls / callQuota : 0;
    const costRatio = costQuota > 0 ? projectedCost / costQuota : 0;
    const maxRatio = Math.max(tokenRatio, callRatio, costRatio);

    // 判断是否允许
    const allowed = maxRatio < this._config.critical_threshold;
    let warning = '';
    if (maxRatio >= this._config.critical_threshold) {
      warning =
        `配额超限：token=${projectedTokens}/${tokenQuota} ` +
        `calls=${projectedCalls}/${callQuota} ` +
        `cost=${projectedCost.toFixed(2)}/${costQuota.toFixed(2)}`;
    } else if (maxRatio >= this._config.warn_threshold) {
      warning =
        `配额告警：使用率 ${(maxRatio * 100).toFixed(1)}%，` +
        `token=${projectedTokens}/${tokenQuota} ` +
        `calls=${projectedCalls}/${callQuota} ` +
        `cost=${projectedCost.toFixed(2)}/${costQuota.toFixed(2)}`;
    }

    return {
      allowed,
      forgekin_id: forgekinId,
      current_tokens: currentTokens,
      current_calls: currentCalls,
      current_cost: currentCost,
      token_quota: tokenQuota,
      call_quota: callQuota,
      cost_quota: costQuota,
      warning,
      usage_ratio: maxRatio,
    };
  }

  /** 记录实际使用量（调用完成后）。 */
  async recordUsage(
    forgekinId: string,
    tokens: number,
    calls: number,
    cost: number,
  ): Promise<void> {
    await this._store.addUsage(forgekinId, tokens, calls, cost);
  }

  /** 获取某 Forgekin 的成本使用报告（用于审计 / 成本分摊）。 */
  async getUsageReport(forgekinId: string): Promise<Record<string, unknown>> {
    const usage = await this._store.getUsage(forgekinId);
    const quota = this._config.per_forgekin_quota[forgekinId] ?? {};
    return {
      forgekin_id: forgekinId,
      usage,
      quota: {
        token_quota: quota['token_quota'] ?? this._config.default_token_quota,
        call_quota: quota['call_quota'] ?? this._config.default_call_quota,
        cost_quota: quota['cost_quota'] ?? this._config.default_cost_quota,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /** 重置配额（如配额周期重置）。 */
  async resetQuota(forgekinId: string): Promise<void> {
    await this._store.resetUsage(forgekinId);
  }

  /** 当前配置。 */
  get config(): CostCeilingConfig {
    return {
      ...this._config,
      per_forgekin_quota: { ...this._config.per_forgekin_quota },
    };
  }
}
