/**
 * @flowforge/infrastructure-telemetry — C33 telemetry 域 Cordis 插件（机制层）。
 *
 * TS 移植自 clowder-ai `infrastructure/telemetry/*`（F152/F153）：
 *   - hmac：HMAC-SHA256 ID 伪名化（外部遥测用，同输入→同哈希，跨信号关联不泄原 ID）
 *   - genai-semconv：GenAI 语义约定常量隔离层
 *   - local-trace-store：内存环形缓冲（maxSpans + maxAgeMs 双阈值驱逐）
 *   - prometheus-parser：Prometheus 文本解析纯函数
 *   - burn-rate-monitor：阈值监控（去抖 + 自动清除）
 *
 * 插件化改造：
 *   - env 全部改 FF_* 系（R17）：TELEMETRY_HMAC_SALT → FF_TELEMETRY_HMAC_SALT 等
 *   - clowder createModuleLogger → 注入式 TelemetryLogger 接口（缺省 console）
 *   - OTel SDK 耦合文件（redactor/local-trace-exporter/init/instruments）随各特性移植再补
 *
 * @module @flowforge/infrastructure-telemetry
 */

import { Context, Service } from '@flowforge/cordis';
import { createHmac } from 'node:crypto';

// ── hmac ────────────────────────────────────────────────────

const TENANT_SALT = process.env.FF_TELEMETRY_HMAC_SALT;

function getSalt(): string {
  if (TENANT_SALT) return TENANT_SALT;
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'test') {
    return 'dev-only-insecure-salt';
  }
  throw new Error(
    'FF_TELEMETRY_HMAC_SALT is required in non-dev environments. Set it in .env or your secret manager.',
  );
}

/** 校验 salt 可用（非 dev 环境缺 salt 抛错，调用方捕获并禁用遥测）。 */
export function validateSalt(): void {
  getSalt();
}

/** HMAC-SHA256 伪名化标识符（前 32 hex 字符，128-bit 碰撞安全）。 */
export function hmacId(id: string): string {
  return createHmac('sha256', getSalt()).update(id).digest('hex').slice(0, 32);
}

/** Env 闸门：导出原 ID（自托管受控环境）。 */
export function shouldExportRawIds(): boolean {
  return process.env.FF_TELEMETRY_EXPORT_RAW_IDS === '1';
}

/** 伪名化系统标识符（escape hatch 开启时返回原 ID）。 */
export function pseudonymizeId(id: string): string {
  return shouldExportRawIds() ? id : hmacId(id);
}

// ── genai-semconv 常量 ──────────────────────────────────────

export const GENAI_SYSTEM = 'gen_ai.system';
export const GENAI_MODEL = 'gen_ai.request.model';
export const GENAI_TOKENS_INPUT = 'gen_ai.usage.input_tokens';
export const GENAI_TOKENS_OUTPUT = 'gen_ai.usage.output_tokens';
export const AGENT_ID = 'agent.id';
export const OPERATION_NAME = 'operation.name';
export const STATUS = 'status';
export const TRIGGER = 'trigger';
export const CALLBACK_TOOL = 'callback.tool';
export const GROUNDING_CLAIM_TYPE = 'grounding.claim_type';
export const GROUNDING_VERDICT = 'grounding.verdict';
export const GROUNDING_ACTION_FAMILY = 'grounding.action_family';
export const GROUNDING_SOURCE_TIER = 'grounding.source_tier';

// ── local-trace-store ───────────────────────────────────────

export interface TraceSpanDTO {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  events: ReadonlyArray<{
    name: string;
    timeMs: number;
    attributes?: Record<string, unknown>;
  }>;
  storedAt: number;
}

export interface TraceQueryFilter {
  traceId?: string;
  invocationId?: string;
  catId?: string;
  limit?: number;
}

export interface LocalTraceStoreConfig {
  maxSpans?: number;
  maxAgeMs?: number;
}

export interface TraceStoreStats {
  spanCount: number;
  maxSpans: number;
  maxAgeMs: number;
  oldestStoredAt: number | null;
  newestStoredAt: number | null;
}

export const LOCAL_TRACE_STORE_DEFAULT_MAX_SPANS = 10_000;
export const LOCAL_TRACE_STORE_DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 内存环形缓冲（maxSpans + maxAgeMs 双阈值驱逐）。 */
export class LocalTraceStore {
  private readonly buffer: TraceSpanDTO[] = [];
  private readonly maxSpans: number;
  private readonly maxAgeMs: number;

