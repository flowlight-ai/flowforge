/**
 * @flowforge/llm-route — Provider 配额治理（TS 重写自 `core/provider_quota.py`，
 * P3-004，F28）
 *
 * Provider 级别多维度配额检查与 backup 模型自动切换，作为可注入依赖供
 * LLMClient/LLMRouter 使用，不修改调用方代码。
 *
 * 支持维度：
 * - daily_token_limit：每日 Token 限额
 * - daily_request_limit：每日请求次数限额
 * - rpm_limit：每分钟请求次数限额（滑动窗口）
 * - tpm_limit：每分钟 Token 限额（滑动窗口）
 * - concurrent_limit：并发请求限额
 * - cooldown_seconds：触发限流后的冷却时间
 *
 * 检查顺序：cooldown → daily → rpm → tpm → concurrent
 *
 * @module @flowforge/llm-route/quota
 */

/** Provider 配额超限异常（provider_quota.py QuotaExceededError）。 */
export class QuotaExceededError extends Error {
  readonly provider: string;
  readonly reason: string;
  readonly retryAfterSeconds: number;

  constructor(provider: string, reason: string, retryAfterSeconds = 0) {
    super(
      `Provider '${provider}' quota exceeded: ${reason}`
      + (retryAfterSeconds > 0 ? ` (retry after ${retryAfterSeconds}s)` : ''),
    );
    this.provider = provider;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'QuotaExceededError';
  }
}

/** 所有 Provider（含 backup 模型）均失败异常（AllProvidersFailedError）。 */
export class AllProvidersFailedError extends Error {
  readonly provider: string;
  readonly errors: string[];

  constructor(provider: string, errors: string[]) {
    super(`All providers failed for '${provider}': ${errors.join('; ')}`);
    this.provider = provider;
    this.errors = errors;
    this.name = 'AllProvidersFailedError';
  }
}

/** Provider 处于冷却中异常（ProviderInCooldownError）。 */
export class ProviderInCooldownError extends Error {
  readonly provider: string;
  readonly retryAfterSeconds: number;

  constructor(provider: string, retryAfterSeconds: number) {
    super(`Provider '${provider}' is in cooldown, retry after ${retryAfterSeconds}s`);
    this.provider = provider;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'ProviderInCooldownError';
  }
}

/** Provider 配额配置（provider_quota.py ProviderQuotaConfig）。 */
export interface ProviderQuotaConfig {
  /** Provider 名称（openroute/doubao/openai/anthropic 等）。 */
  readonly provider: string;
  /** 每日 Token 限额（0 表示无限）。 */
  readonly dailyTokenLimit: number;
  /** 每日请求次数限额（0 表示无限）。 */
  readonly dailyRequestLimit: number;
  /** 每分钟请求限额（Requests Per Minute，0 表示无限）。 */
  readonly rpmLimit: number;
  /** 每分钟 Token 限额（Tokens Per Minute，0 表示无限）。 */
  readonly tpmLimit: number;
  /** 并发请求限额（0 表示无限）。 */
  readonly concurrentLimit: number;
  /** 是否启用配额治理。 */
  readonly enabled: boolean;
  /** 备用模型列表（按优先级排序）。 */
  readonly backupModels: string[];
  /** 触发限流后的冷却时间（秒）。 */
  readonly cooldownSeconds: number;
  /** 扩展元数据。 */
  readonly metadata: Record<string, unknown>;
}

export function providerQuotaConfigFrom(data: {
  provider: string;
  daily_token_limit?: number;
  daily_request_limit?: number;
  rpm_limit?: number;
  tpm_limit?: number;
  concurrent_limit?: number;
  enabled?: boolean;
  backup_models?: string[];
  cooldown_seconds?: number;
  metadata?: Record<string, unknown>;
}): ProviderQuotaConfig {
  return {
    provider: data.provider,
    dailyTokenLimit: data.daily_token_limit ?? 0,
    dailyRequestLimit: data.daily_request_limit ?? 0,
    rpmLimit: data.rpm_limit ?? 0,
    tpmLimit: data.tpm_limit ?? 0,
    concurrentLimit: data.concurrent_limit ?? 0,
    enabled: data.enabled ?? true,
    backupModels: Array.isArray(data.backup_models) ? data.backup_models : [],
    cooldownSeconds: data.cooldown_seconds ?? 60,
    metadata: data.metadata ?? {},
  };
}

