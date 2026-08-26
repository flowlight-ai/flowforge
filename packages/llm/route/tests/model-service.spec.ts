/**
 * model-service.ts 测试 — ModelService 健康检查/错误分类/failover
 * （tools/llm/model_service.py）+ HealthChecker 周期巡检（core/model_service.py）
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpLike, HttpResponse } from '../src/http.js';
import {
  HealthChecker,
  ModelService,
  STATUS_AVAILABLE,
  STATUS_SUSPENDED,
  STATUS_UNKNOWN,
} from '../src/model-service.js';

/** 可编程 HTTP mock（对齐 httpx 语义；postHandler 可按请求体 json.model 区分模型）。 */
class FakeHttp implements HttpLike {
  posts: Array<{ url: string; json: unknown; headers?: Record<string, string> }> = [];
  gets: Array<{ url: string }> = [];
  postHandler:
    | ((url: string, options?: { json?: unknown }) => { status: number })
    | undefined;
  getHandler: ((url: string) => { status: number }) | undefined;
  postError: Error | undefined;

  async post(
    url: string,
    options: { json?: unknown; headers?: Record<string, string> },
  ): Promise<HttpResponse> {
    this.posts.push({
      url,
      json: options.json,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
    });
    if (this.postError) {
      throw this.postError;
    }
    const handled = this.postHandler ? this.postHandler(url, options) : { status: 200 };
    return { status: handled.status, async json() { return {}; } };
  }

  async get(url: string): Promise<HttpResponse> {
    this.gets.push({ url });
    const handled = this.getHandler ? this.getHandler(url) : { status: 200 };
    return { status: handled.status, async json() { return {}; } };
  }
}

const modelsConfig = {
  active_providers: ['openroute', 'openrouter'],
  providers: {
    openroute: {
      base_url: 'http://127.0.0.1:13001/v1',
      api_key_default: 'test-key',
    },
    openrouter: {
      base_url: 'https://openrouter.ai/api/v1',
      api_key_env: 'OPENROUTER_API_KEY',
    },
  },
  models: [
    { id: 'Doubao-Seed2.0', provider: 'openroute', enabled: true },
    { id: 'DeepSeek-V4-Pro', provider: 'openroute', enabled: true },
    { id: 'qwen/qwen3-coder:free', provider: 'openrouter', enabled: true },
  ],
  assignments: {
    default: { primary: 'Doubao-Seed2.0', fallbacks: ['DeepSeek-V4-Pro'] },
  },
};

/** 每个测试独立健康状态文件（避免共享 data/model_health_state.json 污染）。 */
let healthFileSeq = 0;
function uniqueHealthFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-llm-route-'));
  healthFileSeq += 1;
  return join(dir, `health-${healthFileSeq}.json`);
}

function makeService(http: FakeHttp = new FakeHttp(), extra: Record<string, unknown> = {}) {
  return new ModelService({
    // 深拷贝配置：models/assignments 为引用传递，避免测试间互相污染
    config: structuredClone(modelsConfig),
    http,
    healthStateFile: uniqueHealthFile(),
    ...(extra['nowSec'] !== undefined ? { nowSec: extra['nowSec'] as () => number } : {}),
    ...(extra['openRouteHealth'] !== undefined
      ? { openRouteHealth: extra['openRouteHealth'] as never }
      : {}),
    resolveSecret: (name) => (name === 'OPENROUTER_API_KEY' ? 'secret-key' : undefined),
  });
}

