/**
 * router.ts 测试 — LLMRouter 健康感知级联路由（llm/router.py）
 */
import { describe, expect, it } from 'vitest';
import { LLMRouter, ModelHealth } from '../src/router.js';

const modelsConfig = {
  assignments: {
    default: {
      primary: 'Doubao-Seed2.0',
      fallbacks: ['DeepSeek-V4-Pro', 'GLM-5.1'],
    },
    content_writing: {
      primary: 'GLM-5.1',
      fallbacks: ['Kimi-K2.6'],
    },
  },
  models: [
    { id: 'Doubao-Seed2.0', provider: 'openroute' },
    { id: 'DeepSeek-V4-Pro', provider: 'openroute' },
    { id: 'GLM-5.1', provider: 'openroute' },
  ],
};

describe('LLMRouter（llm/router.py）', () => {
  it('applyConfig 从 assignments 加载级联策略并初始化模型状态', () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    expect(router.getStrategies()['default']).toEqual({
      primary: 'Doubao-Seed2.0',
      fallback: ['DeepSeek-V4-Pro', 'GLM-5.1'],
    });
    expect(router.getStrategies()['content_writing']).toEqual({
      primary: 'GLM-5.1',
      fallback: ['Kimi-K2.6'],
    });
    // 策略中的模型（即使不在 models 列表）也会初始化
    expect(router.getModelStatus('Kimi-K2.6')).toBeDefined();
  });

  it('route 返回健康 primary', () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    expect(router.route('default')).toBe('Doubao-Seed2.0');
  });

  it('route 在 primary 不可用时降级到健康 fallback', async () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    await router.recordError('Doubao-Seed2.0');
    await router.recordError('Doubao-Seed2.0');
    await router.recordError('Doubao-Seed2.0'); // 3 次 → UNAVAILABLE
    expect(router.route('default')).toBe('DeepSeek-V4-Pro');
  });

  it('route 在全部不可用时回退 primary（让调用方处理错误）', async () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    for (const model of ['Doubao-Seed2.0', 'DeepSeek-V4-Pro', 'GLM-5.1']) {
      await router.recordError(model);
      await router.recordError(model);
      await router.recordError(model);
    }
    expect(router.route('default')).toBe('Doubao-Seed2.0');
  });

  it('route 未知策略回退 default，未知模型默认可用', () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    expect(router.route('unknown_strategy')).toBe('Doubao-Seed2.0');
    expect(router.isAvailable('never-registered')).toBe(true);
  });

  it('recordSuccess 恢复健康并降低错误率', async () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    await router.recordError('Doubao-Seed2.0');
    const degraded = router.getModelStatus('Doubao-Seed2.0')!;
    expect(degraded.health).toBe(ModelHealth.DEGRADED);
    expect(degraded.errorRate).toBe(0.05);
    expect(degraded.consecutiveErrors).toBe(1);

    await router.recordSuccess('Doubao-Seed2.0', 12.3);
    const recovered = router.getModelStatus('Doubao-Seed2.0')!;
    expect(recovered.health).toBe(ModelHealth.HEALTHY);
    expect(recovered.consecutiveErrors).toBe(0);
    expect(recovered.errorRate).toBe(0.0);
    expect(recovered.latencyP95).toBe(12.3);
    expect(recovered.totalCalls).toBe(2);
  });

  it('recordError 累计 3 次连续错误 → UNAVAILABLE（阈值对齐 Python）', async () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    await router.recordError('GLM-5.1');
    await router.recordError('GLM-5.1');
    expect(router.getModelStatus('GLM-5.1')!.health).toBe(ModelHealth.DEGRADED);
    await router.recordError('GLM-5.1');
    expect(router.getModelStatus('GLM-5.1')!.health).toBe(ModelHealth.UNAVAILABLE);
  });

  it('getHealthReport 统计健康/降级/不可用数量', async () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    await router.recordError('DeepSeek-V4-Pro');
    const report = router.getHealthReport();
    expect(report.totalModels).toBe(4); // 3 models + 策略补充 Kimi-K2.6
    expect(report.healthy).toBe(3);
    expect(report.degraded).toBe(1);
    expect(report.unavailable).toBe(0);
    expect(report.strategies).toContain('default');
    expect(report.models['DeepSeek-V4-Pro']).toMatchObject({
      health: ModelHealth.DEGRADED,
      consecutive_errors: 1,
      total_calls: 1,
      total_errors: 1,
    });
  });

  it('getAllStatus 返回全部模型状态快照', () => {
    const router = new LLMRouter();
    router.applyConfig(modelsConfig);
    expect(Object.keys(router.getAllStatus()).sort()).toEqual([
      'DeepSeek-V4-Pro',
      'Doubao-Seed2.0',
      'GLM-5.1',
      'Kimi-K2.6',
    ]);
  });

  it('loadConfig 文件不存在时静默降级（对齐 Python）', () => {
    const router = new LLMRouter('/nonexistent/models.yaml');
    expect(router.getStrategies()).toEqual({});
  });
});
