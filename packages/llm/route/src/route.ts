/**
 * @flowforge/llm-route — LLM Route 路由层（TS 重写自 `llm/route.py`，F28）
 *
 * Protocol/Route/Provider 三层分离的 Route 层：
 *   - LLMRoute 定义路由规则（primary provider + fallback providers + failover 条件）
 *   - FailoverPolicy 故障转移策略（条件/超时/重试）
 *   - RouteResolver 根据路由规则和 Provider 健康状态选择最优 Provider
 *
 * @module @flowforge/llm-route/route
 */

/** 故障转移触发条件（llm/route.py FailoverCondition）。 */
export enum FailoverCondition {
  RATE_LIMITED = 'rate_limited', // 429 限流
  TIMEOUT = 'timeout', // 超时 >30s
  MODERATION_REJECTED = 'moderation_rejected', // 内容审核拒绝
  ERROR = 'error', // 通用错误
  UNHEALTHY = 'unhealthy', // Provider 不健康
}

/** 故障转移策略（llm/route.py FailoverPolicy）。 */
export interface FailoverPolicy {
  readonly conditions: FailoverCondition[];
  readonly timeoutSeconds: number;
  readonly maxRetries: number;
  readonly retryDelaySeconds: number;
}

export function defaultFailoverPolicy(): FailoverPolicy {
  return {
    conditions: [
      FailoverCondition.RATE_LIMITED,
      FailoverCondition.TIMEOUT,
      FailoverCondition.MODERATION_REJECTED,
    ],
    timeoutSeconds: 30.0,
    maxRetries: 2,
    retryDelaySeconds: 1.0,
  };
}

/** 从配置段构建 FailoverPolicy（对齐 route.py load_routes_from_config）。 */
export function failoverPolicyFromConfig(
  data: Record<string, unknown>,
  defaults: FailoverPolicy = defaultFailoverPolicy(),
): FailoverPolicy {
  const rawConditions = asStringArray(data['conditions']);
  const conditions =
    rawConditions.length > 0
      ? rawConditions.map((c) => {
          const matched = Object.values(FailoverCondition).find((v) => v === c);
          return matched ?? FailoverCondition.ERROR;
        })
      : defaults.conditions;
  return {
    conditions,
    timeoutSeconds: asNumber(data['timeout_seconds'], defaults.timeoutSeconds),
    maxRetries: asNumber(data['max_retries'], defaults.maxRetries),
    retryDelaySeconds: asNumber(data['retry_delay_seconds'], defaults.retryDelaySeconds),
  };
}

/**
 * LLM 路由定义（llm/route.py LLMRoute）。
 *
 * 定义一条路由规则：primary provider + fallback providers + 故障转移策略。
 */
export interface LLMRoute {
  readonly routeName: string;
  /** provider name (e.g. "doubao") */
  readonly primaryProvider: string;
  /** specific model (e.g. "doubao-seed2") */
  readonly primaryModel: string;
  readonly fallbackProviders: string[];
  readonly fallbackModels: string[];
  readonly failoverPolicy: FailoverPolicy;
  readonly defaultTemperature: number;
  readonly defaultMaxTokens: number;
  readonly metadata: Record<string, unknown>;
}

/** 获取完整 Provider 链 [(provider_name, model), ...]（route.py get_provider_chain）。 */
export function getProviderChain(route: LLMRoute): Array<[string, string]> {
  const chain: Array<[string, string]> = [[route.primaryProvider, route.primaryModel]];
  for (let i = 0; i < route.fallbackProviders.length; i += 1) {
    const provider = route.fallbackProviders[i] ?? '';
    const model = i < route.fallbackModels.length ? (route.fallbackModels[i] ?? '') : '';
    chain.push([provider, model]);
  }
  return chain;
}