/** 配额检查结果（provider_quota.py QuotaCheckResult）。 */
export interface QuotaCheckResult {
  /** 是否允许通过。 */
  readonly allowed: boolean;
  /** 不允许时的原因说明。 */
  readonly reason: string;
  /** 建议重试等待秒数。 */
  readonly retryAfterSeconds: number;
  /** 配额使用比例（0.0~1.0）。 */
  readonly quotaUsedRatio: number;
}

/** Provider 使用量统计（provider_quota.py QuotaUsage，滑动窗口计数）。 */
export interface QuotaUsage {
  provider: string;
  /** YYYY-MM-DD 格式 */
  date: string;
  tokensUsed: number;
  requestsUsed: number;
  concurrentCurrent: number;
  lastRequestTs: number;
  rpmWindow: number[];
  tpmWindow: Array<[number, number]>;
  cooldownUntil: number;
}

function isInCooldown(usage: QuotaUsage, now: number): boolean {
  if (usage.cooldownUntil <= 0.0) {
    return false;
  }
  return now < usage.cooldownUntil;
}

/** 清理滑动窗口中超过 60 秒的过期记录（_clean_sliding_window）。 */
function cleanSlidingWindow(usage: QuotaUsage, now: number): void {
  const cutoff = now - 60.0;
  usage.rpmWindow = usage.rpmWindow.filter((ts) => ts > cutoff);
  usage.tpmWindow = usage.tpmWindow.filter(([ts]) => ts > cutoff);
}

/** 重置每日计数（reset_daily，冷却状态保持不变）。 */
function resetDaily(usage: QuotaUsage): void {
  usage.tokensUsed = 0;
  usage.requestsUsed = 0;
  usage.rpmWindow = [];
  usage.tpmWindow = [];
  // concurrentCurrent 和 cooldownUntil 不在每日重置范围内
}

/** 指标采集器（duck-typing：兼容 MetricsCollector 或自定义采集器）。 */
export interface MetricsCollectorLike {
  recordProviderQuota?(payload: Record<string, unknown>): void;
  recordError?(message: string): void;
}

/** 主调用函数（try_with_backup 的 primary_call，签名 fn(target, ...args)）。 */
export type PrimaryCall<Args extends unknown[], R> = (
  target: string,
  ...args: Args
) => Promise<R>;

/**
 * Provider 配额治理管理器（provider_quota.py ProviderQuotaManager）。
 *
 * 负责多维度配额检查、使用量记录、冷却管理以及 backup 模型自动切换。
 * 依赖通过构造函数注入（铁律 12：禁止绕过 DI 容器直接实例化）。
 */
export class ProviderQuotaManager {
  private readonly configs: Map<string, ProviderQuotaConfig>;
  private readonly metricsCollector: MetricsCollectorLike | undefined;
  private usage: Map<string, QuotaUsage>;
  /** 当前时间（秒），测试注入。 */
  private readonly nowSec: () => number;
  /** 今日日期（YYYY-MM-DD，UTC），测试注入。 */
  private readonly todayFn: () => string;

  constructor(
    configs: Record<string, ProviderQuotaConfig>,
    options: {
      metricsCollector?: MetricsCollectorLike;
      nowSec?: () => number;
      todayFn?: () => string;
    } = {},
  ) {
    this.configs = new Map(Object.entries(configs));
    this.metricsCollector = options.metricsCollector;
    this.nowSec = options.nowSec ?? (() => Date.now() / 1000);
    this.todayFn = options.todayFn ?? (() => new Date().toISOString().slice(0, 10));
    this.usage = new Map();
    for (const provider of this.configs.keys()) {
      this.usage.set(provider, this.initUsage(provider));
    }
  }

  private initUsage(provider: string): QuotaUsage {
    return {
      provider,
      date: this.todayFn(),
      tokensUsed: 0,
      requestsUsed: 0,
      concurrentCurrent: 0,
      lastRequestTs: 0.0,
      rpmWindow: [],
      tpmWindow: [],
      cooldownUntil: 0.0,
    };
  }

  private getUsage(provider: string): QuotaUsage | undefined {
    return this.usage.get(provider);
  }

