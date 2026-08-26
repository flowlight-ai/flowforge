/**
 * @flowforge/llm-route — F28 LLM 路由/模型服务/提供商配额 Cordis 插件。
 *
 * 挂载 `ctx.forgeLlmRoute`，统一提供 LLM 路由域能力（TS 重写自 Python）：
 *   - route: LLMRoute/FailoverPolicy/RouteResolver（llm/route.py + config/llm_route.yaml）
 *   - router: LLMRouter 健康感知级联路由（llm/router.py）
 *   - selector: ModelCapabilityProvider 能力路由/健康追踪
 *     （tools/llm/model_capability_provider.py）
 *   - modelService: ModelService 健康检查/failover（tools/llm/model_service.py）
 *   - healthChecker: HealthChecker 周期健康检查（core/model_service.py）
 *   - quota: ProviderQuotaManager 六维配额 + backup 切换（core/provider_quota.py）
 *   - capability: ModelCapability 零配置高层 API（core/model_capability.py）
 *
 * 依赖（LLMClient / ModelService / HTTP / SecretStore）均通过接口注入，
 * 与 Python 版 duck typing 对应。内置 llm-route.yaml 随包发布。
 */

import { Context, Service } from '@flowforge/cordis';
import { loadLlmRouteConfig } from './config.js';
import {
  ModelCapability,
  type LlmClientLike,
  type ModelSelectorLike,
} from './capability.js';
import type { HttpLike } from './http.js';
import {
  HealthChecker,
  ModelService,
  type ModelServiceOptions,
} from './model-service.js';
import { ModelCapabilityProvider } from './provider.js';
import {
  ProviderQuotaManager,
  type ProviderQuotaConfig,
} from './quota.js';
import { RouteResolver, type LLMRoute } from './route.js';
import { LLMRouter } from './router.js';

export * from './config.js';
export * from './route.js';
export * from './router.js';
// provider.js 的 ModelHealth 与 router.js 同值，避免重复导出冲突
// （包根 ModelHealth 统一由 router.js 提供）
export { ModelCapabilityProvider, createModelInfo, type ModelInfo } from './provider.js';
export * from './model-service.js';
export * from './quota.js';
export * from './capability.js';
export * from './http.js';

/** LlmRouteService 配置（一切外部依赖经 options 注入）。 */
export interface LlmRouteServiceOptions {
  /** models.yaml 配置（providers/models/assignments/active_providers）。 */
  readonly modelsConfig?: ModelServiceOptions['config'];
  /** 路由配置（缺省从内置 config/llm-route.yaml 加载）。 */
  readonly routeConfig?: Record<string, unknown>;
  /** provider 配额配置（provider → ProviderQuotaConfig）。 */
  readonly quotaConfigs?: Record<string, ProviderQuotaConfig>;
  /** LLM 客户端（ModelCapability.chat/chat_stream/chat_json）。 */
  readonly llmClient?: LlmClientLike;
  /** 模型服务（缺省内部创建 ModelService）。 */
  readonly modelService?: ModelService;
  /** HTTP 客户端（健康检查探测，缺省 FetchHttpClient）。 */
  readonly http?: HttpLike;
  /** 密钥解析（缺省环境变量）。 */
  readonly resolveSecret?: (name: string) => string | undefined;
  /** 配置写回回调（models.yaml 变更通知，缺省 no-op）。 */
  readonly onConfigChange?: (config: ModelServiceOptions['config']) => void;
  /** 健康状态文件路径（缺省 <包>/data/model_health_state.json）。 */
  readonly healthStateFile?: string;
  /** 模型选择器（缺省 ModelCapabilityProvider）。 */
  readonly selector?: ModelSelectorLike;
  /** 是否启动周期健康检查（缺省 false，由宿主显式 start）。 */
  readonly healthCheckIntervalSeconds?: number;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** LLM 路由域：路由解析 / 模型服务 / 能力路由 / 配额治理 */
    forgeLlmRoute: LlmRouteService;
  }
}