/** 从配置段构建 LLMRoute（route.py load_routes_from_config）。 */
export function llmRouteFromConfig(
  routeName: string,
  data: Record<string, unknown>,
): LLMRoute {
  const failoverData = isRecord(data['failover_policy']) ? data['failover_policy'] : {};
  return {
    routeName,
    primaryProvider: asString(data['primary_provider'], 'doubao'),
    primaryModel: asString(data['primary_model'], ''),
    fallbackProviders: asStringArray(data['fallback_providers']),
    fallbackModels: asStringArray(data['fallback_models']),
    failoverPolicy: failoverPolicyFromConfig(failoverData),
    defaultTemperature: asNumber(data['default_temperature'], 0.7),
    defaultMaxTokens: asNumber(data['default_max_tokens'], 4096),
    metadata: isRecord(data['metadata']) ? data['metadata'] : {},
  };
}

/** Provider 健康面（route.py 依赖 provider.is_healthy()）。 */
export interface ProviderHealthLike {
  isHealthy(): boolean;
}

/**
 * 路由解析器 — 根据路由规则和 Provider 健康状态选择最优 Provider（llm/route.py RouteResolver）。
 *
 * 核心逻辑：
 * 1. 查找路由定义
 * 2. 遍历 Provider 链
 * 3. 跳过不健康的 Provider
 * 4. 返回第一个可用的 Provider
 */
export class RouteResolver {
  private readonly providers: Map<string, ProviderHealthLike>;
  private readonly routes: Map<string, LLMRoute>;

  constructor(providers: Record<string, ProviderHealthLike> = {}) {
    this.providers = new Map(Object.entries(providers));
    this.routes = new Map();
  }

  /** 注册 Provider 实例。 */
  registerProvider(name: string, provider: ProviderHealthLike): void {
    this.providers.set(name, provider);
  }

  /** 注册路由定义。 */
  registerRoute(route: LLMRoute): void {
    this.routes.set(route.routeName, route);
  }

  /** 根据路由名解析到最优 Provider（route.py resolve_provider）。 */
  resolveProvider(routeName: string): ProviderHealthLike | undefined {
    const route = this.routes.get(routeName);
    if (!route) {
      return undefined;
    }
    for (const [providerName] of getProviderChain(route)) {
      const provider = this.providers.get(providerName);
      if (provider && provider.isHealthy()) {
        return provider;
      }
    }
    // 全部不可用，返回 primary（让调用方处理）
    return this.providers.get(route.primaryProvider);
  }

  /** 获取路由定义。 */
  resolveRoute(routeName: string): LLMRoute | undefined {
    return this.routes.get(routeName);
  }

  /**
   * 根据 Agent 名称查找匹配的路由（route.py get_route_for_agent）。
   *
   * 优先查找 agent 专属路由（如 "contentforge:writer"），
   * 回退到项目路由（如 "contentforge"），最终回退到 "default" 路由。
   */
  getRouteForAgent(agentName: string): LLMRoute | undefined {
    // 1. 精确匹配 agent 路由
    if (this.routes.has(agentName)) {
      return this.routes.get(agentName);
    }
    // 2. 项目前缀匹配
    if (agentName.includes(':')) {
      const project = agentName.split(':')[0] ?? '';
      if (this.routes.has(project)) {
        return this.routes.get(project);
      }
    }
    // 3. 默认路由
    return this.routes.get('default');
  }

  /** 列出所有路由。 */
  listRoutes(): Record<string, LLMRoute> {
    return Object.fromEntries(this.routes);
  }

  /**
   * 从配置加载路由定义（route.py load_routes_from_config）。
   *
   * 配置格式（llm_route.yaml）:
   *   routes: { default: { primary_provider, primary_model, fallback_providers,
   *            fallback_models, failover_policy: { conditions, timeout_seconds } } }
   *   agent_routes: { contentforge:writer: creative }
   */
  loadRoutesFromConfig(config: Record<string, unknown>): void {
    const routesData = isRecord(config['routes']) ? config['routes'] : {};
    for (const [name, routeData] of Object.entries(routesData)) {
      if (isRecord(routeData)) {
        this.registerRoute(llmRouteFromConfig(name, routeData));
      }
    }
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
