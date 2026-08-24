/**
 * @flowforge/forgekin-observability — 阶段7 T7.12 可观测性 Cordis 插件。
 *
 * 挂载 `ctx.forgeObservability`：
 *   - trace: TraceManager（trace_id 全链路传播 + span 链 + JSONL 导出 P-94）
 *   - metrics: MetricsCollector（计数器/仪表/直方图 + Prometheus 文本导出）
 *   - taskMetrics: TaskMetricsCollector 注册表（单任务指标采集）
 *   - globalMetrics: GlobalMetrics（tool/llm/task/persona 全局统计函数族）
 *   - audit: AuditLogger（JSONL 审计日志：门禁决策/人工干预/级联事件）
 *   - bus: EventBus（发布订阅 + 请求响应 + "*" 通配）
 *   - bridge: EventBusBridge（跨项目事件桥，DEFAULT_BRIDGED_EVENTS 8 类）
 *
 * TS 重写自 Python `core/{tracing,observability,metrics,event_bridge}.py` +
 * `events/event_bus.py`（F13，P-94）。
 */

import { Context, Service } from '@flowforge/cordis';
import { AuditLogger } from './audit.js';
import {
  EventBus,
  EventBusBridge,
  type EventHandler,
  type EventRecord,
} from './event-bus.js';
import {
  GlobalMetrics,
  MetricsCollector,
  TaskMetricsCollector,
} from './metrics.js';
import { Span, TraceManager } from './span.js';

export * from './tracing.js';
export * from './span.js';
export * from './metrics.js';
export * from './audit.js';
export * from './event-bus.js';

export interface ObservabilityServiceOptions {
  /** 追踪管理器（缺省新建）。 */
  readonly trace?: TraceManager | undefined;
  /** 指标采集器（缺省新建）。 */
  readonly metrics?: MetricsCollector | undefined;
  /** 全局统计函数族（缺省新建）。 */
  readonly globalMetrics?: GlobalMetrics | undefined;
  /** 审计日志（缺省 logs/audit.jsonl）。 */
  readonly audit?: AuditLogger | undefined;
  /** 事件总线（缺省新建）。 */
  readonly bus?: EventBus | undefined;
  /** 审计日志路径（audit 未注入时用于新建）。 */
  readonly auditLogPath?: string | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 可观测性域：追踪 / 指标 / 审计 / 事件总线 */
    forgeObservability: ObservabilityService;
  }
}

/**
 * 可观测性域服务 — 追踪 / 指标 / 审计 / 事件总线统一入口。
 *
 * 组装：
 * - trace: TraceManager（span 链 + JSONL 导出）
 * - metrics: MetricsCollector（基础三类型 + Prometheus 导出）
 * - globalMetrics: GlobalMetrics（tool/llm/task 统计）
 * - audit: AuditLogger（JSONL 审计）
 * - bus: EventBus（发布订阅）+ bridge: EventBusBridge（跨项目转发）
 */
export class ObservabilityService extends Service {
  readonly trace: TraceManager;
  readonly metrics: MetricsCollector;
  readonly globalMetrics: GlobalMetrics;
  readonly audit: AuditLogger;
  readonly bus: EventBus;
  readonly bridge: EventBusBridge;
  private readonly taskCollectors = new Map<string, TaskMetricsCollector>();

  constructor(ctx: Context, options: ObservabilityServiceOptions = {}) {
    super(ctx, 'forgeObservability');
    this.trace = options.trace ?? new TraceManager();
    this.metrics = options.metrics ?? new MetricsCollector();
    this.globalMetrics = options.globalMetrics ?? new GlobalMetrics();
    this.audit = options.audit ?? new AuditLogger(options.auditLogPath);
    this.bus = options.bus ?? new EventBus();
    this.bridge = new EventBusBridge(this.bus);
  }

  /**
   * 追踪 Agent 执行（对齐 Python ObservabilityManager.trace_agent_execution）。
   *
   * 成功时递增 agent_execution_total 并记录耗时直方图；
   * 异常时递增 agent_execution_errors，异常向上抛。
   */
  async runAgentExecution<T>(
    agentName: string,
    fn: (span: Span) => Promise<T>,
    attrs: Record<string, unknown> = {},
  ): Promise<T> {
    const start = Date.now();
    const span = this.trace.new_span(`agent:${agentName}`, attrs);
    try {
      const result = await fn(span);
      this.metrics.increment('agent_execution_total', 1, { agent: agentName });
      this.metrics.observe('agent_execution_seconds', Date.now() - start, {
        agent: agentName,
      });
      this.trace.finish_span(span, 'ok');
      return result;
    } catch (err) {
      this.metrics.increment('agent_execution_errors', 1, { agent: agentName });
      this.trace.finish_span(span, 'error');
      throw err;
    }
  }

  /**
   * 获取或创建指定任务的指标采集器（对齐 Python get_metrics_collector）。
   */
  getTaskCollector(task_id: string): TaskMetricsCollector {
    let collector = this.taskCollectors.get(task_id);
    if (collector === undefined) {
      collector = new TaskMetricsCollector(task_id);
      this.taskCollectors.set(task_id, collector);
    }
    return collector;
  }

  /** 重置指定任务的指标采集器。 */
  resetTaskMetrics(task_id: string): boolean {
    return this.taskCollectors.delete(task_id);
  }

  /** 事件总线便捷委托：subscribe。 */
  onEvent(
    event_type: string,
    callback: EventHandler,
    filter?: (event: EventRecord) => boolean,
  ): void {
    this.bus.subscribe(event_type, callback, filter ?? null);
  }

  /** 事件总线便捷委托：emit。 */
  emitEvent(
    task_id: string,
    event_type: string,
    payload: Record<string, unknown>,
  ): void {
    this.bus.emit(task_id, event_type, payload);
  }

  /** 导出 Prometheus 文本格式指标（P-94）。 */
  export_metrics_text(): string {
    return this.metrics.export_prometheus_text();
  }

  /** 导出全部追踪到 JSONL 文件（P-94）。 */
  async export_traces(filePath: string = 'logs/traces.jsonl'): Promise<void> {
    await this.trace.save_traces(filePath);
  }
}

export default function Plugin(
  ctx: Context,
  options: ObservabilityServiceOptions = {},
): void {
  ctx.forgeObservability = new ObservabilityService(ctx, options);
}