  constructor(config?: LocalTraceStoreConfig) {
    this.maxSpans = config?.maxSpans ?? LOCAL_TRACE_STORE_DEFAULT_MAX_SPANS;
    this.maxAgeMs = config?.maxAgeMs ?? LOCAL_TRACE_STORE_DEFAULT_MAX_AGE_MS;
  }

  add(dto: TraceSpanDTO): void {
    this.evictExpired();
    while (this.buffer.length >= this.maxSpans) {
      this.buffer.shift();
    }
    this.buffer.push(dto);
  }

  query(filter: TraceQueryFilter): TraceSpanDTO[] {
    this.evictExpired();
    const limit = filter.limit ?? 100;
    const results: TraceSpanDTO[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (results.length >= limit) break;
      const dto = this.buffer[i]!;
      if (filter.traceId && dto.traceId !== filter.traceId) continue;
      if (filter.invocationId && dto.attributes.invocationId !== filter.invocationId) continue;
      if (filter.catId && dto.attributes[AGENT_ID] !== filter.catId) continue;
      results.push(dto);
    }
    return results;
  }

  stats(): TraceStoreStats {
    this.evictExpired();
    return {
      spanCount: this.buffer.length,
      maxSpans: this.maxSpans,
      maxAgeMs: this.maxAgeMs,
      oldestStoredAt: this.buffer.length > 0 ? this.buffer[0]!.storedAt : null,
      newestStoredAt: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1]!.storedAt : null,
    };
  }

  hydrate(dtos: TraceSpanDTO[]): void {
    const cutoff = Date.now() - this.maxAgeMs;
    const fresh = dtos.filter((d) => d.storedAt >= cutoff);
    const merged = [...fresh, ...this.buffer].sort((a, b) => a.storedAt - b.storedAt);
    this.buffer.length = 0;
    const start = Math.max(0, merged.length - this.maxSpans);
    for (let i = start; i < merged.length; i++) {
      this.buffer.push(merged[i]!);
    }
  }

  clear(): void {
    this.buffer.length = 0;
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    while (this.buffer.length > 0 && this.buffer[0]!.storedAt < cutoff) {
      this.buffer.shift();
    }
  }
}

// ── prometheus-parser ───────────────────────────────────────