  private getConfig(provider: string): ProviderQuotaConfig | undefined {
    return this.configs.get(provider);
  }

  private ensureSameDay(usage: QuotaUsage): void {
    const today = this.todayFn();
    if (usage.date !== today) {
      resetDaily(usage);
      usage.date = today;
    }
  }

  private recordMetric(provider: string, event: string, fields: Record<string, unknown> = {}): void {
    const collector = this.metricsCollector;
    if (!collector) {
      return;
    }
    try {
      if (typeof collector.recordProviderQuota === 'function') {
        collector.recordProviderQuota({ provider, event, ...fields });
        return;
      }
      if (
        (event === 'quota_exceeded'
          || event === 'provider_in_cooldown'
          || event === 'all_providers_failed')
        && typeof collector.recordError === 'function'
      ) {
        collector.recordError(`provider_quota:${provider}:${event}:${JSON.stringify(fields)}`);
      }
    } catch {
      // 指标上报失败不阻断配额检查
    }
  }

  /** 计算配额使用比例（取所有已配置维度的最大使用比例，_compute_quota_ratio）。 */
  computeQuotaRatio(usage: QuotaUsage, config: ProviderQuotaConfig): number {
    const ratios: number[] = [];
    if (config.dailyTokenLimit > 0) {
      ratios.push(usage.tokensUsed / config.dailyTokenLimit);
    }
    if (config.dailyRequestLimit > 0) {
      ratios.push(usage.requestsUsed / config.dailyRequestLimit);
    }
    if (config.concurrentLimit > 0) {
      ratios.push(usage.concurrentCurrent / config.concurrentLimit);
    }
    const now = this.nowSec();
    if (config.rpmLimit > 0) {
      const cutoff = now - 60.0;
      const currentRpm = usage.rpmWindow.filter((ts) => ts > cutoff).length;
      ratios.push(currentRpm / config.rpmLimit);
    }
    if (config.tpmLimit > 0) {
      const cutoff = now - 60.0;
      const currentTpm = usage.tpmWindow
        .filter(([ts]) => ts > cutoff)
        .reduce((sum, [, tokens]) => sum + tokens, 0);
      ratios.push(currentTpm / config.tpmLimit);
    }
    return ratios.length > 0 ? Math.max(...ratios) : 0.0;
  }

