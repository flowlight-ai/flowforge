/**
 * ObservabilityService — T7.12 可观测性域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeObservability 挂载（trace/metrics/globalMetrics/audit/bus/bridge）
 * - 依赖注入：trace / metrics / globalMetrics / audit / bus 可注入
 * - runAgentExecution：对齐 Python trace_agent_execution（成功/异常路径）
 * - 任务指标注册表：getTaskCollector / resetTaskMetrics
 * - 事件总线委托：onEvent / emitEvent
 * - 导出机制（P-94）：export_metrics_text / export_traces
 *
 * @module @flowforge/forgekin-observability/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  AuditLogger,
  EventBus,
  GlobalMetrics,
  MetricsCollector,
  ObservabilityService,
  TraceManager,
} from '../src/index.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'obs-svc-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('ObservabilityService 插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeObservability（六组件实例化）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeObservability).toBeInstanceOf(ObservabilityService);
    expect(ctx.forgeObservability.trace).toBeInstanceOf(TraceManager);
    expect(ctx.forgeObservability.metrics).toBeInstanceOf(MetricsCollector);
    expect(ctx.forgeObservability.globalMetrics).toBeInstanceOf(GlobalMetrics);
    expect(ctx.forgeObservability.audit).toBeInstanceOf(AuditLogger);
    expect(ctx.forgeObservability.bus).toBeInstanceOf(EventBus);
  });

  it('依赖注入：trace/metrics/globalMetrics/audit/bus 可注入', async () => {
    const ctx = new Context();
    const trace = new TraceManager();
    const metrics = new MetricsCollector();
    const globalMetrics = new GlobalMetrics();
    const audit = new AuditLogger();
    const bus = new EventBus();
    await ctx.plugin(Plugin, { trace, metrics, globalMetrics, audit, bus });
    expect(ctx.forgeObservability.trace).toBe(trace);
    expect(ctx.forgeObservability.metrics).toBe(metrics);
    expect(ctx.forgeObservability.globalMetrics).toBe(globalMetrics);
    expect(ctx.forgeObservability.audit).toBe(audit);
    expect(ctx.forgeObservability.bus).toBe(bus);
  });
});

describe('runAgentExecution（对齐 trace_agent_execution）', () => {
  it('成功：返回结果 + agent_execution_total 计数 + span ok', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);

    const result = await ctx.forgeObservability.runAgentExecution(
      'sherlock',
      async (span) => {
        expect(span.operation).toBe('agent:sherlock');
        return 42;
      },
    );
    expect(result).toBe(42);

    const snap = ctx.forgeObservability.metrics.get_snapshot();
    expect(snap.counters).toEqual({ 'agent_execution_total{agent=sherlock}': 1 });
    expect(snap.histograms).toHaveProperty('agent_execution_seconds{agent=sherlock}');

    const [span] = ctx.forgeObservability.trace.export_spans();
    expect(span?.['status']).toBe('ok');
  });

  it('异常：agent_execution_errors 计数 + span error + 异常向上抛', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);

    await expect(
      ctx.forgeObservability.runAgentExecution('dev', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const snap = ctx.forgeObservability.metrics.get_snapshot();
    expect(snap.counters).toEqual({ 'agent_execution_errors{agent=dev}': 1 });

    const [span] = ctx.forgeObservability.trace.export_spans();
    expect(span?.['status']).toBe('error');
  });
});

describe('任务指标注册表', () => {
  it('getTaskCollector 同任务复用，resetTaskMetrics 清除', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);

    const a = ctx.forgeObservability.getTaskCollector('task-1');
    const b = ctx.forgeObservability.getTaskCollector('task-1');
    expect(a).toBe(b);
    a.record_llm_call(10, 5, 0.001);

    expect(ctx.forgeObservability.resetTaskMetrics('task-1')).toBe(true);
    expect(ctx.forgeObservability.resetTaskMetrics('task-1')).toBe(false);
    expect(ctx.forgeObservability.getTaskCollector('task-1').llm_calls).toBe(0);
  });
});

describe('事件总线委托', () => {
  it('onEvent / emitEvent 贯通', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);

    const seen: string[] = [];
    ctx.forgeObservability.onEvent('task.completed', (e) => {
      seen.push(e.payload['mode'] as string);
    });
    ctx.forgeObservability.emitEvent('t-1', 'task.completed', { mode: 'auto' });
    expect(seen).toEqual(['auto']);
  });
});

describe('导出机制（P-94）', () => {
  it('export_metrics_text 输出 Prometheus 文本', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    ctx.forgeObservability.metrics.increment('probe', 1);
    const text = ctx.forgeObservability.export_metrics_text();
    expect(text).toContain('# TYPE probe counter');
  });

  it('export_traces 写出 JSONL 文件', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    await ctx.forgeObservability.runAgentExecution('sherlock', async () => 1);

    const file = path.join(tmp, 'traces.jsonl');
    await ctx.forgeObservability.export_traces(file);
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['operation']).toBe('agent:sherlock');
  });
});