/** 解析 Prometheus 文本为 key→value 映射（跳过 bucket/count/sum 子指标）。 */
export function parsePrometheusText(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    if (/_bucket\{/.test(line) || /_count\{/.test(line) || /_sum\{/.test(line)) continue;
    const match = line.match(/^([^\s{]+)(?:\{([^}]*)\})?\s+([\d.eE+-]+)(?:\s+\d+)?$/);
    if (!match) continue;
    const [, name, labels, valueStr] = match;
    const value = Number.parseFloat(valueStr!);
    if (Number.isNaN(value)) continue;
    const key = labels ? `${name}{${labels}}` : name!;
    metrics[key] = value;
  }
  return metrics;
}

// ── burn-rate-monitor ────────────────────────────────────────

export interface BurnRateThresholds {
  errorRate: number;
  p95LatencyS: number;
  activeInvocations: number;
}

export interface BurnRateAlert {
  metric: string;
  currentValue: number;
  threshold: number;
}

export interface TelemetryLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

export interface BurnRateMonitorConfig {
  getMetricsText: () => Promise<string>;
  onAlert: (alerts: BurnRateAlert[]) => void;
  onClear: () => void;
  intervalMs?: number;
  debounceCount?: number;
  thresholds?: Partial<BurnRateThresholds>;
  log?: TelemetryLogger;
}

const DEFAULT_THRESHOLDS: BurnRateThresholds = {
  errorRate: Number.parseFloat(process.env.FF_TELEMETRY_ALERT_ERROR_RATE ?? '0.3'),
  p95LatencyS: Number.parseFloat(process.env.FF_TELEMETRY_ALERT_P95_LATENCY_S ?? '120'),
  activeInvocations: Number.parseInt(process.env.FF_TELEMETRY_ALERT_ACTIVE_INVOCATIONS ?? '50', 10),
};

/** 阈值监控：周期读 Prometheus 文本，N 次连续违例后告警，恢复自动清除。 */
export class BurnRateMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveBreaches = 0;
  private alertActive = false;
  private readonly config: Required<Omit<BurnRateMonitorConfig, 'thresholds' | 'log'>> & {
    thresholds: BurnRateThresholds;
    log: TelemetryLogger;
  };

  constructor(config: BurnRateMonitorConfig) {
    this.config = {
      getMetricsText: config.getMetricsText,
      onAlert: config.onAlert,
      onClear: config.onClear,
      intervalMs: config.intervalMs ?? 60_000,
      debounceCount: config.debounceCount ?? 3,
      thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
      log: config.log ?? console,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.check();
    }, this.config.intervalMs);
    this.timer.unref();
    this.config.log.info(`[burn-rate] monitor started (interval=${this.config.intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 测试用：运行一轮检查。 */
  async check(): Promise<void> {
    try {
      const text = await this.config.getMetricsText();
      const metrics = parsePrometheusText(text);
      const alerts = this.evaluate(metrics);
      if (alerts.length > 0) {
        this.consecutiveBreaches++;
        if (this.consecutiveBreaches >= this.config.debounceCount && !this.alertActive) {
          this.alertActive = true;
          this.config.onAlert(alerts);
          this.config.log.warn(`[burn-rate] alert triggered: ${JSON.stringify(alert)}`);
        }
      } else {
        if (this.alertActive) {
          this.alertActive = false;
          this.config.onClear();
          this.config.log.info('[burn-rate] alert cleared');
        }
        this.consecutiveBreaches = 0;
      }
    } catch {
      this.config.log.warn('[burn-rate] check failed — skipping cycle');
    }
  }

  private evaluate(metrics: Record<string, number>): BurnRateAlert[] {
    const alerts: BurnRateAlert[] = [];
    const t = this.config.thresholds;
    const errorRate = this.computeErrorRate(metrics);
    if (errorRate !== null && errorRate > t.errorRate) {
      alerts.push({ metric: 'error_rate', currentValue: errorRate, threshold: t.errorRate });
    }
    const p95 = this.findP95Latency(metrics);
    if (p95 !== null && p95 > t.p95LatencyS) {
      alerts.push({ metric: 'p95_latency_s', currentValue: p95, threshold: t.p95LatencyS });
    }
    const active = metrics['cat_cafe_active_invocations'] ?? null;
    if (active !== null && active > t.activeInvocations) {
      alerts.push({ metric: 'active_invocations', currentValue: active, threshold: t.activeInvocations });
    }
    return alerts;
  }

  private computeErrorRate(metrics: Record<string, number>): number | null {
    let okTotal = 0;
    let errorTotal = 0;
    for (const [key, value] of Object.entries(metrics)) {
      if (!key.startsWith('cat_cafe_invocation_completed')) continue;
      if (key.includes('status="ok"')) okTotal += value;
      else if (key.includes('status="error"')) errorTotal += value;
    }
    const total = okTotal + errorTotal;
    if (total === 0) return null;
    return errorTotal / total;
  }

  private findP95Latency(metrics: Record<string, number>): number | null {
    for (const [key, value] of Object.entries(metrics)) {
      if (key.startsWith('cat_cafe_cat_response_duration') && key.includes('quantile="0.95"')) {
        return value;
      }
    }
    return null;
  }

  isAlertActive(): boolean {
    return this.alertActive;
  }
}

// ── Cordis 插件 ─────────────────────────────────────────────

export interface TelemetryConfig {
  /** trace store 配置（缺省默认容量/年龄）。 */
  traceStore?: LocalTraceStoreConfig;
  /** logger（缺省 console）。 */
  log?: TelemetryLogger;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** telemetry 域（C33）：ID 伪名化 + trace 环形缓冲 + burn-rate 监控 */
    forgeTelemetry: ForgeTelemetryService;
  }
}

/**
 * telemetry 域服务 — 挂载 `ctx.forgeTelemetry`。
 * 暴露：pseudonymizeId / hmacId / traceStore / createBurnRateMonitor。
 */
export class ForgeTelemetryService extends Service {
  readonly traceStore: LocalTraceStore;
  private readonly log: TelemetryLogger;

  constructor(ctx: Context, config: TelemetryConfig = {}) {
    super(ctx, 'forgeTelemetry');
    this.traceStore = new LocalTraceStore(config.traceStore);
    this.log = config.log ?? console;
  }

  pseudonymizeId(id: string): string {
    return pseudonymizeId(id);
  }

  hmacId(id: string): string {
    return hmacId(id);
  }

  /** 创建 burn-rate 监控器（调用方 wire getMetricsText + onAlert/onClear）。 */
  createBurnRateMonitor(config: Omit<BurnRateMonitorConfig, 'log'>): BurnRateMonitor {
    return new BurnRateMonitor({ ...config, log: this.log });
  }
}

export default ForgeTelemetryService;
