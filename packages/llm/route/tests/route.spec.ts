/**
 * route.ts + config.ts 测试 — LLMRoute/FailoverPolicy/RouteResolver（llm/route.py）
 */
import { describe, expect, it } from 'vitest';
import {
  FailoverCondition,
  RouteResolver,
  defaultFailoverPolicy,
  failoverPolicyFromConfig,
  getProviderChain,
  llmRouteFromConfig,
} from '../src/route.js';
import {
  builtinLlmRouteYamlPath,
  extractRouteSections,
  loadLlmRouteConfig,
} from '../src/config.js';

class FakeProvider {
  healthy: boolean;
  constructor(healthy = true) {
    this.healthy = healthy;
  }
  isHealthy(): boolean {
    return this.healthy;
  }
}

function makeRoute() {
  return llmRouteFromConfig('default', {
    primary_provider: 'openroute',
    primary_model: 'Doubao-Seed2.0',
    fallback_providers: ['openroute', 'openrouter'],
    fallback_models: ['DeepSeek-V4-Pro', 'qwen/qwen3-coder:free'],
    failover_policy: {
      conditions: ['rate_limited', 'timeout'],
      timeout_seconds: 60,
      max_retries: 1,
      retry_delay_seconds: 0.5,
    },
    default_temperature: 0.7,
    default_max_tokens: 4096,
  });
}

describe('LLMRoute（llm/route.py）', () => {
  it('从配置构建路由：primary/fallback/failover 全部对齐', () => {
    const route = makeRoute();
    expect(route.routeName).toBe('default');
    expect(route.primaryProvider).toBe('openroute');
    expect(route.primaryModel).toBe('Doubao-Seed2.0');
    expect(route.fallbackProviders).toEqual(['openroute', 'openrouter']);
    expect(route.fallbackModels).toEqual(['DeepSeek-V4-Pro', 'qwen/qwen3-coder:free']);
    expect(route.failoverPolicy.conditions).toEqual([
      FailoverCondition.RATE_LIMITED,
      FailoverCondition.TIMEOUT,
    ]);
    expect(route.failoverPolicy.timeoutSeconds).toBe(60);
    expect(route.failoverPolicy.maxRetries).toBe(1);
    expect(route.failoverPolicy.retryDelaySeconds).toBe(0.5);
    expect(route.defaultTemperature).toBe(0.7);
    expect(route.defaultMaxTokens).toBe(4096);
  });

  it('getProviderChain 返回完整 Provider 链（provider, model）', () => {
    const chain = getProviderChain(makeRoute());
    expect(chain).toEqual([
      ['openroute', 'Doubao-Seed2.0'],
      ['openroute', 'DeepSeek-V4-Pro'],
      ['openrouter', 'qwen/qwen3-coder:free'],
    ]);
  });

  it('fallback 模型不足时补空串（对齐 Python 枚举逻辑）', () => {
    const route = llmRouteFromConfig('r', {
      primary_provider: 'a',
      primary_model: 'm1',
      fallback_providers: ['b', 'c'],
      fallback_models: ['m2'],
    });
    expect(getProviderChain(route)).toEqual([
      ['a', 'm1'],
      ['b', 'm2'],
      ['c', ''],
    ]);
  });

  it('failoverPolicyFromConfig 缺省值对齐 FailoverPolicy 默认', () => {
    const policy = failoverPolicyFromConfig({});
    expect(policy.conditions).toEqual(defaultFailoverPolicy().conditions);
    expect(policy.timeoutSeconds).toBe(30.0);
    expect(policy.maxRetries).toBe(2);
    expect(policy.retryDelaySeconds).toBe(1.0);
  });

  it('未知 failover 条件回退 ERROR（不抛错）', () => {
    const policy = failoverPolicyFromConfig({ conditions: ['unknown_cond'] });
    expect(policy.conditions).toEqual([FailoverCondition.ERROR]);
  });
});

