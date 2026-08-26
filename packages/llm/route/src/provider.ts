/**
 * @flowforge/llm-route — ModelCapabilityProvider（TS 重写自
 * `tools/llm/model_capability_provider.py`，F28）
 *
 * 零配置模型访问 + 智能路由 + 降级兜底：
 * - 零配置：从 models 配置自动发现可用模型
 * - 智能路由：按能力（capability）路由到最优可用模型
 * - 降级：失败时回退到替代模型
 * - 健康追踪：跟踪模型可用性与延迟
 *
 * @module @flowforge/llm-route/provider
 */

/** 模型健康状态（model_capability_provider.py ModelHealth）。 */
export enum ModelHealth {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNAVAILABLE = 'unavailable',
}

/** 模型信息（model_capability_provider.py ModelInfo）。 */
export interface ModelInfo {
  name: string;
  provider: string;
  capabilities: string[];
  health: ModelHealth;
  latencyMs: number;
  failureCount: number;
  lastCheck: number;
}

export function createModelInfo(
  name: string,
  provider: string,
  capabilities: string[] = [],
): ModelInfo {
  return {
    name,
    provider,
    capabilities,
    health: ModelHealth.HEALTHY,
    latencyMs: 0.0,
    failureCount: 0,
    lastCheck: 0.0,
  };
}

/**
 * 零配置模型访问 + 智能路由 + 降级兜底（model_capability_provider.py
 * ModelCapabilityProvider）。
 *
 * 支持两种配置格式：
 * 1. 列表格式：models 是 [{ id, provider, capabilities, enabled }]
 * 2. 字典格式：models 是 { model_name: { provider, capabilities } }
 */
export class ModelCapabilityProvider {
  private models: Map<string, ModelInfo>;
  /** capability -> [model_names] */
  private capabilityMap: Map<string, string[]>;
  private readonly config: Record<string, unknown>;

  constructor(config: Record<string, unknown> = {}) {
    this.models = new Map();
    this.capabilityMap = new Map();
    this.config = config;
    this.loadModelsFromConfig();
  }

  /** 从配置自动发现模型（_load_models_from_config）。 */
  loadModelsFromConfig(): void {
    const modelsConfig = this.config['models'];
    if (Array.isArray(modelsConfig)) {
      // 列表格式：[{"id": "auto", "provider": "openroute", ...}, ...]
      for (const item of modelsConfig) {
        if (!isRecord(item)) {
          continue;
        }
        const modelId = asString(item['id'], '');
        const provider = asString(item['provider'], 'unknown');
        const capabilities = asStringArray(item['capabilities']);
        const enabled = item['enabled'] === undefined || item['enabled'] !== false;
        if (modelId.length > 0 && enabled) {
          this.registerModel(modelId, provider, capabilities);
        }
      }
    } else if (isRecord(modelsConfig)) {
      // 字典格式：{"model_name": {"provider": "...", ...}, ...}
      for (const [modelName, modelConf] of Object.entries(modelsConfig)) {
        if (!isRecord(modelConf)) {
          continue;
        }
        const provider = asString(modelConf['provider'], 'unknown');
        const capabilities = asStringArray(modelConf['capabilities']);
        this.registerModel(modelName, provider, capabilities);
      }
    }
  }

  /** 注册模型及其能力（register_model）。 */
  registerModel(
    name: string,
    provider: string,
    capabilities: string[] = [],
  ): void {
    const info = createModelInfo(name, provider, capabilities);
    this.models.set(name, info);
    for (const cap of capabilities) {
      const list = this.capabilityMap.get(cap) ?? [];
      if (!list.includes(name)) {
        list.push(name);
      }
      this.capabilityMap.set(cap, list);
    }
  }

  /**
   * 获取指定能力的最优可用模型（get_model）。
   *
   * 策略：
   * 1. preferred 模型健康则用之
   * 2. 找具备所需能力的模型，按健康（healthy > degraded > unavailable）再延迟排序
   * 3. 兜底：任意健康模型；最后是任意非 unavailable 模型
   */
  getModel(
    capability?: string | null,
    preferred?: string | null,
  ): string | undefined {
    // 先试 preferred 模型
    if (preferred && preferred.length > 0) {
      const preferredInfo = this.models.get(preferred);
      if (preferredInfo && preferredInfo.health !== ModelHealth.UNAVAILABLE) {
        return preferred;
      }
    }

    // 按能力查找
    if (capability && capability.length > 0) {
      const candidates = this.capabilityMap.get(capability);
      if (candidates && candidates.length > 0) {
        const healthy = candidates.filter(
          (m) => this.models.get(m)?.health === ModelHealth.HEALTHY,
        );
        if (healthy.length > 0) {
          return minByLatency(this.models, healthy);
        }
        const degraded = candidates.filter(
          (m) => this.models.get(m)?.health === ModelHealth.DEGRADED,
        );
        if (degraded.length > 0) {
          return minByLatency(this.models, degraded);
        }
      }
    }

    // 兜底：任意健康模型
    const healthyModels = [...this.models.entries()]
      .filter(([, info]) => info.health === ModelHealth.HEALTHY)
      .map(([name]) => name);
    if (healthyModels.length > 0) {
      return minByLatency(this.models, healthyModels);
    }

    // 最后：任意非 unavailable 模型
    const available = [...this.models.entries()]
      .filter(([, info]) => info.health !== ModelHealth.UNAVAILABLE)
      .map(([name]) => name);
    return available.length > 0 ? (available[0] ?? undefined) : undefined;
  }

  /** 报告成功调用（report_success）。 */
  reportSuccess(modelName: string, latencyMs: number): void {
    const info = this.models.get(modelName);
    if (!info) {
      return;
    }
    info.latencyMs = latencyMs;
    info.failureCount = Math.max(0, info.failureCount - 1);
    if (info.health === ModelHealth.DEGRADED && info.failureCount === 0) {
      info.health = ModelHealth.HEALTHY;
    }
  }

  /** 报告调用失败（report_failure）。 */
  reportFailure(modelName: string, _error = ''): void {
    const info = this.models.get(modelName);
    if (!info) {
      return;
    }
    info.failureCount += 1;
    if (info.failureCount >= 3) {
      info.health = ModelHealth.UNAVAILABLE;
    } else if (info.failureCount >= 1) {
      info.health = ModelHealth.DEGRADED;
    }
  }

  /** 获取所有模型健康状态（get_health_status）。 */
  getHealthStatus(): Record<
    string,
    { health: string; latency_ms: number; failures: number }
  > {
    const result: Record<
      string,
      { health: string; latency_ms: number; failures: number }
    > = {};
    for (const [name, info] of this.models) {
      result[name] = {
        health: info.health,
        latency_ms: info.latencyMs,
        failures: info.failureCount,
      };
    }
    return result;
  }

  /** 获取模型信息（含注册表快照）。 */
  getModelInfo(name: string): ModelInfo | undefined {
    return this.models.get(name);
  }

  /** 列出全部已注册模型。 */
  listModels(): ModelInfo[] {
    return [...this.models.values()];
  }
}

function minByLatency(
  models: Map<string, ModelInfo>,
  names: string[],
): string | undefined {
  let best: string | undefined;
  let bestLatency = Number.POSITIVE_INFINITY;
  for (const name of names) {
    const info = models.get(name);
    if (info && info.latencyMs < bestLatency) {
      best = name;
      bestLatency = info.latencyMs;
    }
  }
  return best;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