/**
 * LLM 路由域服务 — F28 统一入口。
 *
 * 组装 6 个路由模块：RouteResolver（llm_route.yaml 路由）+ LLMRouter
 * （assignments 级联）+ ModelService（健康检查/failover）+ HealthChecker
 * （周期巡检）+ ModelCapabilityProvider（能力路由）+ ProviderQuotaManager
 * （配额治理）+ ModelCapability（零配置高层 API）。
 */
export class LlmRouteService extends Service {
  /** 路由解析器（llm/route.py RouteResolver）。 */
  readonly resolver: RouteResolver;
  /** 健康感知级联路由器（llm/router.py LLMRouter）。 */
  readonly router: LLMRouter;
  /** 能力路由选择器（model_capability_provider.py ModelCapabilityProvider）。 */
  readonly selector: ModelSelectorLike;
  /** 模型服务（tools/llm/model_service.py ModelService）。 */
  readonly modelService: ModelService;
  /** 周期健康检查器（core/model_service.py HealthChecker）。 */
  readonly healthChecker: HealthChecker;
  /** 配额治理管理器（core/provider_quota.py ProviderQuotaManager）。 */
  readonly quota: ProviderQuotaManager;
  /** 零配置高层 API（core/model_capability.py ModelCapability）。 */
  readonly capability: ModelCapability;
  /** 已注册路由（快照）。 */
  readonly routes: Record<string, LLMRoute>;

  constructor(ctx: Context, options: LlmRouteServiceOptions = {}) {
    super(ctx, 'forgeLlmRoute');

    // 1. 路由配置（内置 llm-route.yaml 缺省）
    const routeConfig = options.routeConfig ?? loadLlmRouteConfig();

    // 2. RouteResolver：从配置加载路由定义
    this.resolver = new RouteResolver();
    this.resolver.loadRoutesFromConfig(routeConfig);
    this.routes = this.resolver.listRoutes();

    // 3. LLMRouter：从 models 配置加载 assignments 级联策略
    this.router = new LLMRouter();
    this.router.applyConfig(
      (options.modelsConfig ?? {}) as unknown as Record<string, unknown>,
    );

    // 4. ModelCapabilityProvider：从 models 配置自动发现模型
    this.selector =
      options.selector ??
      new ModelCapabilityProvider(
        (options.modelsConfig ?? {}) as unknown as Record<string, unknown>,
      );

    // 5. ModelService：健康检查 + failover（依赖经 options 注入）
    this.modelService =
      options.modelService ??
      new ModelService({
        ...(options.modelsConfig !== undefined ? { config: options.modelsConfig } : {}),
        ...(options.http !== undefined ? { http: options.http } : {}),
        ...(options.resolveSecret !== undefined
          ? { resolveSecret: options.resolveSecret }
          : {}),
        ...(options.onConfigChange !== undefined
          ? { onConfigChange: options.onConfigChange }
          : {}),
        ...(options.healthStateFile !== undefined
          ? { healthStateFile: options.healthStateFile }
          : {}),
      });

    // 6. HealthChecker：周期健康检查（缺省不自动启动）
    this.healthChecker = new HealthChecker(
      this.modelService,
      options.healthCheckIntervalSeconds ?? 300,
    );

    // 7. ProviderQuotaManager：配额治理
    this.quota = new ProviderQuotaManager(options.quotaConfigs ?? {});

    // 8. ModelCapability：零配置高层 API
    this.capability = new ModelCapability({
      ...(options.llmClient !== undefined ? { llmClient: options.llmClient } : {}),
      modelService: this.modelService,
      selector: this.selector,
    });
  }

  /** 启动周期健康检查（幂等）。 */
  async startHealthChecker(): Promise<void> {
    await this.healthChecker.start();
  }

  /** 停止周期健康检查。 */
  async stopHealthChecker(): Promise<void> {
    await this.healthChecker.stop();
  }

  /** 手动触发一轮健康检查 + 自动 failover（返回检查报告）。 */
  async runHealthCheck(): Promise<Record<string, unknown>> {
    return this.healthChecker.checkAndFailover();
  }
}

export default function Plugin(
  ctx: Context,
  options: LlmRouteServiceOptions = {},
): void {
  ctx.forgeLlmRoute = new LlmRouteService(ctx, options);
}
