/**
 * service — LlmRouteService 插件挂载测试（ctx.forgeLlmRoute，F28 集成）。
 *
 * 验证：插件挂载 / 内置 llm-route.yaml / 六大组件组装 / 健康检查 / 配额 / 高层 API。
 *
 * @module @flowforge/llm-route/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  LlmRouteService,
  type LlmRouteServiceOptions,
} from '../src/index.js';
import type { LlmClientLike } from '../src/capability.js';
import type { HttpLike, HttpResponse } from '../src/http.js';
import { ModelCapabilityProvider } from '../src/provider.js';
import { HealthChecker } from '../src/model-service.js';
import { RouteResolver } from '../src/route.js';
import { LLMRouter } from '../src/router.js';
import { ProviderQuotaManager } from '../src/quota.js';

/** 可编程 HTTP mock（健康检查探测全部 200）。 */
class FakeHttp implements HttpLike {
  posts: Array<{ url: string }> = [];

  async post(_url: string): Promise<HttpResponse> {
    this.posts.push({ url: _url });
    return { status: 200, async json() { return {}; } };
  }

  async get(_url: string): Promise<HttpResponse> {
    return { status: 200, async json() { return {}; } };
  }
}

/** 最小 LLM 客户端（capability.chat 集成）。 */
class FakeLlmClient implements LlmClientLike {
  async execute(input: { params: Record<string, unknown> }): Promise<{ result: Record<string, unknown> }> {
    return { result: { content: 'ok', model: input.params['model'] ?? '' } };
  }

  async *stream(): AsyncIterable<string> {
    yield 'ok';
  }
}

const modelsConfig = {
  active_providers: ['openroute'],
  providers: {
    openroute: {
      base_url: 'http://127.0.0.1:13001/v1',
      api_key_default: 'test-key',
    },
  },
  models: [
    { id: 'Doubao-Seed2.0', provider: 'openroute', enabled: true },
    { id: 'DeepSeek-V4-Pro', provider: 'openroute', enabled: true },
    { id: 'GLM-5.1', provider: 'openroute', enabled: true },
  ],
  assignments: {
    default: { primary: 'Doubao-Seed2.0', fallbacks: ['DeepSeek-V4-Pro', 'GLM-5.1'] },
  },
};

function mount(options: LlmRouteServiceOptions = {}) {
  const ctx = new Context();
  Plugin(ctx, options);
  return { ctx, service: ctx.forgeLlmRoute };
}