  /**
   * 检查指定 provider 当前是否允许发起请求（check_quota）。
   *
   * 检查顺序：cooldown → daily_token → daily_request → rpm → tpm → concurrent。
   * 任一检查未通过则立即返回不允许。
   */
  async checkQuota(
    provider: string,
    estimatedTokens = 0,
  ): Promise<QuotaCheckResult> {
    const config = this.getConfig(provider);
    if (!config) {
      // 未配置的 provider 默认放行
      return { allowed: true, reason: 'provider not configured', retryAfterSeconds: 0, quotaUsedRatio: 0.0 };
    }
    if (!config.enabled) {
      return { allowed: false, reason: `provider '${provider}' is disabled`, retryAfterSeconds: 0, quotaUsedRatio: 0.0 };
    }

    let usage = this.getUsage(provider);
    if (!usage) {
      usage = this.initUsage(provider);
      this.usage.set(provider, usage);
    }

    this.ensureSameDay(usage);
    const now = this.nowSec();
    cleanSlidingWindow(usage, now);

    const quotaRatio = this.computeQuotaRatio(usage, config);

    // 1. cooldown 检查
    if (isInCooldown(usage, now)) {
      const retryAfter = Math.max(0, Math.floor(usage.cooldownUntil - now));
      this.recordMetric(provider, 'provider_in_cooldown', {
        reason: 'cooldown',
        retry_after: retryAfter,
      });
      return {
        allowed: false,
        reason: 'provider is in cooldown',
        retryAfterSeconds: retryAfter,
        quotaUsedRatio: quotaRatio,
      };
    }

    // 2. daily_token_limit
    if (config.dailyTokenLimit > 0) {
      if (usage.tokensUsed + estimatedTokens > config.dailyTokenLimit) {
        this.recordMetric(provider, 'quota_exceeded', {
          limit_type: 'daily_token',
          used: usage.tokensUsed,
          limit: config.dailyTokenLimit,
        });
        return {
          allowed: false,
          reason: 'daily_token_limit exceeded',
          retryAfterSeconds: 86400 - Math.floor(now % 86400),
          quotaUsedRatio: quotaRatio,
        };
      }
    }

    // 3. daily_request_limit
    if (config.dailyRequestLimit > 0) {
      if (usage.requestsUsed + 1 > config.dailyRequestLimit) {
        this.recordMetric(provider, 'quota_exceeded', {
          limit_type: 'daily_request',
          used: usage.requestsUsed,
          limit: config.dailyRequestLimit,
        });
        return {
          allowed: false,
          reason: 'daily_request_limit exceeded',
          retryAfterSeconds: 86400 - Math.floor(now % 86400),
          quotaUsedRatio: quotaRatio,
        };
      }
    }

    // 4. rpm_limit
    if (config.rpmLimit > 0) {
      const currentRpm = usage.rpmWindow.length;
      if (currentRpm + 1 > config.rpmLimit) {
        this.recordMetric(provider, 'quota_exceeded', {
          limit_type: 'rpm',
          used: currentRpm,
          limit: config.rpmLimit,
        });
        return {
          allowed: false,
          reason: 'rpm_limit exceeded',
          retryAfterSeconds: 60,
          quotaUsedRatio: quotaRatio,
        };
      }
    }

    // 5. tpm_limit
    if (config.tpmLimit > 0) {
      const currentTpm = usage.tpmWindow.reduce((sum, [, tokens]) => sum + tokens, 0);
      if (currentTpm + estimatedTokens > config.tpmLimit) {
        this.recordMetric(provider, 'quota_exceeded', {
          limit_type: 'tpm',
          used: currentTpm,
          limit: config.tpmLimit,
        });
        return {
          allowed: false,
          reason: 'tpm_limit exceeded',
          retryAfterSeconds: 60,
          quotaUsedRatio: quotaRatio,
        };
      }
    }

    // 6. concurrent_limit
    if (config.concurrentLimit > 0) {
      if (usage.concurrentCurrent + 1 > config.concurrentLimit) {
        this.recordMetric(provider, 'quota_exceeded', {
          limit_type: 'concurrent',
          used: usage.concurrentCurrent,
          limit: config.concurrentLimit,
        });
        return {
          allowed: false,
          reason: 'concurrent_limit exceeded',
          retryAfterSeconds: 1,
          quotaUsedRatio: quotaRatio,
        };
      }
    }

    return { allowed: true, reason: '', retryAfterSeconds: 0, quotaUsedRatio: quotaRatio };
  }

  /** 记录一次实际请求的使用量（record_usage）。 */
  async recordUsage(provider: string, tokensUsed: number, success: boolean): Promise<void> {
    let usage = this.getUsage(provider);
    if (!usage) {
      usage = this.initUsage(provider);
      this.usage.set(provider, usage);
    }
    this.ensureSameDay(usage);

    const now = this.nowSec();
    usage.tokensUsed += tokensUsed;
    usage.requestsUsed += 1;
    usage.lastRequestTs = now;
    usage.rpmWindow.push(now);
    usage.tpmWindow.push([now, tokensUsed]);
    // concurrent_current 由调用方在调用前后自行增减

    this.recordMetric(provider, 'usage_recorded', {
      tokens_used: tokensUsed,
      success,
      cumulative_tokens: usage.tokensUsed,
      cumulative_requests: usage.requestsUsed,
    });
  }

  /** 标记指定 provider 进入冷却期（mark_cooldown）。 */
  async markCooldown(provider: string, reason: string): Promise<void> {
    const config = this.getConfig(provider);
    const cooldownSeconds = config?.cooldownSeconds ?? 60;
    let usage = this.getUsage(provider);
    if (!usage) {
      usage = this.initUsage(provider);
      this.usage.set(provider, usage);
    }
    usage.cooldownUntil = this.nowSec() + cooldownSeconds;
    this.recordMetric(provider, 'cooldown_marked', {
      reason,
      cooldown_seconds: cooldownSeconds,
      cooldown_until: usage.cooldownUntil,
    });
  }

  /** 获取指定 provider 的首选备用模型（get_backup_model）。 */
  async getBackupModel(provider: string): Promise<string | undefined> {
    const config = this.getConfig(provider);
    if (!config || config.backupModels.length === 0) {
      return undefined;
    }
    return config.backupModels[0];
  }