describe('ModelService（tools/llm/model_service.py）', () => {
  it('构造时从配置加载 providers/models/assignments', () => {
    const service = makeService();
    expect(service.providers['openroute']).toBeDefined();
    expect(service.models).toHaveLength(3);
    expect(service.assignments['default']).toEqual({
      primary: 'Doubao-Seed2.0',
      fallbacks: ['DeepSeek-V4-Pro'],
    });
    expect(service.activeProviders).toEqual(['openroute', 'openrouter']);
  });

  it('restoreAlwaysAvailableModels 恢复 openrouter/:free 为 available', () => {
    const service = makeService();
    // openrouter/:free 模型应被标记为永远可用
    const data = service.getHealthData();
    expect(data['openrouter/qwen/qwen3-coder:free']?.status).toBe(STATUS_AVAILABLE);
    expect(data['openrouter/qwen/qwen3-coder:free']?.reason).toContain('always available');
  });

  it('健康检查 200 → available，并记录延迟', async () => {
    const http = new FakeHttp();
    const service = makeService(http);
    const result = await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    expect(result.status).toBe(STATUS_AVAILABLE);
    expect(result.cached).toBe(false);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(http.posts[0]?.url).toContain('/chat/completions');
    expect(http.posts[0]?.json).toMatchObject({ max_tokens: 10 });
    expect(http.posts[0]?.headers?.['Authorization']).toBe('Bearer test-key');
  });

  it('available 缓存 24h 内不重新检查（cached=true）', async () => {
    let now = 1_000_000;
    const service = makeService(new FakeHttp(), { nowSec: () => now });
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    now = 1_000_000 + 3600; // 1 小时后
    const cached = await service.healthCheckSingle('openroute/Doubao-Seed2.0', false);
    expect(cached.cached).toBe(true);
    expect(cached.status).toBe(STATUS_AVAILABLE);
  });

  it('available 缓存超过 24h 后重新检查', async () => {
    let now = 1_000_000;
    const http = new FakeHttp();
    const service = makeService(http, { nowSec: () => now });
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    expect(http.posts).toHaveLength(1);
    now = 1_000_000 + 90000; // 25 小时后
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', false);
    expect(http.posts).toHaveLength(2); // 重新探测
  });

  it('非 200 响应 → SUSPENDED（可恢复）且 reason 含错误类型', async () => {
    const http = new FakeHttp();
    http.postHandler = () => ({ status: 429 }); // rate_limit
    const service = makeService(http);
    const result = await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    expect(result.status).toBe(STATUS_SUSPENDED);
    expect(result.reason).toContain('rate_limit');
  });

  it('SUSPENDED 冷却期内返回缓存', async () => {
    let now = 1_000_000;
    const http = new FakeHttp();
    http.postHandler = () => ({ status: 500 }); // server_error 15s
    const service = makeService(http, { nowSec: () => now });
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    now += 10; // 10s < 15s 冷却
    const cached = await service.healthCheckSingle('openroute/Doubao-Seed2.0', false);
    expect(cached.cached).toBe(true);
    expect(cached.status).toBe(STATUS_SUSPENDED);
  });

  it('SUSPENDED 冷却结束后重新检查可恢复', async () => {
    let now = 1_000_000;
    let fail = true;
    const http = new FakeHttp();
    http.postHandler = () => (fail ? { status: 500 } : { status: 200 });
    const service = makeService(http, { nowSec: () => now });
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    expect(service.getHealthData()['openroute/Doubao-Seed2.0']?.status).toBe(STATUS_SUSPENDED);
    now += 100; // 冷却结束
    fail = false;
    const result = await service.healthCheckSingle('openroute/Doubao-Seed2.0', false);
    expect(result.status).toBe(STATUS_AVAILABLE);
  });

  it('classifyError 按状态码分类（401/403/404/429/5xx）', () => {
    const service = makeService();
    expect(service.classifyError(null, 401)[0]).toBe('no_permission');
    expect(service.classifyError(null, 403)[0]).toBe('no_permission');
    expect(service.classifyError(null, 404)[0]).toBe('model_not_found');
    expect(service.classifyError(null, 429)[0]).toBe('rate_limit');
    expect(service.classifyError(null, 503)[0]).toBe('server_error');
    expect(service.classifyError(null, 400)[0]).toBe('unknown');
  });

  it('classifyError 按异常消息分类（timeout/rate limit）', () => {
    const service = makeService();
    expect(service.classifyError(new Error('request timed out'))[0]).toBe('timeout');
    expect(service.classifyError(new Error('rate limit exceeded'))[0]).toBe('rate_limit');
    expect(service.classifyError(new Error('balance too low'))[0]).toBe('no_quota');
  });

  it('HTTP 异常 → SUSPENDED 并累计 error_count', async () => {
    const http = new FakeHttp();
    http.postError = new Error('timeout');
    const service = makeService(http);
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    const data = service.getHealthData()['openroute/Doubao-Seed2.0'];
    expect(data?.status).toBe(STATUS_SUSPENDED);
    expect(data?.reason).toContain('timeout');
    expect(data?.error_count).toBe(1);
  });

  it('healthCheckAll 覆盖 active providers 的 models + assignments', async () => {
    const http = new FakeHttp();
    const service = makeService(http);
    const results = await service.healthCheckAll(true);
    // openroute 2 模型 + openrouter 1 模型 + assignment primary（已在 models 中）
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const r of results) {
      expect(r.status).toBe(STATUS_AVAILABLE);
    }
  });

  it('getModels 合并健康状态（health_status/latency_ms）', async () => {
    const service = makeService();
    const models = service.getModels();
    expect(models).toHaveLength(3);
    expect(models[0]?.['health_status']).toBeDefined();
  });

  it('getModelChain 与 getAvailableFallbackChain', async () => {
    const service = makeService();
    const chain = service.getModelChain('default');
    expect(chain).toEqual([
      'openroute/Doubao-Seed2.0',
      'openroute/DeepSeek-V4-Pro',
    ]);
    // 未检查过的模型状态 UNKNOWN → 视为可用
    expect(service.getAvailableFallbackChain('default')).toEqual(chain);
  });

  it('recordCallFailure 3 次连续失败 → suspended 且保留 fallback（P0-28）', async () => {
    const service = makeService();
    const first = service.recordCallFailure('openroute/Doubao-Seed2.0', 'err1');
    expect(first.consecutive_failures).toBe(1);
    const second = service.recordCallFailure('openroute/Doubao-Seed2.0', 'err2');
    expect(second.consecutive_failures).toBe(2);
    const third = service.recordCallFailure('openroute/Doubao-Seed2.0', 'err3');
    expect(third.consecutive_failures).toBe(3);
    const data = service.getHealthData()['openroute/Doubao-Seed2.0'];
    expect(data?.status).toBe(STATUS_SUSPENDED);
    expect(data?.reason).toBe('consecutive 3 failures');
    // P0-28：fallback 列表不被移除
    expect(service.assignments['default']?.['fallbacks']).toEqual(['DeepSeek-V4-Pro']);
  });

  it('recordCallSuccess 恢复 available 并清空失败计数', async () => {
    const service = makeService();
    service.recordCallFailure('openroute/Doubao-Seed2.0', 'e');
    service.recordCallFailure('openroute/Doubao-Seed2.0', 'e');
    service.recordCallFailure('openroute/Doubao-Seed2.0', 'e');
    const success = service.recordCallSuccess('openroute/Doubao-Seed2.0');
    expect(success.consecutive_failures_reset).toBe(true);
    const data = service.getHealthData()['openroute/Doubao-Seed2.0'];
    expect(data?.status).toBe(STATUS_AVAILABLE);
    expect(data?.consecutive_failures).toBe(0);
  });

  it('forceUpdateModels 分组并发检查并统计', async () => {
    const http = new FakeHttp();
    const service = makeService(http);
    const report = await service.forceUpdateModels();
    expect(report.checked_models).toBe(3);
    expect(report.available_count).toBe(3);
    expect(report.suspended_count).toBe(0);
    expect(report.fallback_chains_rebuilt).toBe(0);
  });

  it('forceUpdateModels 过滤不健康 fallback 并重建（仅内存）', async () => {
    const http = new FakeHttp();
    http.postHandler = (_url, options) => {
      const model = (options?.json as { model?: string } | undefined)?.model ?? '';
      return model === 'DeepSeek-V4-Pro' ? { status: 500 } : { status: 200 };
    };
    const service = makeService(http);
    const report = await service.forceUpdateModels();
    expect(report.suspended_count).toBe(1);
    expect(report.available_count).toBe(2);
    // 内存重建：不健康 fallback 被移除，健康模型补充（排除 primary 与原 fallback）
    expect(service.assignments['default']?.['fallbacks']).toEqual(['qwen/qwen3-coder:free']);
  });

  it('autoFix 替换不健康 primary 为健康 fallback', async () => {
    const http = new FakeHttp();
    http.postHandler = (_url, options) => {
      const model = (options?.json as { model?: string } | undefined)?.model ?? '';
      return model === 'Doubao-Seed2.0' ? { status: 500 } : { status: 200 };
    };
    const service = makeService(http);
    const report = await service.autoFix('default');
    expect(report.fixes).toHaveLength(1);
    expect(report.fixes[0]).toMatchObject({
      original_model: 'Doubao-Seed2.0',
      replacement_model: 'DeepSeek-V4-Pro',
    });
    expect(report.summary).toContain('Fixed 1');
  });

  it('autoFix 全部健康时无修复', async () => {
    const service = makeService();
    const report = await service.autoFix('default');
    expect(report.fixes).toHaveLength(0);
    expect(report.summary).toBe('All models healthy, no fixes needed');
  });

  it('autoFix 未知 assignment 返回 not found', async () => {
    const service = makeService();
    const report = await service.autoFix('missing');
    expect(report.summary).toBe("Assignment 'missing' not found");
  });

  it('addModel/updateModel/removeModel 校验并触发 onConfigChange', async () => {
    const saved: unknown[] = [];
    const service = new ModelService({
      config: structuredClone(modelsConfig),
      http: new FakeHttp(),
      healthStateFile: uniqueHealthFile(),
      onConfigChange: (cfg) => saved.push(cfg),
    });
    const added = service.addModel('new-model', 'openroute');
    expect(added['id']).toBe('new-model');
    expect(service.models).toHaveLength(4);
    expect(() => service.addModel('new-model', 'openroute')).toThrow('already exists');
    expect(() => service.addModel('x', 'no-provider')).toThrow('not found');
    expect(saved).toHaveLength(1);

    const updated = service.updateModel('new-model', { enabled: false });
    expect(updated['enabled']).toBe(false);

    const removed = service.removeModel('new-model');
    expect(removed['deleted']).toBe('openroute/new-model');
    expect(() => service.removeModel('new-model')).toThrow('not found');
  });

  it('updateAssignment 写回并触发 onConfigChange', () => {
    const saved: unknown[] = [];
    const service = new ModelService({
      config: structuredClone(modelsConfig),
      http: new FakeHttp(),
      healthStateFile: uniqueHealthFile(),
      onConfigChange: (cfg) => saved.push(cfg),
    });
    service.updateAssignment('judge', 'Kimi-K2.6', ['GLM-5.1']);
    expect(service.assignments['judge']).toEqual({
      primary: 'Kimi-K2.6',
      fallbacks: ['GLM-5.1'],
    });
    expect(saved).toHaveLength(1);
  });

  it('getHealthReport/getHealthSummary 汇总统计', async () => {
    const service = makeService();
    await service.healthCheckSingle('openroute/Doubao-Seed2.0', true);
    const report = service.getHealthReport();
    expect(report.models.length).toBeGreaterThanOrEqual(1);
    expect(report.summary['total']).toBeGreaterThanOrEqual(2); // 1 检查 + 1 兜底恢复
    expect(report.summary['available']).toBeGreaterThanOrEqual(2);
  });

  it('cleanupHealthState 清理 30 天前未检查的 available 记录', () => {
    let now = 1_000_000;
    const service = makeService(new FakeHttp(), { nowSec: () => now });
    service.recordCallSuccess('openroute/Doubao-Seed2.0');
    now += 31 * 86400;
    service.cleanupHealthState(30);
    expect(service.getHealthData()['openroute/Doubao-Seed2.0']).toBeUndefined();
  });

  it('base_url 缺失 → SUSPENDED（可恢复）', async () => {
    const service = new ModelService({
      config: {
        providers: { custom: { api_key_default: 'k' } },
        models: [{ id: 'm', provider: 'custom' }],
        assignments: {},
        active_providers: ['custom'],
      },
      http: new FakeHttp(),
      healthStateFile: uniqueHealthFile(),
    });
    const result = await service.healthCheckSingle('custom/m', true);
    expect(result.status).toBe(STATUS_SUSPENDED);
    expect(result.reason).toBe('missing base_url');
  });

  it('invalid model_key 格式 → UNKNOWN', async () => {
    const service = makeService();
    const result = await service.healthCheckSingle('no-slash', true);
    expect(result.status).toBe(STATUS_UNKNOWN);
    expect(result.reason).toBe('invalid model_key format');
  });
});