describe('LlmRouteService 插件挂载（ctx.forgeLlmRoute）', () => {
  it('Plugin(ctx) 同步挂载 ctx.forgeLlmRoute', () => {
    const { ctx, service } = mount();
    expect(service).toBeInstanceOf(LlmRouteService);
    // Cordis 服务经 traceable 代理暴露：ctx 每次读取返回新包装，但底层服务同一实例
    expect(ctx.forgeLlmRoute.router).toBe(service.router);
    expect(ctx.forgeLlmRoute.modelService).toBe(service.modelService);
  });

  it('六大组件组装：resolver/router/selector/modelService/healthChecker/quota/capability', () => {
    const { service } = mount({ modelsConfig });
    expect(service.resolver).toBeInstanceOf(RouteResolver);
    expect(service.router).toBeInstanceOf(LLMRouter);
    expect(service.selector).toBeInstanceOf(ModelCapabilityProvider);
    expect(service.modelService).toBeDefined();
    expect(service.healthChecker).toBeInstanceOf(HealthChecker);
    expect(service.quota).toBeInstanceOf(ProviderQuotaManager);
    expect(service.capability).toBeDefined();
  });

  it('内置 llm-route.yaml 缺省加载 5 条路由', () => {
    const { service } = mount();
    expect(Object.keys(service.routes).sort()).toEqual([
      'creative',
      'default',
      'judge',
      'precise',
      'reflector',
    ]);
    expect(service.routes['judge']?.primaryModel).toBe('Doubao-Seed2.0');
    expect(service.routes['creative']?.defaultTemperature).toBe(0.9);
  });

  it('getRouteForAgent 精确/默认路由匹配', () => {
    const { service } = mount();
    expect(service.resolver.getRouteForAgent('judge')?.routeName).toBe('judge');
    expect(service.resolver.getRouteForAgent('unknown-agent')?.routeName).toBe('default');
  });

  it('自定义 routeConfig 覆盖内置 YAML（项目前缀匹配）', () => {
    const { service } = mount({
      routeConfig: {
        routes: {
          contentforge: {
            primary_provider: 'openroute',
            primary_model: 'GLM-5.1',
            fallback_providers: ['openroute'],
            fallback_models: ['Doubao-Seed2.0'],
          },
        },
      },
    });
    expect(Object.keys(service.routes)).toEqual(['contentforge']);
    expect(service.resolver.getRouteForAgent('contentforge:writer')?.routeName).toBe(
      'contentforge',
    );
  });

  it('modelsConfig 注入 → router 级联策略 + selector 模型发现 + modelService 加载', () => {
    const { service } = mount({ modelsConfig });
    expect(Object.keys(service.router.getAllStatus())).toHaveLength(3);
    expect(service.router.route('default')).toBe('Doubao-Seed2.0');
    expect(service.selector).toBeInstanceOf(ModelCapabilityProvider);
    const provider = service.selector as ModelCapabilityProvider;
    expect(provider.listModels().map((m) => m.name).sort()).toEqual([
      'DeepSeek-V4-Pro',
      'Doubao-Seed2.0',
      'GLM-5.1',
    ]);
    expect(service.modelService.models).toHaveLength(3);
    expect(service.modelService.assignments['default']?.['fallbacks']).toEqual([
      'DeepSeek-V4-Pro',
      'GLM-5.1',
    ]);
  });

  it('resolveSecret 注入：openrouter api_key_env 解析', () => {
    const { service } = mount({
      modelsConfig: {
        active_providers: ['openrouter'],
        providers: {
          openrouter: { base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY' },
        },
        models: [{ id: 'qwen/qwen3-coder:free', provider: 'openrouter', enabled: true }],
        assignments: { default: { primary: 'qwen/qwen3-coder:free', fallbacks: [] } },
      },
      resolveSecret: (name) => (name === 'OPENROUTER_API_KEY' ? 'secret-key' : undefined),
    });
    expect(service.modelService.getApiKey('openrouter')).toBe('secret-key');
  });

  it('runHealthCheck 手动触发全量检查（HTTP 200 → 全部可用）', async () => {
    const http = new FakeHttp();
    const { service } = mount({ modelsConfig, http });
    const report = await service.runHealthCheck();
    expect(report['checked']).toBeGreaterThanOrEqual(3);
    expect(report['unhealthy']).toBe(0);
    expect(report['failovers']).toEqual([]);
    expect(http.posts.length).toBeGreaterThanOrEqual(3);
  });

  it('startHealthChecker 幂等 + stopHealthChecker 停止', async () => {
    const http = new FakeHttp();
    const { service } = mount({ modelsConfig, http });
    await service.startHealthChecker();
    await service.startHealthChecker(); // 幂等
    await service.stopHealthChecker();
    await service.stopHealthChecker(); // 幂等
    expect(service.healthChecker.lastReport).toBeDefined();
  });

  it('quotaConfigs 注入：未配置放行 / 超限拒绝', async () => {
    const { service } = mount({ modelsConfig });
    expect((await service.quota.checkQuota('openroute')).allowed).toBe(true);

    const limited = mount({
      modelsConfig,
      quotaConfigs: {
        openroute: {
          provider: 'openroute',
          enabled: true,
          dailyTokenLimit: 100,
          dailyRequestLimit: 0,
          rpmLimit: 0,
          tpmLimit: 0,
          concurrentLimit: 0,
          backupModels: [],
          cooldownSeconds: 60,
          metadata: {},
        },
      },
    });
    await limited.service.quota.recordUsage('openroute', 80, true);
    const denied = await limited.service.quota.checkQuota('openroute', 50);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('daily_token_limit exceeded');
  });

  it('llmClient 注入 → capability.chat 端到端可用', async () => {
    const { service } = mount({
      modelsConfig,
      llmClient: new FakeLlmClient(),
    });
    const result = await service.capability.chat({
      prompt: 'hi',
      model: 'Doubao-Seed2.0',
    });
    expect(result['content']).toBe('ok');
  });

  it('onConfigChange 回调：addModel 变更通知（对齐 _save_config）', () => {
    const changed: Array<Record<string, unknown>> = [];
    const { service } = mount({
      modelsConfig,
      onConfigChange: (config) => changed.push(config as unknown as Record<string, unknown>),
    });
    service.modelService.addModel('Kimi-K2.6', 'openroute');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.['models']).toHaveLength(4);
  });

  it('不注入 modelsConfig 也可挂载（空配置安全降级）', async () => {
    const { service } = mount();
    expect(service.modelService.models).toHaveLength(0);
    expect(Object.keys(service.router.getAllStatus())).toHaveLength(0);
    expect(await service.quota.checkQuota('any')).toMatchObject({ allowed: true });
  });
});
