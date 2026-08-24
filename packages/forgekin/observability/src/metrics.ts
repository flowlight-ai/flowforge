/**
 * @flowforge/forgekin-observability — T7.12 指标：轻量内存采集 + 单任务采集 + 全局统计。
 *
 * TS 重写自 `core/metrics.py` + `core/observability.py` 的 MetricsCollector：
 *   - MetricsCollector：计数器/仪表/直方图三种基础类型 + 快照 + Prometheus 文本导出
 *     （P-94：无第三方依赖的轻量导出，对应 Python 无 prometheus_client 时的降级语义）
 *   - TaskMetricsCollector：单任务指标采集器（LLM 调用/工具调用/token/成本/步数/错误）
 *   - GlobalMetrics：全局统计函数族（对齐 metrics.py 的内存降级分支 record_* / get_*）
 */

/** 指标标签（Prometheus 风格 key=value）。 */
export type MetricLabels = Record<string, string | number>;

/**
 * 轻量内存指标采集器 — 计数器 / 仪表 / 直方图。
 */
export class MetricsCollector {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  /** 递增计数器（带可选标签）。 */
  increment(name: string, value: number = 1.0, labels: MetricLabels = {}): void {
    const key = makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  /** 设置仪表值（带可选标签）。 */
  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.gauges.set(makeKey(name, labels), value);
  }

  /** 记录直方图观测值（带可选标签）。 */
  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const key = makeKey(name, labels);
    const bucket = this.histograms.get(key) ?? [];
    bucket.push(value);
    this.histograms.set(key, bucket);
  }

  /** 获取所有指标的快照（对齐 Python get_snapshot）。 */
  get_snapshot(): Record<string, unknown> {
    const histograms: Record<string, { count: number; sum: number; avg: number }> = {};
    for (const [key, values] of this.histograms) {
      histograms[key] = {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        avg: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    };
  }

  /**
   * 导出为 Prometheus 文本格式（P-94 轻量导出，无第三方依赖）。
   *
   * counter/gauge 按标准文本格式输出，histogram 以 `_count` / `_sum` 摘要形式输出。
   */
  export_prometheus_text(): string {
    const lines: string[] = [];
    for (const [key, value] of [...this.counters].sort()) {
      const [name, labels] = splitKey(key);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${formatMetric(name, labels)} ${value}`);
    }
    for (const [key, value] of [...this.gauges].sort()) {
      const [name, labels] = splitKey(key);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${formatMetric(name, labels)} ${value}`);
    }
    for (const [key, values] of [...this.histograms].sort()) {
      const [name, labels] = splitKey(key);
      lines.push(`# TYPE ${name} summary`);
      lines.push(`${formatMetric(name + '_count', labels)} ${values.length}`);
      lines.push(`${formatMetric(name + '_sum', labels)} ${values.reduce((a, b) => a + b, 0)}`);
    }
    return lines.length > 0 ? lines.join('\n') + '\n' : '';
  }
}

/**
 * 单任务指标采集器 — 采集单个任务执行过程中的各项指标（对齐 metrics.py）。
 */
export class TaskMetricsCollector {
  readonly task_id: string;
  readonly start_time: number;
  end_time: number = 0;
  llm_calls: number = 0;
  tool_calls: number = 0;
  tokens_in: number = 0;
  tokens_out: number = 0;
  cost: number = 0;
  steps_total: number = 0;
  steps_completed: number = 0;
  errors: string[] = [];

  constructor(task_id: string) {
    this.task_id = task_id;
    this.start_time = Date.now();
  }

  /** 记录一次 LLM 调用（tokens 输入/输出 + 成本）。 */
  record_llm_call(tokens_in: number, tokens_out: number, cost: number): void {
    this.llm_calls += 1;
    this.tokens_in += tokens_in;
    this.tokens_out += tokens_out;
    this.cost += cost;
  }

  /** 记录一次工具调用（success 决定状态口径）。 */
  record_tool_call(_tool_name: string, success: boolean): void {
    this.tool_calls += 1;
    void success;
  }

  /** 记录一条错误信息。 */
  record_error(error_msg: string): void {
    this.errors.push(error_msg);
  }

  /** 返回指标汇总字典（end_time 未设置时按当前时间）。 */
  get_summary(): Record<string, unknown> {
    const end = this.end_time > 0 ? this.end_time : Date.now();
    return {
      task_id: this.task_id,
      duration: Math.round((end - this.start_time) * 1000) / 1000,
      llm_calls: this.llm_calls,
      tool_calls: this.tool_calls,
      tokens_in: this.tokens_in,
      tokens_out: this.tokens_out,
      cost: Math.round(this.cost * 1_000_000) / 1_000_000,
      steps_total: this.steps_total,
      steps_completed: this.steps_completed,
      steps_failed: this.steps_total - this.steps_completed,
      error_count: this.errors.length,
      errors: [...this.errors],
    };
  }

  /** 将完整指标序列化为字典。 */
  to_dict(): Record<string, unknown> {
    return {
      task_id: this.task_id,
      start_time: this.start_time,
      end_time: this.end_time,
      llm_calls: this.llm_calls,
      tool_calls: this.tool_calls,
      tokens_in: this.tokens_in,
      tokens_out: this.tokens_out,
      cost: this.cost,
      steps_total: this.steps_total,
      steps_completed: this.steps_completed,
      errors: [...this.errors],
    };
  }

  /** 标记任务结束。 */
  finish(): void {
    this.end_time = Date.now();
  }
}

/**
 * 全局统计函数族（对齐 metrics.py 无 prometheus_client 时的内存降级分支）。
 *
 * 提供 tool / llm / task / persona 四类记录的聚合统计。
 */