describe('openroute 健康检查（_check_openroute_health）', () => {
  it('openRouteHealth 回调健康 → 探测模型可用', async () => {
    const http = new FakeHttp();
    const service = makeService(http, {
      openRouteHealth: {
        async healthCheck() {
          return { state: { name: 'RUNNING' } };
        },
      },
    });
    const result = await service.checkOpenrouteHealth('openroute/Doubao-Seed2.0', 'Doubao-Seed2.0');
    expect(result.status).toBe(STATUS_AVAILABLE);
    // 回调健康时不走 HTTP /health 探测
    expect(http.gets).toHaveLength(0);
    expect(http.posts).toHaveLength(1);
  });

  it('openRouteHealth 回调 STOPPED → SUSPENDED（proxy_service_not_running）', async () => {
    const http = new FakeHttp();
    const service = makeService(http, {
      openRouteHealth: {
        async healthCheck() {
          return { state: { name: 'STOPPED' } };
        },
      },
    });
    const result = await service.checkOpenrouteHealth('openroute/Doubao-Seed2.0', 'Doubao-Seed2.0');
    expect(result.status).toBe(STATUS_SUSPENDED);
    expect(result.reason).toBe('proxy_service_not_running');
  });

  it('无回调时 HTTP 探测 /health（失败 3 次 → SUSPENDED）', async () => {
    const http = new FakeHttp();
    http.getHandler = () => ({ status: 500 });
    const service = makeService(http);
    const result = await service.checkOpenrouteHealth('openroute/Doubao-Seed2.0', 'Doubao-Seed2.0');
    expect(result.status).toBe(STATUS_SUSPENDED);
    expect(result.reason).toBe('proxy_service_not_running');
    expect(http.gets).toHaveLength(3); // 3 次重试
  });

  it('HTTP 探测 /health 成功但模型 ping 失败 → SUSPENDED', async () => {
    const http = new FakeHttp();
    http.getHandler = () => ({ status: 200 });
    http.postHandler = () => ({ status: 404 });
    const service = makeService(http);
    const result = await service.checkOpenrouteHealth('openroute/Doubao-Seed2.0', 'Doubao-Seed2.0');
    expect(result.status).toBe(STATUS_SUSPENDED);
    expect(result.reason).toContain('model_not_found');
  });
});

