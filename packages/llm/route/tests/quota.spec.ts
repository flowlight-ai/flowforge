/**
 * quota.ts 测试 — ProviderQuotaManager 六维配额 + backup 切换
 * （core/provider_quota.py，P3-004）
 */
import { describe, expect, it } from 'vitest';
import {
  AllProvidersFailedError,
  ProviderQuotaManager,
  type ProviderQuotaConfig,
} from '../src/quota.js';

function makeConfig(overrides: Partial<ProviderQuotaConfig> = {}): ProviderQuotaConfig {
  return {
    provider: 'openroute',
    dailyTokenLimit: 0,
    dailyRequestLimit: 0,
    rpmLimit: 0,
    tpmLimit: 0,
    concurrentLimit: 0,
    enabled: true,
    backupModels: [],
    cooldownSeconds: 60,
    metadata: {},
    ...overrides,
  };
}

function makeManager(
  configs: Record<string, ProviderQuotaConfig> = { openroute: makeConfig() },
  nowSec: () => number = () => 1_000_000,
) {
  return new ProviderQuotaManager(configs, { nowSec });
}

describe('ProviderQuotaManager（core/provider_quota.py）', () => {
  it('未配置的 provider 默认放行', async () => {
    const manager = makeManager({});
    const result = await manager.checkQuota('unknown-provider');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('provider not configured');
  });

  it('enabled=false 的 provider 拒绝（reason 含 disabled）', async () => {
    const manager = makeManager({ p: makeConfig({ enabled: false }) });
    const result = await manager.checkQuota('p');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('cooldown 优先拦截（检查顺序第一）', async () => {
    const manager = makeManager({
      p: makeConfig({ dailyTokenLimit: 1_000_000 }),
    });
    await manager.markCooldown('p', 'rate_limited');
    const result = await manager.checkQuota('p');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('provider is in cooldown');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('daily_token_limit 超限拒绝（含预估 token）', async () => {
    const manager = makeManager({ p: makeConfig({ dailyTokenLimit: 1000 }) });
    await manager.recordUsage('p', 800, true);
    const result = await manager.checkQuota('p', 300);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_token_limit exceeded');
  });

  it('daily_request_limit 超限拒绝', async () => {
    const manager = makeManager({ p: makeConfig({ dailyRequestLimit: 2 }) });
    await manager.recordUsage('p', 10, true);
    await manager.recordUsage('p', 10, true);
    const result = await manager.checkQuota('p');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('daily_request_limit exceeded');
  });

  it('rpm_limit 滑动窗口计数（60s 内请求数）', async () => {
    let now = 0;
    const manager = makeManager({ p: makeConfig({ rpmLimit: 2 }) }, () => now);
    await manager.recordUsage('p', 1, true);
    await manager.recordUsage('p', 1, true);
    // 第 3 次超出 rpm=2
    const denied = await manager.checkQuota('p');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('rpm_limit exceeded');
    // 窗口滑动：61s 后旧记录过期 → 放行
    now = 61;
    const allowed = await manager.checkQuota('p');
    expect(allowed.allowed).toBe(true);
  });

  it('tpm_limit 按窗口内 token 总量拒绝', async () => {
    const manager = makeManager({ p: makeConfig({ tpmLimit: 500 }) });
    await manager.recordUsage('p', 400, true);
    const denied = await manager.checkQuota('p', 200);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('tpm_limit exceeded');
  });

  it('concurrent_limit 拒绝（配合 acquire/release）', async () => {
    const manager = makeManager({ p: makeConfig({ concurrentLimit: 1 }) });
    await manager.acquireConcurrent('p');
    const denied = await manager.checkQuota('p');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('concurrent_limit exceeded');
    await manager.releaseConcurrent('p');
    const allowed = await manager.checkQuota('p');
    expect(allowed.allowed).toBe(true);
  });

  it('releaseConcurrent 不会减到负数', async () => {
    const manager = makeManager({ p: makeConfig({ concurrentLimit: 1 }) });
    await manager.releaseConcurrent('p');
    const status = manager.getUsageStatus('p');
    expect(status['concurrent_current']).toBe(0);
  });

  it('quota_used_ratio 取所有维度最大比例', async () => {
    const manager = makeManager({
      p: makeConfig({
        dailyTokenLimit: 1000,
        dailyRequestLimit: 10,
        rpmLimit: 10,
      }),
    });
    await manager.recordUsage('p', 500, true); // 50% token, 10% req
    const result = await manager.checkQuota('p');
    expect(result.allowed).toBe(true);
    expect(result.quotaUsedRatio).toBeCloseTo(0.5, 5);
  });

  it('recordUsage 累计 tokens/requests 并记录滑动窗口', async () => {
    const manager = makeManager({ p: makeConfig() });
    await manager.recordUsage('p', 100, true);
    await manager.recordUsage('p', 50, false); // 失败也记录请求数
    const status = manager.getUsageStatus('p');
    expect(status['tokens_used']).toBe(150);
    expect(status['requests_used']).toBe(2);
    expect(status['rpm_current']).toBe(2);
    expect(status['tpm_current']).toBe(150);
  });

  it('跨天自动重置每日计数', async () => {
    let day = '2026-08-24';
    const manager = new ProviderQuotaManager(
      { p: makeConfig({ dailyTokenLimit: 100 }) },
      { todayFn: () => day, nowSec: () => 1_000_000 },
    );
    await manager.recordUsage('p', 80, true);
    expect(manager.getUsageStatus('p')['tokens_used']).toBe(80);
    day = '2026-08-25';
    const result = await manager.checkQuota('p', 50);
    expect(result.allowed).toBe(true); // 跨天重置后 80 清零
    expect(manager.getUsageStatus('p')['tokens_used']).toBe(0);
    expect(manager.getUsageStatus('p')['date']).toBe('2026-08-25');
  });

  it('markCooldown 使用配置的 cooldown_seconds', async () => {
    const manager = makeManager({ p: makeConfig({ cooldownSeconds: 120 }) });
    await manager.markCooldown('p', 'test');
    const status = manager.getUsageStatus('p');
    expect(status['in_cooldown']).toBe(true);
    expect(status['cooldown_remaining_seconds']).toBeLessThanOrEqual(120);
    expect(status['cooldown_remaining_seconds']).toBeGreaterThan(0);
  });

  it('getBackupModel 返回首选 backup（无则 undefined）', async () => {
    const manager = makeManager({
      p: makeConfig({ backupModels: ['doubao-pro', 'glm-4'] }),
      q: makeConfig(),
    });
    expect(await manager.getBackupModel('p')).toBe('doubao-pro');
    expect(await manager.getBackupModel('q')).toBeUndefined();
  });

  it('tryWithBackup 主调用成功直接返回', async () => {
    const manager = makeManager({ p: makeConfig({ backupModels: ['b1'] }) });
    const calls: string[] = [];
    const result = await manager.tryWithBackup('p', async (target: string) => {
      calls.push(target);
      return `ok:${target}`;
    });
    expect(result).toBe('ok:p');
    expect(calls).toEqual(['p']);
  });

  it('tryWithBackup 主失败后按序尝试 backup 并成功', async () => {
    const manager = makeManager({ p: makeConfig({ backupModels: ['b1', 'b2'] }) });
    const result = await manager.tryWithBackup('p', async (target: string) => {
      if (target === 'p' || target === 'b1') {
        throw new Error(`fail ${target}`);
      }
      return `ok:${target}`;
    });
    expect(result).toBe('ok:b2');
  });

  it('tryWithBackup 全部失败抛 AllProvidersFailedError 并含错误明细', async () => {
    const manager = makeManager({ p: makeConfig({ backupModels: ['b1'] }) });
    await expect(
      manager.tryWithBackup('p', async (target: string) => {
        throw new Error(`boom ${target}`);
      }),
    ).rejects.toMatchObject({
      name: 'AllProvidersFailedError',
      provider: 'p',
      errors: [
        expect.stringContaining('p:'),
        expect.stringContaining('b1:'),
      ],
    });
  });

  it('tryWithBackup 主失败后标记主 provider 冷却', async () => {
    const manager = makeManager({ p: makeConfig({ backupModels: ['b1'], cooldownSeconds: 60 }) });
    await manager.tryWithBackup('p', async (target: string) => {
      if (target === 'p') {
        throw new Error('rate limited');
      }
      return 'ok';
    });
    const status = manager.getUsageStatus('p');
    expect(status['in_cooldown']).toBe(true);
  });

  it('getAllStatus 返回全部已配置 provider', async () => {
    const manager = makeManager({
      p: makeConfig(),
      q: makeConfig({ enabled: false }),
    });
    const all = manager.getAllStatus();
    expect(Object.keys(all).sort()).toEqual(['p', 'q']);
    expect(all['q']!['enabled']).toBe(false);
  });

  it('resetDailyQuota 重置全部 provider 且保留冷却状态', async () => {
    const manager = makeManager({ p: makeConfig({ dailyTokenLimit: 1000 }) });
    await manager.recordUsage('p', 700, true);
    await manager.markCooldown('p', 'test');
    await manager.resetDailyQuota();
    const status = manager.getUsageStatus('p');
    expect(status['tokens_used']).toBe(0);
    expect(status['requests_used']).toBe(0);
    expect(status['in_cooldown']).toBe(true); // 冷却不在每日重置范围
  });

  it('metricsCollector 收到配额事件（duck-typing）', async () => {
    const events: Array<Record<string, unknown>> = [];
    const manager = new ProviderQuotaManager(
      { p: makeConfig({ dailyRequestLimit: 1 }) },
      {
        metricsCollector: {
          recordProviderQuota: (payload) => events.push(payload),
        },
      },
    );
    await manager.recordUsage('p', 10, true);
    await manager.checkQuota('p'); // 超限
    await manager.markCooldown('p', 'x');
    const eventNames = events.map((e) => e['event']);
    expect(eventNames).toContain('usage_recorded');
    expect(eventNames).toContain('quota_exceeded');
    expect(eventNames).toContain('cooldown_marked');
  });

  it('AllProvidersFailedError 构造格式对齐 Python', () => {
    const error = new AllProvidersFailedError('p', ['p: Error: a', 'b1: Error: b']);
    expect(error.message).toContain("All providers failed for 'p'");
    expect(error.message).toContain('a');
    expect(error.message).toContain('b');
  });
});