  /**
   * 主调用失败时自动尝试 backup 模型（try_with_backup）。
   *
   * 调用流程：
   * 1. 调用 primaryCall(provider, ...args)；
   * 2. 若失败，按 backupModels 顺序依次尝试 primaryCall(model, ...args)；
   * 3. 全部失败则抛出 AllProvidersFailedError。
   */
  async tryWithBackup<Args extends unknown[], R>(
    provider: string,
    primaryCall: PrimaryCall<Args, R>,
    ...args: Args
  ): Promise<R> {
    const config = this.getConfig(provider);
    const backupModels = config ? [...config.backupModels] : [];

    // 候选调用目标列表：provider 自身 + backup_models
    const candidates: string[] = [provider, ...backupModels];
    const errors: string[] = [];

    for (let idx = 0; idx < candidates.length; idx += 1) {
      const target = candidates[idx] ?? '';
      try {
        const result = await primaryCall(target, ...args);
        this.recordMetric(provider, 'call_succeeded', {
          target,
          attempt_index: idx,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${target}: ${error?.constructor?.name ?? 'Error'}: ${message}`);
        // 主 provider 失败 → 标记冷却
        if (idx === 0) {
          await this.markCooldown(provider, `primary_call_failed: ${message}`);
        }
      }
    }

    this.recordMetric(provider, 'all_providers_failed', {
      candidates,
      errors,
    });
    throw new AllProvidersFailedError(provider, errors);
  }

  /** 获取指定 provider 的当前使用状态（get_usage_status）。 */
  getUsageStatus(provider: string): Record<string, unknown> {
    const config = this.getConfig(provider);
    if (!config) {
      return {};
    }
    let usage = this.getUsage(provider);
    if (!usage) {
      usage = this.initUsage(provider);
      this.usage.set(provider, usage);
    }

    this.ensureSameDay(usage);
    const now = this.nowSec();
    cleanSlidingWindow(usage, now);

    const inCooldown = isInCooldown(usage, now);
    return {
      provider,
      enabled: config.enabled,
      date: usage.date,
      tokens_used: usage.tokensUsed,
      requests_used: usage.requestsUsed,
      concurrent_current: usage.concurrentCurrent,
      last_request_ts: usage.lastRequestTs,
      rpm_current: usage.rpmWindow.length,
      tpm_current: usage.tpmWindow.reduce((sum, [, tokens]) => sum + tokens, 0),
      in_cooldown: inCooldown,
      cooldown_until: usage.cooldownUntil,
      cooldown_remaining_seconds: inCooldown
        ? Math.max(0, Math.floor(usage.cooldownUntil - now))
        : 0,
      backup_models: [...config.backupModels],
      limits: {
        daily_token_limit: config.dailyTokenLimit,
        daily_request_limit: config.dailyRequestLimit,
        rpm_limit: config.rpmLimit,
        tpm_limit: config.tpmLimit,
        concurrent_limit: config.concurrentLimit,
        cooldown_seconds: config.cooldownSeconds,
      },
      quota_used_ratio: this.computeQuotaRatio(usage, config),
    };
  }

  /** 获取所有已配置 provider 的状态（get_all_status）。 */
  getAllStatus(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const provider of this.configs.keys()) {
      result[provider] = this.getUsageStatus(provider);
    }
    return result;
  }

  /** 每日配额重置（reset_daily_quota，供调度器调用）。 */
  async resetDailyQuota(): Promise<void> {
    const today = this.todayFn();
    for (const [provider, usage] of this.usage) {
      resetDaily(usage);
      usage.date = today;
      this.recordMetric(provider, 'daily_quota_reset', { date: today });
    }
  }

  /** 占用一个并发槽位（acquire_concurrent）。 */
  async acquireConcurrent(provider: string): Promise<void> {
    let usage = this.getUsage(provider);
    if (!usage) {
      usage = this.initUsage(provider);
      this.usage.set(provider, usage);
    }
    usage.concurrentCurrent += 1;
  }

  /** 释放一个并发槽位（release_concurrent）。 */
  async releaseConcurrent(provider: string): Promise<void> {
    const usage = this.getUsage(provider);
    if (!usage) {
      return;
    }
    if (usage.concurrentCurrent > 0) {
      usage.concurrentCurrent -= 1;
    }
  }
}