describe('HealthChecker（core/model_service.py）', () => {
  it('findAffectedAssignments 扁平与嵌套结构均可识别', async () => {
    const service = makeService();
    const checker = new HealthChecker(service);
    const flat = checker.findAffectedAssignments('openroute/Doubao-Seed2.0');
    expect(flat).toContainEqual(['default', null]);
    // 嵌套结构
    const nested = new ModelService({
      config: structuredClone({
        ...modelsConfig,
        assignments: {
          writer: { persona: { primary: 'Doubao-Seed2.0', fallbacks: [] } },
        },
      }),
      http: new FakeHttp(),
    });
    const checker2 = new HealthChecker(nested);
    expect(checker2.findAffectedAssignments('openroute/Doubao-Seed2.0')).toContainEqual([
      'writer',
      'persona',
    ]);
  });

  it('checkAndFailover 发现不健康 primary 并 failover 到 fallback', async () => {
    const http = new FakeHttp();
    http.postHandler = (_url, options) => {
      const model = (options?.json as { model?: string } | undefined)?.model ?? '';
      return model === 'Doubao-Seed2.0' ? { status: 500 } : { status: 200 };
    };
    const service = makeService(http);
    const checker = new HealthChecker(service);
    const report = await checker.checkAndFailover();
    expect(report['checked']).toBeGreaterThanOrEqual(3);
    expect(report['unhealthy']).toBe(1);
    const failovers = report['failovers'] as Array<Record<string, unknown>> | undefined;
    expect(failovers).toHaveLength(1);
    expect(failovers?.[0]).toMatchObject({
      assignment_key: 'default',
      sub_key: null,
      old_primary: 'Doubao-Seed2.0',
      new_primary: 'DeepSeek-V4-Pro',
    });
    // assignments 已切换
    expect(service.assignments['default']?.['primary']).toBe('DeepSeek-V4-Pro');
  });

  it('checkAndFailover 无 fallback 时全局替换', async () => {
    const http = new FakeHttp();
    http.postHandler = (_url, options) => {
      const model = (options?.json as { model?: string } | undefined)?.model ?? '';
      return model === 'Doubao-Seed2.0' || model === 'DeepSeek-V4-Pro'
        ? { status: 500 }
        : { status: 200 };
    };
    const service = makeService(http);
    const checker = new HealthChecker(service);
    const report = await checker.checkAndFailover();
    const failovers = report['failovers'] as Array<Record<string, unknown>> | undefined;
    const fix = failovers?.[0];
    expect(fix?.['source']).toBe('global');
    expect(fix?.['new_primary']).toBe('qwen/qwen3-coder:free');
  });

  it('checkAndFailover 无可用替换时返回 undefined failover', async () => {
    const http = new FakeHttp();
    http.postHandler = () => ({ status: 500 });
    const service = makeService(http);
    const checker = new HealthChecker(service);
    const report = await checker.checkAndFailover();
    expect(report['failovers']).toEqual([]);
  });

  it('lastReport 返回最近一次报告快照', async () => {
    const service = makeService();
    const checker = new HealthChecker(service);
    await checker.checkAndFailover();
    const report = checker.lastReport;
    expect(report['checked']).toBeGreaterThan(0);
    expect(report['unhealthy']).toBe(0);
  });

  it('start/stop 幂等且不抛错', async () => {
    const service = makeService();
    const checker = new HealthChecker(service, 3600);
    await checker.start();
    await checker.start(); // 幂等
    await checker.stop();
    await checker.stop(); // 幂等
  });

  it('autoFailover 直接执行单 assignment 切换', async () => {
    const http = new FakeHttp();
    http.postHandler = (_url, options) => {
      const model = (options?.json as { model?: string } | undefined)?.model ?? '';
      return model === 'Doubao-Seed2.0' ? { status: 500 } : { status: 200 };
    };
    const service = makeService(http);
    const checker = new HealthChecker(service);
    const fix = await checker.autoFailover('default', null, 'openroute/Doubao-Seed2.0');
    expect(fix).toBeDefined();
    expect(service.assignments['default']?.['primary']).toBe('DeepSeek-V4-Pro');
    // 旧 primary 被放回 fallback 首位
    expect(service.assignments['default']?.['fallbacks']).toEqual(['Doubao-Seed2.0']);
  });
});
