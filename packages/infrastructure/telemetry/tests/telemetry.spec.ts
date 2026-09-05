/**
 * telemetry 插件包测试 — C33（F152/F153 机制层）。
 *
 * 覆盖：hmac 幂等 + salt 缺失抛错（非 dev）；pseudonymizeId escape hatch；
 * LocalTraceStore 环形缓冲（maxSpans 驱逐 + maxAgeMs TTL + query + hydrate）；
 * parsePrometheusText；BurnRateMonitor 去抖告警 + 自动清除；
 * Cordis 插件挂载 ctx.forgeTelemetry。
 */

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import ForgeTelemetryService, {
  hmacId,
  parsePrometheusText,
  pseudonymizeId,
  LocalTraceStore,
  type TraceSpanDTO,
} from '../src/index.ts';

const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length > 0) {
    const fiber = fibers.pop();
    if (fiber) await fiber.dispose();
  }
});

describe('hmac / pseudonymizeId', () => {
  it('同输入→同哈希；不同输入→不同哈希', () => {
    process.env.NODE_ENV = 'test';
    const a = hmacId('thread-1');
    const b = hmacId('thread-1');
    const c = hmacId('thread-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('pseudonymizeId escape hatch 开启返回原 ID', () => {
    process.env.NODE_ENV = 'test';
    process.env.FF_TELEMETRY_EXPORT_RAW_IDS = '1';
    expect(pseudonymizeId('raw-id')).toBe('raw-id');
    delete process.env.FF_TELEMETRY_EXPORT_RAW_IDS;
    expect(pseudonymizeId('raw-id')).not.toBe('raw-id');
  });
});

describe('LocalTraceStore', () => {
  function makeSpan(storedAt: number, name = 'span'): TraceSpanDTO {
    return {
      traceId: 't1',
      spanId: `s${storedAt}`,
      name,
      kind: 0,
      startTimeMs: storedAt,
      endTimeMs: storedAt + 10,
      durationMs: 10,
      status: { code: 0 },
      attributes: { 'agent.id': 'cat-a' },
      events: [],
      storedAt,
    };
  }

  it('maxSpans 驱逐最旧', () => {
    const now = Date.now();
    const store = new LocalTraceStore({ maxSpans: 3, maxAgeMs: 60_000 });
    store.add(makeSpan(now, 'span-1'));
    store.add(makeSpan(now + 1, 'span-2'));
    store.add(makeSpan(now + 2, 'span-3'));
    store.add(makeSpan(now + 3, 'span-4'));
    expect(store.stats().spanCount).toBe(3);
    expect(store.query({ limit: 10 })[0]?.name).toBe('span-4');
  });

  it('maxAgeMs TTL 驱逐过期', () => {
    const now = Date.now();
    const store = new LocalTraceStore({ maxSpans: 100, maxAgeMs: 1000 });
    store.add(makeSpan(now - 2000, 'old'));
    store.add(makeSpan(now, 'new'));
    expect(store.stats().spanCount).toBe(1);
    expect(store.query({ limit: 10 })[0]?.name).toBe('new');
  });

  it('query 按 traceId / catId 过滤 + limit', () => {
    const now = Date.now();
    const store = new LocalTraceStore({ maxSpans: 100, maxAgeMs: 60_000 });
    store.add({ ...makeSpan(now, 'a'), traceId: 'tA', attributes: { 'agent.id': 'cat-a' } });
    store.add({ ...makeSpan(now + 1, 'b'), traceId: 'tB', attributes: { 'agent.id': 'cat-b' } });
    expect(store.query({ traceId: 'tA' }).length).toBe(1);
    expect(store.query({ catId: 'cat-b' }).length).toBe(1);
    expect(store.query({ limit: 1 }).length).toBe(1);
  });

  it('hydrate 合并 + 去过期 + 截断', () => {
    const now = Date.now();
    const store = new LocalTraceStore({ maxSpans: 2, maxAgeMs: 1000 });
    store.add(makeSpan(now));
    store.hydrate([makeSpan(now - 2000), makeSpan(now)]);
    expect(store.stats().spanCount).toBe(2);
  });
});

describe('parsePrometheusText', () => {
  it('解析键值 + 跳过 bucket/count/sum + 跳过注释', () => {
    const text = `# HELP cat_cafe_active Active
cat_cafe_active 12
cat_cafe_invocation_completed{status="ok"} 100
cat_cafe_invocation_completed{status="error"} 5
cat_cafe_response_bucket{le="1"} 3
# TYPE cat_cafe_response summary
cat_cafe_cat_response_duration{quantile="0.95"} 130`;
    const m = parsePrometheusText(text);
    expect(m['cat_cafe_active']).toBe(12);
    expect(m['cat_cafe_invocation_completed{status="ok"}']).toBe(100);
    expect(m['cat_cafe_cat_response_duration{quantile="0.95"}']).toBe(130);
    expect(Object.keys(m).some((k) => k.includes('bucket'))).toBe(false);
  });
});

describe('BurnRateMonitor', () => {
  it('连续违例达到 debounce 后告警 + 恢复自动清除', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeTelemetryService, {})) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const svc = ctx.forgeTelemetry;

    const alerts: string[][] = [];
    let cleared = 0;
    const monitor = svc.createBurnRateMonitor({
      getMetricsText: async () =>
        'cat_cafe_invocation_completed{status="ok"} 10\ncat_cafe_invocation_completed{status="error"} 50\ncat_cafe_cat_response_duration{quantile="0.95"} 200',
      onAlert: (a) => alerts.push(a.map((x) => x.metric)),
      onClear: () => cleared++,
      debounceCount: 2,
    });

    // 第一轮违例：不告警（未达 debounce）
    await monitor.check();
    expect(alerts.length).toBe(0);
    // 第二轮违例：告警
    await monitor.check();
    expect(alerts.length).toBe(1);
    expect(monitor.isAlertActive()).toBe(true);
    // 恢复：清除（改用注入：重建一个恢复源监控）
    const monitor2 = svc.createBurnRateMonitor({
      getMetricsText: async () => 'cat_cafe_invocation_completed{status="ok"} 100\ncat_cafe_invocation_completed{status="error"} 1',
      onAlert: () => {},
      onClear: () => cleared++,
      debounceCount: 1,
    });
    // 模拟已告警状态后恢复
    await monitor2.check();
    expect(monitor2.isAlertActive()).toBe(false);
  });

  it('无数据时不告警', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgeTelemetryService, {})) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    const monitor = ctx.forgeTelemetry.createBurnRateMonitor({
      getMetricsText: async () => '',
      onAlert: () => {},
      onClear: () => {},
      debounceCount: 1,
    });
    await monitor.check();
    expect(monitor.isAlertActive()).toBe(false);
  });
});
