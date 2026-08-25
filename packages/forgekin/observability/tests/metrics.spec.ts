/**
 * 指标 — T7.12 三类采集器契约验证。
 *
 * 移植自 `core/metrics.py` + `core/observability.py`：
 *   - MetricsCollector：计数器/仪表/直方图 + 快照 + Prometheus 文本导出（P-94）
 *   - TaskMetricsCollector：单任务指标采集（LLM/工具/错误汇总）
 *   - GlobalMetrics：全局统计函数族（tool/llm/task/persona 聚合）
 *
 * @module @flowforge/forgekin-observability/tests
 */

import { describe, expect, it } from 'vitest';
import {
  GlobalMetrics,
  MetricsCollector,
  TaskMetricsCollector,
} from '../src/metrics.js';

describe('MetricsCollector 基础三类型', () => {
  it('increment 累加计数器（无标签/带标签键隔离）', () => {
    const mc = new MetricsCollector();
    mc.increment('tasks');
    mc.increment('tasks');
    mc.increment('tasks', 2);
    mc.increment('tasks', 1, { mode: 'auto' });
    const snap = mc.get_snapshot();
    expect(snap.counters).toEqual({ tasks: 4, 'tasks{mode=auto}': 1 });
  });

  it('gauge 覆盖式设置仪表值', () => {
    const mc = new MetricsCollector();
    mc.gauge('running', 1);
    mc.gauge('running', 2);
    mc.gauge('running', 3, { persona: 'sherlock' });
    const snap = mc.get_snapshot();
    expect(snap.gauges).toEqual({ running: 2, 'running{persona=sherlock}': 3 });
  });

  it('observe 累积直方图观测值并计算 count/sum/avg', () => {
    const mc = new MetricsCollector();
    mc.observe('latency', 1);
    mc.observe('latency', 3);
    mc.observe('latency', 2, { mode: 'auto' });
    const snap = mc.get_snapshot();
    expect(snap.histograms).toEqual({
      latency: { count: 2, sum: 4, avg: 2 },
      'latency{mode=auto}': { count: 1, sum: 2, avg: 2 },
    });
  });
});

describe('MetricsCollector Prometheus 导出（P-94）', () => {
  it('export_prometheus_text 输出 counter/gauge/summary 文本', () => {
    const mc = new MetricsCollector();
    mc.increment('flowforge_tasks_total', 3, { mode: 'auto', status: 'created' });
    mc.gauge('flowforge_persona_running', 2, { persona: 'sherlock' });
    mc.observe('flowforge_execution_duration_seconds', 1.5, { mode: 'auto' });
    const text = mc.export_prometheus_text();
    expect(text).toContain('# TYPE flowforge_tasks_total counter');
    expect(text).toContain('flowforge_tasks_total{mode="auto",status="created"} 3');
    expect(text).toContain('# TYPE flowforge_persona_running gauge');
    expect(text).toContain('flowforge_persona_running{persona="sherlock"} 2');
    expect(text).toContain('# TYPE flowforge_execution_duration_seconds summary');
    expect(text).toContain('flowforge_execution_duration_seconds_count{mode="auto"} 1');
    expect(text).toContain('flowforge_execution_duration_seconds_sum{mode="auto"} 1.5');
  });

  it('空采集器导出空字符串', () => {
    expect(new MetricsCollector().export_prometheus_text()).toBe('');
  });
});

describe('TaskMetricsCollector 单任务采集', () => {
  it('record_llm_call / record_tool_call / record_error 汇总正确', () => {
    const c = new TaskMetricsCollector('task-1');
    c.record_llm_call(100, 50, 0.01);
    c.record_llm_call(200, 100, 0.02);
    c.record_tool_call('search', true);
    c.record_tool_call('search', false);
    c.record_error('boom');
    const summary = c.get_summary();
    expect(summary.task_id).toBe('task-1');
    expect(summary.llm_calls).toBe(2);
    expect(summary.tool_calls).toBe(2);
    expect(summary.tokens_in).toBe(300);
    expect(summary.tokens_out).toBe(150);
    expect(summary.cost).toBe(0.03);
    expect(summary.error_count).toBe(1);
    expect(summary.errors).toEqual(['boom']);
    expect(summary.steps_failed).toBe(0);
  });

  it('steps_total / steps_completed 联动 steps_failed', () => {
    const c = new TaskMetricsCollector('task-2');
    c.steps_total = 5;
    c.steps_completed = 3;
    expect(c.get_summary().steps_failed).toBe(2);
  });

  it('finish 记录 end_time，to_dict 保留原始字段', () => {
    const c = new TaskMetricsCollector('task-3');
    c.finish();
    const dict = c.to_dict();
    expect(dict.task_id).toBe('task-3');
    expect(dict.end_time).toBeGreaterThan(0);
    expect(typeof dict.start_time).toBe('number');
  });
});

describe('GlobalMetrics 全局统计', () => {
  it('tool 统计：call_count / avg / min / max + error_count', () => {
    const g = new GlobalMetrics();
    g.record_tool_call('search', 1.0);
    g.record_tool_call('search', 3.0);
    g.record_tool_error('search');
    expect(g.get_tool_stats()['search']).toEqual({
      call_count: 2,
      total_duration: 4,
      avg_duration: 2,
      min_duration: 1,
      max_duration: 3,
      error_count: 1,
    });
  });

  it('纯错误工具出现在统计中（call_count=0）', () => {
    const g = new GlobalMetrics();
    g.record_tool_error('web');
    expect(g.get_tool_stats()['web']).toEqual({ call_count: 0, error_count: 1 });
  });

  it('task 统计：created/completed/failed + avg_duration', () => {
    const g = new GlobalMetrics();
    g.record_task_created('auto', 'sherlock');
    g.record_task_completed('auto', 'sherlock', 2.0);
    g.record_task_completed('auto', 'sherlock', 4.0);
    g.record_task_failed('auto', 'dev');
    const stats = g.get_task_stats();
    expect(stats['auto/sherlock']).toEqual({
      created: 1,
      completed: 2,
      failed: 0,
      avg_duration: 3,
    });
    expect(stats['auto/dev']).toEqual({
      created: 0,
      completed: 0,
      failed: 1,
      avg_duration: 0,
    });
  });

  it('llm token 统计按 provider/model 聚合', () => {
    const g = new GlobalMetrics();
    g.record_llm_tokens('deepseek', 'v3', 100);
    g.record_llm_tokens('deepseek', 'v3', 50);
    g.record_llm_tokens('gpt', 'o1', 10);
    expect(g.get_llm_token_stats()).toEqual({ 'deepseek/v3': 150, 'gpt/o1': 10 });
  });

  it('get_metrics 汇总 tool/task/llm_token 三块', () => {
    const g = new GlobalMetrics();
    g.record_llm_error('deepseek', 'rate_limit');
    g.record_task_created('manual', 'dev');
    const m = g.get_metrics();
    expect(m).toHaveProperty('tool_stats');
    expect(m).toHaveProperty('task_stats');
    expect(m).toHaveProperty('llm_token_stats');
    expect(m.task_stats).toHaveProperty('manual/dev');
  });
});