describe('RouteResolver（llm/route.py）', () => {
  it('resolveProvider 返回第一个健康 Provider', () => {
    const resolver = new RouteResolver();
    resolver.registerProvider('openroute', new FakeProvider(true));
    resolver.registerProvider('openrouter', new FakeProvider(true));
    resolver.registerRoute(makeRoute());
    const provider = resolver.resolveProvider('default');
    expect(provider).toBeDefined();
    expect(provider!.isHealthy()).toBe(true);
  });

  it('resolveProvider 跳过不健康 Provider', () => {
    const healthy = new FakeProvider(true);
    const resolver = new RouteResolver();
    resolver.registerProvider('openroute', new FakeProvider(false));
    resolver.registerProvider('openrouter', healthy);
    resolver.registerRoute(makeRoute());
    expect(resolver.resolveProvider('default')).toBe(healthy);
  });

  it('resolveProvider 全部不可用时回退 primary', () => {
    const primary = new FakeProvider(false);
    const resolver = new RouteResolver();
    resolver.registerProvider('openroute', primary);
    resolver.registerRoute(makeRoute());
    expect(resolver.resolveProvider('default')).toBe(primary);
  });

  it('resolveProvider 未定义路由返回 undefined', () => {
    const resolver = new RouteResolver();
    expect(resolver.resolveProvider('missing')).toBeUndefined();
  });

  it('getRouteForAgent 精确匹配 > 项目前缀 > 默认路由', () => {
    const resolver = new RouteResolver();
    resolver.registerRoute(makeRoute());
    resolver.registerRoute(llmRouteFromConfig('creative', { primary_provider: 'p', primary_model: 'm' }));
    resolver.registerRoute(llmRouteFromConfig('contentforge', { primary_provider: 'p', primary_model: 'm' }));

    // 1. 精确匹配 agent 路由
    expect(resolver.getRouteForAgent('creative')?.routeName).toBe('creative');
    // 2. 项目前缀匹配
    expect(resolver.getRouteForAgent('contentforge:writer')?.routeName).toBe('contentforge');
    // 3. 默认路由
    expect(resolver.getRouteForAgent('unknown:agent')?.routeName).toBe('default');
  });

  it('loadRoutesFromConfig 加载多路由（对齐 llm_route.yaml 格式）', () => {
    const resolver = new RouteResolver();
    resolver.loadRoutesFromConfig({
      routes: {
        default: {
          primary_provider: 'openroute',
          primary_model: 'Doubao-Seed2.0',
          fallback_providers: ['openroute'],
          fallback_models: ['GLM-5.1'],
        },
        judge: {
          primary_provider: 'openroute',
          primary_model: 'Doubao-Seed2.0',
          failover_policy: {
            timeout_seconds: 300,
            max_retries: 0,
          },
        },
      },
    });
    expect(Object.keys(resolver.listRoutes()).sort()).toEqual(['default', 'judge']);
    expect(resolver.resolveRoute('judge')?.failoverPolicy.timeoutSeconds).toBe(300);
    expect(resolver.resolveRoute('judge')?.failoverPolicy.maxRetries).toBe(0);
  });

  it('listRoutes 返回注册表快照', () => {
    const resolver = new RouteResolver();
    resolver.registerRoute(makeRoute());
    const routes = resolver.listRoutes();
    expect(routes['default']).toBeDefined();
  });
});

describe('内置 config/llm-route.yaml（F28 配置驱动）', () => {
  it('内置 YAML 存在且可加载', () => {
    const config = loadLlmRouteConfig();
    expect(config['routes']).toBeDefined();
  });

  it('内置 YAML 含 5 条路由 + agent_routes 映射', () => {
    const config = loadLlmRouteConfig();
    const sections = extractRouteSections(config);
    const routeNames = Object.keys(sections.routes).sort();
    expect(routeNames).toEqual(['creative', 'default', 'judge', 'precise', 'reflector']);
    expect(sections.agentRoutes['multi_judge_']).toBe('judge');
    expect(sections.agentRoutes['contentforge:writer']).toBe('creative');
    expect(sections.failoverConditions['rate_limited']).toBeDefined();
  });

  it('内置 YAML 路径可定位（builtinLlmRouteYamlPath）', () => {
    expect(builtinLlmRouteYamlPath()).toContain('llm-route.yaml');
  });
});
