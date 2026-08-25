/**
 * registry — 评估器配置注册中心 + Eval 域注册表。
 *
 * 对齐 Python `evaluators/registry.py`（ScoringRule/EvaluatorConfig/EvaluatorRegistry）
 * + clowder `infrastructure/harness-eval/domain/eval-domain-registry.ts`
 * （EvalDomainRegistryEntry：domainId/frequency/sourceAdapter/enabled/sla）。
 *
 * @module @flowforge/forgekin-harness-eval
 */

import {
  EVAL_DOMAINS_16,
  isEvalDomainId,
  type EvalDomainRegistryEntry,
} from './types.js';
import {
  MultiDimensionEvaluator,
  ScoringRuleEvaluator,
  type DimensionEvaluator,
  type ScoringRule,
} from './evaluator.js';

// ========== 评估器配置（对齐 registry.py EvaluatorConfig）==========

/** 评估器配置——从 YAML 字典或代码注册。 */
export interface EvaluatorConfig {
  /** 评估器名称 */
  readonly name: string;
  /** 描述 */
  readonly description?: string | undefined;
  /** 评估维度名称 */
  readonly dimension: string;
  /** 对应 EvaluatorAgent 类名 */
  readonly evaluator_agent?: string | undefined;
  /** 评分规则列表 */
  readonly scoring_rules?: readonly ScoringRule[] | undefined;
  /** 默认分 */
  readonly default_score?: number | undefined;
  /** 默认置信度 */
  readonly default_confidence?: number | undefined;
  /** 在 gate 中的权重 */
  readonly weight?: number | undefined;
  /** 通过阈值 */
  readonly threshold?: number | undefined;
  /** 附加元数据 */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

// ========== EvaluatorRegistry（对齐 registry.py）==========

/** 评估器配置注册中心——注册/查询/加载。 */
export class EvaluatorRegistry {
  private readonly configs = new Map<string, EvaluatorConfig>();
  private readonly instances = new Map<string, DimensionEvaluator>();

  /** 注册评估器（配置字典或实例均可）。 */
  register(name: string, evaluator: EvaluatorConfig | DimensionEvaluator): this {
    if (typeof (evaluator as DimensionEvaluator).evaluateDimension === 'function') {
      this.instances.set(name, evaluator as DimensionEvaluator);
    } else {
      const config = evaluator as EvaluatorConfig;
      this.configs.set(name, { ...config, name });
    }
    return this;
  }

  /** 获取评估器（实例优先，其次配置）。 */
  get(name: string): DimensionEvaluator | EvaluatorConfig | undefined {
    const instance = this.instances.get(name);
    if (instance) return instance;
    return this.configs.get(name);
  }

  /** 获取配置。 */
  getConfig(name: string): EvaluatorConfig | undefined {
    return this.configs.get(name);
  }

  /** 列出全部评估器名称。 */
  listEvaluators(): string[] {
    return [...new Set([...this.configs.keys(), ...this.instances.keys()])];
  }

  /** 配置数量。 */
  get size(): number {
    return this.listEvaluators().length;
  }

  /** 将配置物化为可执行评估器（缺省 ScoringRuleEvaluator）。 */
  materialize(name: string): DimensionEvaluator | undefined {
    const instance = this.instances.get(name);
    if (instance) return instance;
    const config = this.configs.get(name);
    if (!config) return undefined;
    return new ScoringRuleEvaluator(config.name, config.description ?? '');
  }
}

// ========== EvalDomainRegistry（对照 clowder C32 16 域）==========

/** Eval 域注册表——内置 16 域 + 自定义注册/退役。 */
export class EvalDomainRegistry {
  private readonly domains = new Map<string, EvalDomainRegistryEntry>();

  constructor(initial: readonly EvalDomainRegistryEntry[] = EVAL_DOMAINS_16) {
    for (const entry of initial) {
      this.register(entry);
    }
  }

  /** 注册一个域（同 domainId 覆盖）。 */
  register(entry: EvalDomainRegistryEntry): this {
    if (!isEvalDomainId(entry.domainId)) {
      throw new Error(`invalid domainId: ${entry.domainId} (must match eval:<lowercase-slug>)`);
    }
    this.domains.set(entry.domainId, entry);
    return this;
  }

  /** 按域 ID 查询。 */
  get(domainId: string): EvalDomainRegistryEntry | undefined {
    return this.domains.get(domainId);
  }

  /** 列出全部注册域。 */
  list(): EvalDomainRegistryEntry[] {
    return [...this.domains.values()];
  }

  /** 列出参与调度的启用域。 */
  listEnabled(): EvalDomainRegistryEntry[] {
    return this.list().filter((d) => d.enabled !== false);
  }

  /** 按频率过滤。 */
  listByFrequency(frequency: EvalDomainRegistryEntry['frequency']): EvalDomainRegistryEntry[] {
    return this.listEnabled().filter((d) => d.frequency === frequency);
  }

  /** 静默退役一个域（保留注册条目，仅停调度）。 */
  retire(domainId: string): boolean {
    const entry = this.domains.get(domainId);
    if (!entry) return false;
    this.domains.set(domainId, { ...entry, enabled: false });
    return true;
  }

  /** 重新启用一个域。 */
  reenable(domainId: string): boolean {
    const entry = this.domains.get(domainId);
    if (!entry) return false;
    this.domains.set(domainId, { ...entry, enabled: true });
    return true;
  }
}

/** 便捷：内置 16 域注册表实例。 */
export const DEFAULT_EVAL_DOMAIN_REGISTRY = new EvalDomainRegistry();

/** 便捷：多维度规则评估器——按维度配置注册规则（覆盖 feedback_loop 4 维）。 */
export function createRuleBasedEvaluator(
  dimensions: readonly string[],
): MultiDimensionEvaluator {
  const evaluator = new MultiDimensionEvaluator('rule_based', 'Rule-based per-dimension evaluator');
  for (const dimension of dimensions) {
    evaluator.register(
      dimension,
      new ScoringRuleEvaluator(`rule_${dimension}`, `Rule-based evaluator for ${dimension}`),
    );
  }
  return evaluator;
}
