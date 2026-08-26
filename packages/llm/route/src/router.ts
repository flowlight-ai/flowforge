/**
 * @flowforge/llm-route — LLM 路由层（TS 重写自 `llm/router.py`，F28）
 *
 * 多模型级联 + 健康检查 + 自动切换：从 models.yaml 加载级联策略配置，
 * 根据模型健康状态自动路由到最优模型。
 *
 * 注意：配置文件中使用 assignments（含 primary + fallbacks），而非旧的
 * cascade_strategies（含 primary + fallback）。本类对外保留 route(strategy)
 * 接口，内部映射到 assignments。
 *
 * @module @flowforge/llm-route/router
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

/** 模型健康状态（llm/router.py ModelHealth）。 */
export enum ModelHealth {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNAVAILABLE = 'unavailable',
}

/** 模型运行时状态（llm/router.py ModelStatus）。 */
export interface ModelStatus {
  modelId: string;
  health: ModelHealth;
  latencyP95: number;
  errorRate: number;
  lastSuccess: number;
  consecutiveErrors: number;
  totalCalls: number;
  totalErrors: number;
}

export function createModelStatus(modelId: string): ModelStatus {
  return {
    modelId,
    health: ModelHealth.HEALTHY,
    latencyP95: 0.0,
    errorRate: 0.0,
    lastSuccess: 0.0,
    consecutiveErrors: 0,
    totalCalls: 0,
    totalErrors: 0,
  };
}

/** 内部级联策略（assignments → { primary, fallback }）。 */
export interface CascadeStrategy {
  readonly primary: string;
  readonly fallback: string[];
}

/**
 * LLM 路由器 — 根据级联策略选择最优模型（llm/router.py LLMRouter）。
 *
 * 支持：
 * - 多策略路由（default/content_writing/code_generation/fact_check 等）
 * - 健康感知：自动跳过 UNAVAILABLE 模型
 * - 降级路由：HEALTHY → DEGRADED → UNAVAILABLE
 * - 运行时健康更新：recordSuccess/recordError
 */
export class LLMRouter {
  private models: Map<string, ModelStatus>;
  private cascadeStrategies: Map<string, CascadeStrategy>;
  private modelSpecs: Map<string, Record<string, unknown>>;

  constructor(configPath?: string) {
    this.models = new Map();
    this.cascadeStrategies = new Map();
    this.modelSpecs = new Map();
    if (configPath !== undefined && configPath.length > 0) {
      this.loadConfig(configPath);
    }
  }