export class GlobalMetrics {
  private readonly toolDurations = new Map<string, number[]>();
  private readonly toolErrors = new Map<string, number>();
  private readonly llmTokens = new Map<string, number>();
  private readonly llmErrors = new Map<string, Map<string, number>>();
  private readonly tasksCreated = new Map<string, number>();
  private readonly tasksCompleted = new Map<string, number>();
  private readonly tasksFailed = new Map<string, number>();
  private readonly taskDurations = new Map<string, number[]>();
  private readonly personaRunning = new Map<string, number>();

  /** 记录一次工具调用耗时（秒）。 */
  record_tool_call(tool_name: string, duration: number): void {
    const bucket = this.toolDurations.get(tool_name) ?? [];
    bucket.push(duration);
    this.toolDurations.set(tool_name, bucket);
  }

  /** 记录一次工具调用错误。 */
  record_tool_error(tool_name: string): void {
    this.toolErrors.set(tool_name, (this.toolErrors.get(tool_name) ?? 0) + 1);
  }

  /** 记录 LLM token 用量（provider/model 聚合）。 */
  record_llm_tokens(provider: string, model: string, tokens: number): void {
    const key = `${provider}/${model}`;
    this.llmTokens.set(key, (this.llmTokens.get(key) ?? 0) + tokens);
  }

  /** 记录 LLM 错误（provider × error_type）。 */
  record_llm_error(provider: string, error_type: string): void {
    const byType = this.llmErrors.get(provider) ?? new Map<string, number>();
    byType.set(error_type, (byType.get(error_type) ?? 0) + 1);
    this.llmErrors.set(provider, byType);
  }

  /** 记录任务创建（mode/persona 聚合）。 */
  record_task_created(mode: string, persona: string): void {
    const key = `${mode}/${persona}`;
    this.tasksCreated.set(key, (this.tasksCreated.get(key) ?? 0) + 1);
  }

  /** 记录任务完成（含耗时）。 */
  record_task_completed(mode: string, persona: string, duration: number): void {
    const key = `${mode}/${persona}`;
    this.tasksCompleted.set(key, (this.tasksCompleted.get(key) ?? 0) + 1);
    const bucket = this.taskDurations.get(key) ?? [];
    bucket.push(duration);
    this.taskDurations.set(key, bucket);
  }

  /** 记录任务失败。 */
  record_task_failed(mode: string, persona: string): void {
    const key = `${mode}/${persona}`;
    this.tasksFailed.set(key, (this.tasksFailed.get(key) ?? 0) + 1);
  }

  /** 设置 persona 当前运行任务数。 */
  set_persona_running(persona: string, count: number): void {
    this.personaRunning.set(persona, count);
  }

  /** 工具统计（call_count/error_count/平均·最小·最大耗时）。 */
  get_tool_stats(): Record<string, Record<string, unknown>> {
    const stats: Record<string, Record<string, unknown>> = {};
    for (const [name, durations] of this.toolDurations) {
      stats[name] = {
        call_count: durations.length,
        total_duration: durations.reduce((a, b) => a + b, 0),
        avg_duration: durations.reduce((a, b) => a + b, 0) / durations.length,
        min_duration: Math.min(...durations),
        max_duration: Math.max(...durations),
        error_count: this.toolErrors.get(name) ?? 0,
      };
    }
    for (const [name, count] of this.toolErrors) {
      if (stats[name] === undefined) {
        stats[name] = { call_count: 0, error_count: count };
      }
    }
    return stats;
  }

  /** 任务统计（created/completed/failed + 平均耗时）。 */
  get_task_stats(): Record<string, Record<string, unknown>> {
    const stats: Record<string, Record<string, unknown>> = {};
    const keys = new Set([
      ...this.tasksCreated.keys(),
      ...this.tasksCompleted.keys(),
      ...this.tasksFailed.keys(),
    ]);
    for (const key of keys) {
      const durations = this.taskDurations.get(key) ?? [];
      stats[key] = {
        created: this.tasksCreated.get(key) ?? 0,
        completed: this.tasksCompleted.get(key) ?? 0,
        failed: this.tasksFailed.get(key) ?? 0,
        avg_duration:
          durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0,
      };
    }
    return stats;
  }

  /** LLM token 统计（provider/model → tokens）。 */
  get_llm_token_stats(): Record<string, number> {
    return Object.fromEntries(this.llmTokens);
  }

  /** 汇总指标（tool_stats / task_stats / llm_token_stats）。 */
  get_metrics(): Record<string, unknown> {
    return {
      tool_stats: this.get_tool_stats(),
      task_stats: this.get_task_stats(),
      llm_token_stats: this.get_llm_token_stats(),
    };
  }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

/** 合成带标签的键（对齐 Python _make_key：name{k=v,k2=v2}）。 */
function makeKey(name: string, labels: MetricLabels): string {
  if (Object.keys(labels).length === 0) return name;
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${name}{${labelStr}}`;
}

/** 拆分复合键为 (metric_name, labels)。 */
function splitKey(key: string): [string, MetricLabels] {
  const open = key.indexOf('{');
  if (open === -1) return [key, {}];
  const name = key.slice(0, open);
  const labelsPart = key.slice(open + 1, key.endsWith('}') ? -1 : undefined);
  const labels: MetricLabels = {};
  if (labelsPart.length > 0) {
    for (const pair of labelsPart.split(',')) {
      const eq = pair.indexOf('=');
      if (eq !== -1) {
        labels[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }
  }
  return [name, labels];
}

/** Prometheus 文本行（对齐 Python _format_metric）。 */
function formatMetric(name: string, labels: MetricLabels): string {
  if (Object.keys(labels).length === 0) return name;
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `${name}{${labelStr}}`;
}