  /**
   * 加载模型分配配置（从 models.yaml 的 assignments 段，router.py _load_config）。
   *
   * 兼容旧配置：若 assignments 不存在，回退到 cascade_strategies。
   */
  loadConfig(path: string): void {
    try {
      const data = parseYaml(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      this.applyConfig(data);
    } catch {
      // 对齐 Python：加载失败仅记录，不抛出
    }
  }

  /** 从配置对象应用 assignments/models（供测试与插件化注入）。 */
  applyConfig(data: Record<string, unknown>): void {
    // 优先从 assignments 加载（models.yaml 的标准结构）
    const assignments = isRecord(data['assignments']) ? data['assignments'] : {};
    const loadedAssignments = new Map<string, CascadeStrategy>();
    for (const [key, assignment] of Object.entries(assignments)) {
      if (!isRecord(assignment)) {
        continue;
      }
      loadedAssignments.set(key, {
        primary: asString(assignment['primary'], ''),
        fallback: asStringArray(assignment['fallbacks']),
      });
    }
    if (loadedAssignments.size > 0) {
      this.cascadeStrategies = loadedAssignments;
    } else {
      // 回退兼容：旧的 cascade_strategies 结构
      const legacy = isRecord(data['cascade_strategies']) ? data['cascade_strategies'] : {};
      const legacyStrategies = new Map<string, CascadeStrategy>();
      for (const [key, strategy] of Object.entries(legacy)) {
        if (!isRecord(strategy)) {
          continue;
        }
        legacyStrategies.set(key, {
          primary: asString(strategy['primary'], ''),
          fallback: asStringArray(strategy['fallback']),
        });
      }
      if (legacyStrategies.size > 0) {
        this.cascadeStrategies = legacyStrategies;
      }
    }

    // 加载模型规格（兼容 models 列表和 model_specs 字典两种格式）
    this.modelSpecs = new Map();
    const specs = isRecord(data['model_specs']) ? data['model_specs'] : {};
    for (const [mid, spec] of Object.entries(specs)) {
      if (isRecord(spec)) {
        this.modelSpecs.set(mid, spec);
      }
    }
    const modelsList = Array.isArray(data['models']) ? data['models'] : [];
    if (modelsList.length > 0 && this.modelSpecs.size === 0) {
      for (const m of modelsList) {
        if (!isRecord(m)) {
          continue;
        }
        const mid = asString(m['id'], '');
        if (mid.length > 0) {
          this.modelSpecs.set(mid, m);
        }
      }
    }

    // 初始化模型状态
    for (const modelId of this.modelSpecs.keys()) {
      if (!this.models.has(modelId)) {
        this.models.set(modelId, createModelStatus(modelId));
      }
    }
    // 从级联策略中提取模型ID并初始化
    for (const strategy of this.cascadeStrategies.values()) {
      if (strategy.primary.length > 0 && !this.models.has(strategy.primary)) {
        this.models.set(strategy.primary, createModelStatus(strategy.primary));
      }
      for (const fb of strategy.fallback) {
        if (fb.length > 0 && !this.models.has(fb)) {
          this.models.set(fb, createModelStatus(fb));
        }
      }
    }
  }

  /** 根据策略路由到最优模型（router.py route）。 */
  route(strategy = 'default'): string {
    const config =
      this.cascadeStrategies.get(strategy) ?? this.cascadeStrategies.get('default');
    const primary = config?.primary ?? '';
    const fallbackChain = config?.fallback ?? [];

    // 检查 primary 健康
    if (this.isAvailable(primary)) {
      return primary;
    }

    // 遍历 fallback 链
    for (const modelId of fallbackChain) {
      if (this.isAvailable(modelId)) {
        return modelId;
      }
    }

    // 全部不可用，返回 primary（让调用方处理错误）
    return primary;
  }

  /** 检查模型是否可用（router.py _is_available）。 */
  isAvailable(modelId: string): boolean {
    const status = this.models.get(modelId);
    if (!status) {
      return true; // 未知模型默认可用
    }
    return status.health !== ModelHealth.UNAVAILABLE;
  }

  /** 记录成功调用（router.py record_success）。 */
  async recordSuccess(modelId: string, latency: number): Promise<void> {
    const status = this.models.get(modelId) ?? createModelStatus(modelId);
    if (!this.models.has(modelId)) {
      this.models.set(modelId, status);
    }
    status.health = ModelHealth.HEALTHY;
    status.latencyP95 = latency;
    status.lastSuccess = Date.now() / 1000;
    status.consecutiveErrors = 0;
    status.totalCalls += 1;
    status.errorRate = Math.max(0, status.errorRate - 0.05);
  }

  /** 记录错误调用（router.py record_error）。 */
  async recordError(modelId: string, errorType = ''): Promise<void> {
    void errorType;
    const status = this.models.get(modelId) ?? createModelStatus(modelId);
    if (!this.models.has(modelId)) {
      this.models.set(modelId, status);
    }
    status.consecutiveErrors += 1;
    status.totalCalls += 1;
    status.totalErrors += 1;
    status.errorRate = Math.min(1.0, status.errorRate + 0.05);
    if (status.consecutiveErrors >= 3) {
      status.health = ModelHealth.UNAVAILABLE;
    } else if (status.errorRate >= 0.05) {
      // 1 次错误即降级（对齐 Python 阈值：0.05 步进 + 0.05 判定）
      status.health = ModelHealth.DEGRADED;
    }
  }

  /** 获取模型状态。 */
  getModelStatus(modelId: string): ModelStatus | undefined {
    return this.models.get(modelId);
  }

  /** 获取所有模型状态。 */
  getAllStatus(): Record<string, ModelStatus> {
    return Object.fromEntries(this.models);
  }

  /** 获取所有级联策略。 */
  getStrategies(): Record<string, CascadeStrategy> {
    return Object.fromEntries(this.cascadeStrategies);
  }

  /** 获取健康报告（router.py get_health_report）。 */
  getHealthReport(): {
    totalModels: number;
    healthy: number;
    degraded: number;
    unavailable: number;
    strategies: string[];
    models: Record<string, Record<string, unknown>>;
  } {
    let healthy = 0;
    let degraded = 0;
    let unavailable = 0;
    for (const s of this.models.values()) {
      if (s.health === ModelHealth.HEALTHY) {
        healthy += 1;
      } else if (s.health === ModelHealth.DEGRADED) {
        degraded += 1;
      } else {
        unavailable += 1;
      }
    }
    const models: Record<string, Record<string, unknown>> = {};
    for (const [mid, s] of this.models) {
      models[mid] = {
        health: s.health,
        error_rate: s.errorRate,
        consecutive_errors: s.consecutiveErrors,
        total_calls: s.totalCalls,
        total_errors: s.totalErrors,
      };
    }
    return {
      totalModels: this.models.size,
      healthy,
      degraded,
      unavailable,
      strategies: [...this.cascadeStrategies.keys()],
      models,
    };
  }
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
