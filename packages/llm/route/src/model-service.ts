/**
 * @flowforge/llm-route — ModelService + HealthChecker（TS 重写自
 * `tools/llm/model_service.py` + `core/model_service.py`，F28）
 *
 * ModelService：模型健康检查（HTTP 探测 + 缓存 + 错误分类）+ 健康状态
 * 持久化 + 自动 failover + force_update + 记录调用成败 + fallback 链管理。
 * HealthChecker：周期健康检查循环，发现不健康模型时自动切换 assignments。
 *
 * 插件化改造：
 * - 配置（providers/models/assignments/active_providers）通过 options 注入，
 *   写回 models.yaml 改为 onConfigChange 回调（缺省 no-op）
 * - HTTP 探测通过 HttpLike 注入（缺省 FetchHttpClient），测试可 mock
 * - openroute 服务健康探测通过 pluginHealthCheck 回调注入（缺省 HTTP /health）
 *
 * @module @flowforge/llm-route/model-service
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchHttpClient, type HttpLike } from './http.js';

/** 模型健康状态常量（model_service.py STATUS_*）。 */
export const STATUS_AVAILABLE = 'available';
export const STATUS_DISABLED = 'disabled';
export const STATUS_SUSPENDED = 'suspended';
export const STATUS_UNKNOWN = 'unknown';

/** 错误类型模式表（model_service.py ERROR_TYPE_MAP）。 */
export const ERROR_TYPE_MAP: Record<string, string[]> = {
  model_not_found: ['100019', 'model not found', 'does not exist'],
  model_disabled: ['100020', 'model disabled', 'shutdown', 'retiring'],
  no_permission: ['100006', '100016', 'unauthorized', 'forbidden'],
  rate_limit: ['100002', 'rate limit', 'too many requests', 'throttling'],
  no_quota: ['100011', 'insufficient credits', 'no quota', 'balance too low'],
  timeout: ['timeout', 'timed out'],
  server_error: ['5xx', 'internal server error'],
};

/** 冷却时间表（model_service.py ERROR_COOLDOWNS）— 所有错误类型可恢复 SUSPENDED。 */
export const ERROR_COOLDOWNS: Record<string, number> = {
  rate_limit: 60, // 限流：60s 后重试
  no_permission: 600, // 无权限：10 分钟后重试（可能密钥临时失效）
  model_not_found: 600, // 模型不存在：10 分钟后重试（可能是临时下线）
  model_disabled: 600, // 模型禁用：10 分钟后重试
  no_quota: 300, // 配额不足：5 分钟后重试
  timeout: 30, // 超时：30s 后重试
  server_error: 15, // 服务器错误：15s 后重试
  unknown: 30, // 未知错误：30s 后重试
};

/** 健康状态记录（持久化格式）。 */
export interface HealthRecord {
  status: string;
  reason?: string;
  error_count?: number;
  latency_ms?: number;
  last_check?: string;
  last_check_ts?: number;
  suspended_until?: string;
  suspended_until_ts?: number;
  consecutive_failures?: number;
  last_failure?: string;
  last_failure_reason?: string;
  last_success?: string;
}

/** models.yaml 配置段（providers/models/assignments/active_providers）。 */
export interface ModelsConfig {
  readonly providers?: Record<string, Record<string, unknown>>;
  readonly models?: Array<Record<string, unknown>>;
  readonly assignments?: Record<string, Record<string, unknown>>;
  readonly active_providers?: string[];
}

/** openroute 服务健康回调（对齐 Python plugin_registry.get_plugin("openroute").health_check()）。 */
export interface OpenRouteHealthLike {
  /** 返回 { state: { name: 'STOPPED' | ... } }；STOPPED 视为不健康。 */
  healthCheck(): Promise<{ state?: { name?: string } | null } | undefined | null>;
}

/** ModelService 构造选项。 */
export interface ModelServiceOptions {
  /** models.yaml 配置（缺省空，需注入或 reloadConfig）。 */
  readonly config?: ModelsConfig;
  /** 健康状态文件路径（缺省 <repo>/data/model_health_state.json）。 */
  readonly healthStateFile?: string;
  /** HTTP 客户端（缺省 FetchHttpClient）。 */
  readonly http?: HttpLike;
  /** 密钥解析（对齐 secret_store.resolve，缺省取环境变量）。 */
  readonly resolveSecret?: (name: string) => string | undefined;
  /** openroute 服务健康回调（缺省 HTTP 探测 /health）。 */
  readonly openRouteHealth?: OpenRouteHealthLike;
  /** 配置写回回调（对齐 _save_config 写 models.yaml，缺省 no-op）。 */
  readonly onConfigChange?: (config: ModelsConfig) => void;
  /** 当前时间（秒），测试注入。 */
  readonly nowSec?: () => number;
}

/**
 * ModelService — 模型健康检查 + 自动 failover（tools/llm/model_service.py）。
 */
export class ModelService {
  readonly providers: Record<string, Record<string, unknown>> = {};
  models: Array<Record<string, unknown>> = [];
  assignments: Record<string, Record<string, unknown>> = {};
  activeProviders: string[] = [];

  private readonly healthStateFile: string;
  private readonly http: HttpLike;
  private readonly resolveSecret: (name: string) => string | undefined;
  private readonly openRouteHealth: OpenRouteHealthLike | undefined;
  private readonly onConfigChange: (config: ModelsConfig) => void;
  private readonly nowSec: () => number;
  private healthData: Record<string, HealthRecord> = {};

  constructor(options: ModelServiceOptions = {}) {
    this.http = options.http ?? defaultHttp;
    this.resolveSecret = options.resolveSecret ?? ((name) => process.env[name]);
    this.openRouteHealth = options.openRouteHealth;
    this.onConfigChange = options.onConfigChange ?? (() => {});
    this.nowSec = options.nowSec ?? (() => Date.now() / 1000);
    this.healthStateFile =
      options.healthStateFile ??
      joinDataDir('model_health_state.json');
    this.applyConfig(options.config ?? {});
    this.loadHealthState();
    // 断点A修复：恢复"永远可用"的兜底模型状态
    this.restoreAlwaysAvailableModels();
  }

  /** 应用 models 配置（_load_config）。 */
  applyConfig(cfg: ModelsConfig): void {
    Object.assign(this.providers, cfg.providers ?? {});
    this.models = Array.isArray(cfg.models) ? cfg.models : [];
    this.assignments = { ...(cfg.assignments ?? {}) };
    this.activeProviders = Array.isArray(cfg.active_providers)
      ? cfg.active_providers
      : Object.keys(this.providers);
  }

  /** 重新加载配置（reload_config）。 */
  reloadConfig(): void {
    // 插件化：配置通过注入更新，仅保留接口语义
  }

  /** 持久化配置（_save_config，写 models.yaml；插件化后为回调）。 */
  saveConfig(): void {
    this.onConfigChange({
      active_providers: this.activeProviders,
      providers: this.providers,
      models: this.models,
      assignments: this.assignments,
    });
  }

  private loadHealthState(): void {
    if (!existsSync(this.healthStateFile)) {
      this.healthData = {};
      return;
    }
    try {
      const raw = readFileSync(this.healthStateFile, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      this.healthData =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, HealthRecord>)
          : {};
    } catch {
      this.healthData = {};
    }
  }

  private saveHealthState(): void {
    try {
      mkdirSync(dirname(this.healthStateFile), { recursive: true });
      writeFileSync(
        this.healthStateFile,
        JSON.stringify(this.healthData, null, 2),
        'utf-8',
      );
    } catch {
      // 持久化失败不阻断健康检查
    }
  }

  /** 恢复"永远可用"的兜底模型状态（_restore_always_available_models）。 */
  restoreAlwaysAvailableModels(): void {
    let restored = 0;
    for (const m of this.models) {
      const modelId = asString(m['id'], '');
      const provider = asString(m['provider'], '');
      // openrouter 免费模型永远可用（公共 API，无配额限制）
      if (provider === 'openrouter' && modelId.includes(':free')) {
        const modelKey = `${provider}/${modelId}`;
        const existing = this.healthData[modelKey];
        if (existing?.status !== STATUS_AVAILABLE) {
          this.healthData[modelKey] = {
            status: STATUS_AVAILABLE,
            reason: 'always available (openrouter free fallback guarantee)',
            consecutive_failures: 0,
            last_check: new Date().toISOString(),
            last_check_ts: this.nowSec(),
          };
          restored += 1;
        }
      }
    }
    if (restored > 0) {
      this.saveHealthState();
    }
  }

  /** 获取 provider API Key（get_api_key；优先 env，回退 default，再回退 openrouter 同源 env）。 */
  getApiKey(provider: string): string {
    const providerConfig = this.providers[provider] ?? {};
    const apiKeyEnv = asString(providerConfig['api_key_env'], '');
    if (apiKeyEnv.length > 0) {
      const key = this.resolveSecret(apiKeyEnv);
      if (key && key.length > 0) {
        return key;
      }
    }
    const key = this.resolveSecret(`${provider.toUpperCase()}_API_KEY`);
    if (key && key.length > 0) {
      return key;
    }
    return asString(providerConfig['api_key_default'], '');
  }

  private getBaseUrl(provider: string): string {
    const providerConfig = this.providers[provider] ?? {};
    return asString(providerConfig['base_url'], '');
  }

  private resolveModel(modelId: string): Record<string, unknown> | undefined {
    return this.models.find((m) => m['id'] === modelId);
  }

  /** 获取模型 key（provider/model_id 格式，_get_model_key）。 */
  getModelKey(modelId: string): string | undefined {
    const model = this.resolveModel(modelId);
    if (!model) {
      return undefined;
    }
    return `${asString(model['provider'], '')}/${modelId}`;
  }

  /** 单模型健康检查（health_check_single）。 */
  async healthCheckSingle(modelKey: string, force = false): Promise<HealthCheckResult> {
    return this.checkWithCache(modelKey, force);
  }

  /** 全量健康检查（health_check_all）。 */
  async healthCheckAll(force = false): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    const seen = new Set<string>();
    for (const model of this.models) {
      if (model['enabled'] === false) {
        continue;
      }
      const provider = asString(model['provider'], '');
      if (!this.activeProviders.includes(provider)) {
        continue;
      }
      const modelKey = `${provider}/${model['id']}`;
      if (!seen.has(modelKey)) {
        seen.add(modelKey);
        results.push(await this.checkWithCache(modelKey, force));
      }
    }
    for (const assignment of Object.values(this.assignments)) {
      const primary = asString(assignment['primary'], '');
      if (primary.length > 0) {
        const mk = this.getModelKey(primary) ?? primary;
        if (!seen.has(mk)) {
          const provider = mk.includes('/') ? mk.split('/', 1)[0] ?? '' : '';
          if (provider.length === 0 || this.activeProviders.includes(provider)) {
            seen.add(mk);
            results.push(await this.checkWithCache(mk, force));
          }
        }
      }
      for (const fb of asStringArray(assignment['fallbacks'])) {
        const mk = this.getModelKey(fb) ?? fb;
        if (!seen.has(mk)) {
          const provider = mk.includes('/') ? mk.split('/', 1)[0] ?? '' : '';
          if (provider.length === 0 || this.activeProviders.includes(provider)) {
            seen.add(mk);
            results.push(await this.checkWithCache(mk, force));
          }
        }
      }
    }
    return results;
  }

  /** 带缓存的健康检查（_check_with_cache）。 */
  async checkWithCache(modelKey: string, force: boolean): Promise<HealthCheckResult> {
    const state = this.healthData[modelKey] ?? ({} as HealthRecord);
    const now = this.nowSec();

    if (!force && state.status === STATUS_AVAILABLE) {
      const lastCheckTs = state.last_check_ts ?? 0;
      if (now - lastCheckTs < 86400) {
        return {
          model_key: modelKey,
          status: STATUS_AVAILABLE,
          ...(state.last_check !== undefined ? { last_check: state.last_check } : {}),
          latency_ms: state.latency_ms ?? 0,
          cached: true,
        };
      }
    }

    // DISABLED 状态超过冷却期（600s）后重新检查（404 误判可自动恢复）
    if (!force && state.status === STATUS_DISABLED) {
      const lastCheckTs = state.last_check_ts ?? 0;
      const cooldown = ERROR_COOLDOWNS['model_not_found'] ?? 600;
      if (now - lastCheckTs < cooldown) {
        return {
          model_key: modelKey,
          status: STATUS_DISABLED,
          ...(state.last_check !== undefined ? { last_check: state.last_check } : {}),
          reason: state.reason ?? '',
          cached: true,
        };
      }
      state.status = STATUS_UNKNOWN;
    }

    // SUSPENDED：冷却结束前直接返回缓存
    if (!force && state.status === STATUS_SUSPENDED) {
      const suspendedUntilTs = state.suspended_until_ts ?? 0;
      if (now < suspendedUntilTs) {
        return {
          model_key: modelKey,
          status: STATUS_SUSPENDED,
          ...(state.last_check !== undefined ? { last_check: state.last_check } : {}),
          reason: state.reason ?? '',
          ...(state.suspended_until !== undefined
            ? { suspended_until: state.suspended_until }
            : {}),
          cached: true,
        };
      }
    }

    return this.performHealthCheck(modelKey);
  }

  /** 实际健康检查（_perform_health_check）。 */
  async performHealthCheck(modelKey: string): Promise<HealthCheckResult> {
    if (!modelKey.includes('/')) {
      return {
        model_key: modelKey,
        status: STATUS_UNKNOWN,
        reason: 'invalid model_key format',
        cached: false,
      };
    }
    const provider = modelKey.split('/', 1)[0] ?? '';
    const modelId = modelKey.slice(provider.length + 1);

    if (provider === 'openroute') {
      return this.checkOpenrouteHealth(modelKey, modelId);
    }

    const baseUrl = this.getBaseUrl(provider);
    const apiKey = this.getApiKey(provider);

    if (!baseUrl) {
      // base_url 缺失：SUSPENDED（可恢复）
      const suspendedUntil = this.nowSec() + (ERROR_COOLDOWNS['server_error'] ?? 15);
      this.updateHealthState(modelKey, STATUS_SUSPENDED, {
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        suspended_until_ts: suspendedUntil,
        reason: 'missing base_url',
      });
      return {
        model_key: modelKey,
        status: STATUS_SUSPENDED,
        reason: 'missing base_url',
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        cached: false,
      };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    // 健康检查 payload：max_tokens=10 + "Hi"（旧版 ping 会被部分模型拒绝）
    const payload = {
      model: modelId,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10,
    };
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const start = this.nowSec();
    try {
      const resp = await this.http.post(url, { json: payload, headers, timeoutMs: 15000 });
      const latency = (this.nowSec() - start) * 1000;
      const statusCode = resp.status;

      if (statusCode === 200) {
        this.updateHealthState(modelKey, STATUS_AVAILABLE, {
          latency_ms: Math.round(latency * 10) / 10,
        });
        return {
          model_key: modelKey,
          status: STATUS_AVAILABLE,
          latency_ms: Math.round(latency * 10) / 10,
          cached: false,
        };
      }

      // 所有非 200 响应统一 SUSPENDED（可恢复），不再永久 DISABLED
      const [errType, suspendSeconds] = this.classifyError(null, resp.status);
      const suspendedUntil = this.nowSec() + suspendSeconds;
      const reason = `${errType}: HTTP ${statusCode}`;
      this.updateHealthState(modelKey, STATUS_SUSPENDED, {
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        suspended_until_ts: suspendedUntil,
        reason,
      });
      return {
        model_key: modelKey,
        status: STATUS_SUSPENDED,
        reason,
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        cached: false,
      };
    } catch (error) {
      // 所有异常统一 SUSPENDED（可恢复）
      const message = error instanceof Error ? error.message : String(error);
      const errType = classifyErrorMessage(message);
      const suspendSeconds = ERROR_COOLDOWNS[errType] ?? ERROR_COOLDOWNS['unknown'] ?? 30;
      const errorCount = (this.healthData[modelKey]?.error_count ?? 0) + 1;
      const suspendedUntil = this.nowSec() + suspendSeconds;
      this.updateHealthState(modelKey, STATUS_SUSPENDED, {
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        suspended_until_ts: suspendedUntil,
        error_count: errorCount,
        reason: message.slice(0, 200),
      });
      return {
        model_key: modelKey,
        status: STATUS_SUSPENDED,
        reason: message.slice(0, 200),
        cached: false,
      };
    }
  }

  /**
   * openroute 模型健康检查（_check_openroute_health）。
   *
   * 优先用 openRouteHealth 回调（插件注册的服务健康），降级 HTTP 探测
   * /health 端点（3 次重试 + 2s 间隔），再轻量 ping 具体模型。
   */
  async checkOpenrouteHealth(modelKey: string, modelId: string): Promise<HealthCheckResult> {
    let proxyHealthy: boolean | undefined;

    // 优先：通过 openRouteHealth 回调（对齐 plugin_registry 调用）。
    // 回调可用时信任其判定（STOPPED 直接不健康），不再降级 HTTP 探测
    if (this.openRouteHealth !== undefined) {
      try {
        const pluginHealth = await this.openRouteHealth.healthCheck();
        const stateValue = pluginHealth?.state;
        const stateName =
          stateValue?.name !== undefined && stateValue.name.length > 0
            ? stateValue.name.toUpperCase()
            : stateValue !== undefined && stateValue !== null
              ? String(stateValue).toUpperCase()
              : 'UNKNOWN';
        proxyHealthy = stateName !== 'STOPPED' && stateValue !== undefined && stateValue !== null;
      } catch {
        proxyHealthy = false;
      }
    }

    // 降级：无回调或回调不可用时 HTTP 探测 openroute /health 端点（15s 超时 + 3 次重试）
    if (proxyHealthy === undefined) {
      proxyHealthy = false;
      const openrouteCfg = this.providers['openroute'] ?? {};
      const rawBase = asString(
        openrouteCfg['base_url'],
        'http://127.0.0.1:13001/v1',
      ).replace(/\/v1$/, '');
      const probeUrl = `${rawBase.replace(/\/+$/, '')}/health`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const probeResp = await this.http.get(probeUrl, { timeoutMs: 15000 });
          proxyHealthy = probeResp.status === 200;
          if (proxyHealthy) {
            break;
          }
        } catch {
          proxyHealthy = false;
        }
        if (attempt < 2) {
          await sleep(2000);
        }
      }
    }

    if (!proxyHealthy) {
      const suspendedUntil =
        this.nowSec() + (ERROR_COOLDOWNS['server_error'] ?? 15);
      this.updateHealthState(modelKey, STATUS_SUSPENDED, {
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        suspended_until_ts: suspendedUntil,
        reason: 'proxy_service_not_running',
      });
      return {
        model_key: modelKey,
        status: STATUS_SUSPENDED,
        reason: 'proxy_service_not_running',
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        cached: false,
      };
    }

    // 轻量 ping 具体模型
    const openrouteCfg = this.providers['openroute'] ?? {};
    const baseUrl = asString(
      openrouteCfg['base_url'],
      'http://127.0.0.1:13001/v1',
    ).replace(/\/+$/, '');
    let apiKey = asString(openrouteCfg['api_key_default'], '');
    if (!apiKey) {
      const apiKeyEnv = asString(openrouteCfg['api_key_env'], 'OPENROUTE_API_KEY');
      apiKey = this.resolveSecret(apiKeyEnv) ?? '';
    }

    const start = this.nowSec();
    try {
      const payload = {
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.length > 0) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const resp = await this.http.post(
        `${baseUrl}/chat/completions`,
        { json: payload, headers, timeoutMs: 30000 },
      );
      const latency = (this.nowSec() - start) * 1000;
      if (resp.status === 200) {
        this.updateHealthState(modelKey, STATUS_AVAILABLE, {
          latency_ms: Math.round(latency * 10) / 10,
        });
        return {
          model_key: modelKey,
          status: STATUS_AVAILABLE,
          latency_ms: Math.round(latency * 10) / 10,
          cached: false,
        };
      }
      // 所有非 200 统一 SUSPENDED（可恢复）
      const [errType, suspendSeconds] = this.classifyError(null, resp.status);
      const suspendedUntil = this.nowSec() + suspendSeconds;
      const reason = `${errType}: HTTP ${resp.status}`;
      this.updateHealthState(modelKey, STATUS_SUSPENDED, {
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        suspended_until_ts: suspendedUntil,
        reason,
      });
      return {
        model_key: modelKey,
        status: STATUS_SUSPENDED,
        reason,
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        cached: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errType = classifyErrorMessage(message);
      const suspendSeconds = ERROR_COOLDOWNS[errType] ?? ERROR_COOLDOWNS['unknown'] ?? 30;
      const errorCount = (this.healthData[modelKey]?.error_count ?? 0) + 1;
      const suspendedUntil = this.nowSec() + suspendSeconds;
      this.updateHealthState(modelKey, STATUS_SUSPENDED, {
        suspended_until: new Date(suspendedUntil * 1000).toISOString(),
        suspended_until_ts: suspendedUntil,
        error_count: errorCount,
        reason: message.slice(0, 200),
      });
      return {
        model_key: modelKey,
        status: STATUS_SUSPENDED,
        reason: message.slice(0, 200),
        cached: false,
      };
    }
  }

  /**
   * 分类错误并返回 (error_type, suspend_seconds)（_classify_error）。
   * 所有错误类型返回正数 suspend_seconds（可恢复 SUSPENDED），永不永久禁用。
   */
  classifyError(
    error: Error | null,
    statusCode?: number,
  ): [string, number] {
    if (statusCode !== undefined) {
      if (statusCode === 401 || statusCode === 403) {
        return ['no_permission', ERROR_COOLDOWNS['no_permission'] ?? 600];
      }
      if (statusCode === 404) {
        return ['model_not_found', ERROR_COOLDOWNS['model_not_found'] ?? 600];
      }
      if (statusCode === 429) {
        return ['rate_limit', ERROR_COOLDOWNS['rate_limit'] ?? 60];
      }
      if (statusCode >= 500 && statusCode < 600) {
        return ['server_error', ERROR_COOLDOWNS['server_error'] ?? 15];
      }
    }

    if (error !== null) {
      return [classifyErrorMessage(error.message), cooldownFor(error.message)];
    }
    return ['unknown', ERROR_COOLDOWNS['unknown'] ?? 30];
  }

  /** 更新健康状态并持久化（_update_health_state）。 */
  updateHealthState(modelKey: string, status: string, extra: Partial<HealthRecord> = {}): void {
    const record = this.healthData[modelKey] ?? ({} as HealthRecord);
    const prevStatus = record.status ?? 'unknown';
    record.status = status;
    record.last_check = new Date().toISOString();
    record.last_check_ts = this.nowSec();

    if (status === STATUS_AVAILABLE) {
      delete record.suspended_until;
      delete record.suspended_until_ts;
      delete record.reason;
      record.error_count = 0;
      if (extra.latency_ms !== undefined) {
        record.latency_ms = extra.latency_ms;
      }
    } else {
      for (const key of [
        'reason',
        'error_count',
        'latency_ms',
        'suspended_until',
        'suspended_until_ts',
      ] as const) {
        if (extra[key] !== undefined) {
          record[key] = extra[key] as never;
        }
      }
    }
    this.healthData[modelKey] = record;
    void prevStatus;
    this.saveHealthState();
  }

  /** 自动修复模型分配（auto_fix）。 */
  async autoFix(assignmentKey = 'default', cascade = true): Promise<{
    assignment_key: string;
    timestamp: string;
    fixes: Array<Record<string, unknown>>;
    cascade_suggestions: Array<Record<string, unknown>>;
    summary: string;
  }> {
    const report: {
      assignment_key: string;
      timestamp: string;
      fixes: Array<Record<string, unknown>>;
      cascade_suggestions: Array<Record<string, unknown>>;
      summary: string;
    } = {
      assignment_key: assignmentKey,
      timestamp: new Date().toISOString(),
      fixes: [],
      cascade_suggestions: [],
      summary: '',
    };

    const assignment = this.assignments[assignmentKey];
    if (!assignment) {
      report.summary = `Assignment '${assignmentKey}' not found`;
      return report;
    }

    const primary = asString(assignment['primary'], '');
    if (primary.length > 0) {
      const primaryKey = this.getModelKey(primary) ?? primary;
      const health = await this.checkWithCache(primaryKey, true);
      if (health.status !== STATUS_AVAILABLE) {
        let replacement: string | undefined;
        for (const fb of asStringArray(assignment['fallbacks'])) {
          const fbKey = this.getModelKey(fb) ?? fb;
          const fbHealth = await this.checkWithCache(fbKey, true);
          if (fbHealth.status === STATUS_AVAILABLE) {
            replacement = fb;
            break;
          }
        }
        if (!replacement) {
          replacement = await this.findHealthyModel();
        }
        if (replacement) {
          report.fixes.push({
            original_model: primary,
            original_status: health.status,
            replacement_model: replacement,
            source: asStringArray(assignment['fallbacks']).includes(replacement)
              ? 'fallback'
              : 'global',
          });
        }
      }
    }

    if (cascade) {
      const affectedModels = new Set(
        report.fixes.map((f) => asString(f['original_model'], '')),
      );
      for (const [otherKey, otherAssignment] of Object.entries(this.assignments)) {
        if (otherKey === assignmentKey) {
          continue;
        }
        const otherPrimary = asString(otherAssignment['primary'], '');
        if (affectedModels.has(otherPrimary)) {
          report.cascade_suggestions.push({
            assignment_key: otherKey,
            shared_model: otherPrimary,
            suggested_action: 'review_and_update',
          });
        }
        for (const fb of asStringArray(otherAssignment['fallbacks'])) {
          if (affectedModels.has(fb)) {
            report.cascade_suggestions.push({
              assignment_key: otherKey,
              shared_model: fb,
              suggested_action: 'review_and_update',
            });
          }
        }
      }
    }

    const fixedCount = report.fixes.length;
    const cascadeCount = report.cascade_suggestions.length;
    if (fixedCount > 0) {
      report.summary = `Fixed ${fixedCount} model assignment(s)`;
      if (cascadeCount > 0) {
        report.summary += `, ${cascadeCount} affected assignment(s) need review`;
      }
    } else {
      report.summary = 'All models healthy, no fixes needed';
    }
    return report;
  }

  /** 查找健康模型（_find_healthy_model）。 */
  async findHealthyModel(): Promise<string | undefined> {
    for (const model of this.models) {
      if (model['enabled'] === false) {
        continue;
      }
      const modelKey = `${asString(model['provider'], '')}/${model['id']}`;
      const health = await this.checkWithCache(modelKey, false);
      if (health.status === STATUS_AVAILABLE) {
        return asString(model['id'], '') || undefined;
      }
    }
    return undefined;
  }

  /** 获取模型列表（含健康状态，get_models）。 */
  getModels(): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const m of this.models) {
      const provider = asString(m['provider'], '');
      if (!this.activeProviders.includes(provider)) {
        continue;
      }
      const entry = { ...m };
      const modelKey = `${provider}/${m['id']}`;
      const health = this.healthData[modelKey] ?? ({} as HealthRecord);
      entry['health_status'] = health.status ?? STATUS_UNKNOWN;
      entry['last_check'] = health.last_check;
      entry['error_count'] = health.error_count ?? 0;
      entry['reason'] = health.reason ?? '';
      entry['latency_ms'] = health.latency_ms ?? 0;
      result.push(entry);
    }
    return result;
  }

  /** 添加模型（add_model）。 */
  addModel(modelId: string, provider: string, enabled = true, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const existing = this.resolveModel(modelId);
    if (existing) {
      throw new Error(`Model '${modelId}' already exists`);
    }
    if (!this.providers[provider]) {
      throw new Error(`Provider '${provider}' not found`);
    }
    const model: Record<string, unknown> = { id: modelId, provider, enabled, ...extra };
    this.models.push(model);
    this.saveConfig();
    return model;
  }

  /** 移除模型（remove_model）。 */
  removeModel(modelId: string): Record<string, unknown> {
    const index = this.models.findIndex((m) => m['id'] === modelId);
    if (index < 0) {
      throw new Error(`Model '${modelId}' not found`);
    }
    const removed = this.models.splice(index, 1)[0] ?? {};
    const modelKey = `${removed['provider']}/${removed['id']}`;
    delete this.healthData[modelKey];
    this.saveHealthState();
    this.saveConfig();
    return { deleted: modelKey };
  }

  /** 更新模型（update_model）。 */
  updateModel(modelId: string, updates: Record<string, unknown>): Record<string, unknown> {
    const model = this.resolveModel(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found`);
    }
    const oldProvider = asString(model['provider'], '');
    for (const [key, value] of Object.entries(updates)) {
      model[key] = value;
    }
    const newProvider = asString(model['provider'], '');
    if (oldProvider !== newProvider) {
      const oldKey = `${oldProvider}/${modelId}`;
      const newKey = `${newProvider}/${modelId}`;
      if (this.healthData[oldKey]) {
        this.healthData[newKey] = this.healthData[oldKey] as HealthRecord;
        delete this.healthData[oldKey];
        this.saveHealthState();
      }
    }
    this.saveConfig();
    return { ...model };
  }

  /** 获取 providers（get_providers）。 */
  getProviders(): Array<Record<string, unknown>> {
    return Object.entries(this.providers).map(([name, config]) => ({
      name,
      ...config,
    }));
  }

  /** 获取 assignments（get_assignments）。 */
  getAssignments(): Record<string, Record<string, unknown>> {
    return { ...this.assignments };
  }

  /** 更新 assignment（update_assignment）。 */
  updateAssignment(key: string, primary: string, fallbacks: string[] = []): void {
    this.assignments[key] = { primary, fallbacks };
    this.saveConfig();
  }

  /** 健康报告（get_health_report）。 */
  getHealthReport(): {
    models: Array<Record<string, unknown>>;
    summary: Record<string, number>;
  } {
    const models = Object.entries(this.healthData).map(([modelKey, state]) => ({
      model_key: modelKey,
      status: state.status ?? STATUS_UNKNOWN,
      last_check: state.last_check,
      error_count: state.error_count ?? 0,
      reason: state.reason ?? '',
      latency_ms: state.latency_ms ?? 0,
    }));
    return { models, summary: this.getHealthSummary() };
  }

  /** 健康汇总（get_health_summary）。 */
  getHealthSummary(): Record<string, number> {
    const total = Object.keys(this.healthData).length;
    let available = 0;
    let disabled = 0;
    let suspended = 0;
    for (const s of Object.values(this.healthData)) {
      if (s.status === STATUS_AVAILABLE) {
        available += 1;
      } else if (s.status === STATUS_DISABLED) {
        disabled += 1;
      } else if (s.status === STATUS_SUSPENDED) {
        suspended += 1;
      }
    }
    return {
      total,
      available,
      disabled,
      suspended,
      unknown: total - available - disabled - suspended,
    };
  }

  /** 清理过期健康记录（cleanup_health_state）。 */
  cleanupHealthState(days = 30): void {
    const now = this.nowSec();
    const toRemove: string[] = [];
    for (const [modelKey, record] of Object.entries(this.healthData)) {
      if (record.status === STATUS_AVAILABLE) {
        const lastCheckTs = record.last_check_ts ?? 0;
        if (now - lastCheckTs > days * 86400) {
          toRemove.push(modelKey);
        }
      }
    }
    for (const key of toRemove) {
      delete this.healthData[key];
    }
    if (toRemove.length > 0) {
      this.saveHealthState();
    }
  }

  /** 模型候选链（get_model_chain）。 */
  getModelChain(assignmentKey: string): string[] {
    const assignment = this.assignments[assignmentKey] ?? {};
    const primary = asString(assignment['primary'], '');
    const fallbacks = asStringArray(assignment['fallbacks']);
    const chain: string[] = [];
    if (primary.length > 0) {
      const mk = this.getModelKey(primary);
      if (mk) {
        chain.push(mk);
      }
    }
    for (const fb of fallbacks) {
      const mk = this.getModelKey(fb);
      if (mk) {
        chain.push(mk);
      }
    }
    return chain;
  }

  /** 仅含可用模型的 fallback 链（get_available_fallback_chain）。 */
  getAvailableFallbackChain(assignmentKey = 'default'): string[] {
    const chain = this.getModelChain(assignmentKey);
    const available: string[] = [];
    for (const modelKey of chain) {
      const state = this.healthData[modelKey] ?? ({} as HealthRecord);
      const status = state.status ?? STATUS_UNKNOWN;
      if (status === STATUS_AVAILABLE || status === STATUS_UNKNOWN) {
        available.push(modelKey);
      }
    }
    return available;
  }

  /** 记录调用失败（record_call_failure）。 */
  recordCallFailure(modelKey: string, error = ''): {
    model_key: string;
    consecutive_failures: number;
    removed_from_fallback: boolean;
    fallback_now_empty: boolean;
    triggered_force_update: boolean;
  } {
    const record = this.healthData[modelKey] ?? ({} as HealthRecord);
    const failures = (record.consecutive_failures ?? 0) + 1;
    record.consecutive_failures = failures;
    record.last_failure = new Date().toISOString();
    if (error.length > 0) {
      record.last_failure_reason = error.slice(0, 200);
    }

    let removedFromFallback = false;
    let fallbackNowEmpty = false;
    let triggeredForceUpdate = false;

    if (failures >= 3) {
      // P0-28 修复：不再从 fallback 列表移除模型，只标记 suspended
      removedFromFallback = false;
      record.status = STATUS_SUSPENDED;
      record.reason = `consecutive ${failures} failures`;

      for (const assignment of Object.values(this.assignments)) {
        const fallbacks = asStringArray(assignment['fallbacks']);
        const primary = asString(assignment['primary'], '');
        const primaryKey = this.getModelKey(primary) ?? primary;
        const availableFbs = fallbacks.filter((fb) => {
          const fbKey = this.getModelKey(fb) ?? fb;
          const fbState = this.healthData[fbKey] ?? ({} as HealthRecord);
          const fbStatus = fbState.status ?? STATUS_UNKNOWN;
          return fbStatus === STATUS_AVAILABLE || fbStatus === STATUS_UNKNOWN;
        });
        if (availableFbs.length === 0 && (primary.length === 0 || primaryKey === modelKey)) {
          fallbackNowEmpty = true;
          triggeredForceUpdate = true;
        }
      }
    }

    if (triggeredForceUpdate) {
      // 候选链耗尽：触发 force_update 重建健康状态（不等待）
      void this.forceUpdateModels();
    }

    this.healthData[modelKey] = record;
    this.saveHealthState();
    return {
      model_key: modelKey,
      consecutive_failures: failures,
      removed_from_fallback: removedFromFallback,
      fallback_now_empty: fallbackNowEmpty,
      triggered_force_update: triggeredForceUpdate,
    };
  }

  /** 记录调用成功（record_call_success）。 */
  recordCallSuccess(modelKey: string): { model_key: string; consecutive_failures_reset: boolean } {
    const record = this.healthData[modelKey] ?? ({} as HealthRecord);
    record.consecutive_failures = 0;
    record.last_success = new Date().toISOString();
    if (record.status !== STATUS_AVAILABLE) {
      record.status = STATUS_AVAILABLE;
      delete record.reason;
      delete record.suspended_until;
      delete record.suspended_until_ts;
    }
    this.healthData[modelKey] = record;
    this.saveHealthState();
    return { model_key: modelKey, consecutive_failures_reset: true };
  }

  /** 强制更新所有活跃 provider 模型健康状态（force_update_models）。 */
  async forceUpdateModels(): Promise<{
    checked_models: number;
    available_count: number;
    disabled_count: number;
    suspended_count: number;
    fallback_chains_rebuilt: number;
  }> {
    const activeModels = this.models.filter(
      (m) => m['enabled'] !== false && this.activeProviders.includes(asString(m['provider'], '')),
    );
    const providerGroups: Record<string, string[]> = {};
    for (const m of activeModels) {
      const provider = asString(m['provider'], '');
      const mk = `${provider}/${m['id']}`;
      (providerGroups[provider] ??= []).push(mk);
    }

    const allResults: HealthCheckResult[] = [];
    for (const modelKeys of Object.values(providerGroups)) {
      const tasks = modelKeys.map((mk) => this.checkWithCache(mk, true));
      const providerResults = await Promise.allSettled(tasks);
      providerResults.forEach((r, i) => {
        const mk = modelKeys[i] ?? '';
        if (r.status === 'rejected') {
          allResults.push({
            status: STATUS_SUSPENDED,
            reason: String(r.reason).slice(0, 200),
            model_key: mk,
            cached: false,
          });
        } else {
          allResults.push(r.value);
        }
      });
    }

    const availableCount = allResults.filter((r) => r.status === STATUS_AVAILABLE).length;
    const disabledCount = allResults.filter((r) => r.status === STATUS_DISABLED).length;
    const suspendedCount = allResults.filter((r) => r.status === STATUS_SUSPENDED).length;

    // 重建 fallback 链（仅内存，不持久化 — P0-28 修复）
    let chainsRebuilt = 0;
    for (const assignment of Object.values(this.assignments)) {
      const originalFallbacks = asStringArray(assignment['fallbacks']);
      const newFallbacks: string[] = [];
      for (const fb of originalFallbacks) {
        const fbKey = this.getModelKey(fb) ?? fb;
        const provider = fbKey.includes('/') ? (fbKey.split('/', 1)[0] ?? '') : '';
        if (provider.length === 0 || !this.activeProviders.includes(provider)) {
          newFallbacks.push(fb);
          continue;
        }
        const state = this.healthData[fbKey] ?? ({} as HealthRecord);
        const status = state.status ?? STATUS_UNKNOWN;
        if (status === STATUS_AVAILABLE || status === STATUS_UNKNOWN) {
          newFallbacks.push(fb);
        }
      }
      if (newFallbacks.length === 0) {
        const primaryId = asString(assignment['primary'], '');
        for (const m of activeModels) {
          const mk = `${m['provider']}/${m['id']}`;
          const originalKeys = originalFallbacks.map((f) => this.getModelKey(f) ?? f);
          // 排除原 fallback 与当前 primary（primary 不进入自身 fallback 链）
          if (originalKeys.includes(mk) || asString(m['id'], '') === primaryId) {
            continue;
          }
          const state = this.healthData[mk] ?? ({} as HealthRecord);
          if (state.status === STATUS_AVAILABLE || state.status === STATUS_UNKNOWN) {
            newFallbacks.push(asString(m['id'], ''));
          }
        }
      }
      if (!arraysEqual(newFallbacks, originalFallbacks)) {
        assignment['fallbacks'] = newFallbacks;
        chainsRebuilt += 1;
      }
    }

    return {
      checked_models: allResults.length,
      available_count: availableCount,
      disabled_count: disabledCount,
      suspended_count: suspendedCount,
      fallback_chains_rebuilt: chainsRebuilt,
    };
  }

  /** 暴露健康数据快照（测试/诊断）。 */
  getHealthData(): Record<string, HealthRecord> {
    return { ...this.healthData };
  }
}

/** 健康检查结果（对齐 Python 返回 dict 的 key 集合）。 */
export interface HealthCheckResult {
  model_key?: string;
  status: string;
  last_check?: string;
  latency_ms?: number;
  reason?: string;
  suspended_until?: string;
  cached: boolean;
}

/**
 * HealthChecker — 周期模型健康检查 + 自动 failover（core/model_service.py）。
 */
export class HealthChecker {
  private readonly service: ModelService;
  private readonly intervalSeconds: number;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private report: Record<string, unknown> = {};

  constructor(modelService: ModelService, intervalSeconds = 300) {
    this.service = modelService;
    this.intervalSeconds = intervalSeconds;
  }

  /** 启动周期健康检查循环（start）。 */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    // 后台循环：每次检查后等待 interval 再执行下一次
    void this.runLoop();
  }

  /** 停止周期健康检查循环（stop）。 */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** 最近一次健康检查报告（last_report）。 */
  get lastReport(): Record<string, unknown> {
    return { ...this.report };
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.checkAndFailover();
      } catch {
        // 单轮失败不终止循环
      }
      if (!this.running) {
        break;
      }
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, this.intervalSeconds * 1000);
      });
    }
  }

  /** 检查所有模型并自动 failover 不健康者（_check_and_failover）。 */
  async checkAndFailover(): Promise<Record<string, unknown>> {
    const results = await this.service.healthCheckAll(true);

    const unhealthyModels = results.filter(
      (r) => r.status !== STATUS_AVAILABLE,
    );

    const failovers: Array<Record<string, unknown>> = [];
    for (const result of unhealthyModels) {
      const modelKey = result.model_key ?? '';
      if (modelKey.length === 0) {
        continue;
      }
      const affected = this.findAffectedAssignments(modelKey);
      for (const [assignmentKey, subKey] of affected) {
        const fix = await this.autoFailover(assignmentKey, subKey, modelKey);
        if (fix) {
          failovers.push(fix);
        }
      }
    }

    const report: Record<string, unknown> = {
      checked: results.length,
      unhealthy: unhealthyModels.length,
      failovers,
    };
    this.report = report;
    return report;
  }

  /** 查找使用该模型作为 primary 的 (assignment_key, sub_key) 列表（_find_affected_assignments）。 */
  findAffectedAssignments(modelKey: string): Array<[string, string | null]> {
    const affected: Array<[string, string | null]> = [];
    const modelId = modelKey.includes('/')
      ? (modelKey.split('/').pop() ?? modelKey)
      : modelKey;
    for (const [assignmentKey, assignmentVal] of Object.entries(this.service.assignments)) {
      if (!isRecordLike(assignmentVal)) {
        continue;
      }
      // 嵌套：assignment_key -> { sub_key -> { primary, fallbacks } }
      const firstVal = Object.values(assignmentVal)[0];
      if (isRecordLike(firstVal) && 'primary' in firstVal) {
        for (const [subKey, cfg] of Object.entries(assignmentVal)) {
          if (!isRecordLike(cfg)) {
            continue;
          }
          const primary = asString(cfg['primary'], '');
          if (primary === modelId || primary === modelKey) {
            affected.push([assignmentKey, subKey]);
          }
        }
      } else {
        // 扁平：assignment_key -> { primary, fallbacks }
        const primary = asString(assignmentVal['primary'], '');
        if (primary === modelId || primary === modelKey) {
          affected.push([assignmentKey, null]);
        }
      }
    }
    return affected;
  }

  /** 单个 assignment 的 failover（_auto_failover）。 */
  async autoFailover(
    assignmentKey: string,
    subKey: string | null,
    failedModelKey: string,
  ): Promise<Record<string, unknown> | undefined> {
    const assignmentVal = this.service.assignments[assignmentKey] ?? {};
    const agentCfg = subKey !== null ? assignmentVal[subKey] : assignmentVal;
    if (!isRecordLike(agentCfg)) {
      return undefined;
    }

    const fallbacks = asStringArray(agentCfg['fallbacks']);
    for (const fb of fallbacks) {
      const fbKey = this.service.getModelKey(fb) ?? fb;
      const health = await this.service.healthCheckSingle(fbKey, true);
      if (health.status === STATUS_AVAILABLE) {
        const oldPrimary = asString(agentCfg['primary'], '');
        agentCfg['primary'] = fb;
        const fallbacksWithoutFb = fallbacks.filter((f) => f !== fb);
        if (!fallbacksWithoutFb.includes(oldPrimary)) {
          fallbacksWithoutFb.unshift(oldPrimary);
        }
        agentCfg['fallbacks'] = fallbacksWithoutFb;
        this.service.saveConfig();
        return {
          assignment_key: assignmentKey,
          sub_key: subKey,
          old_primary: oldPrimary,
          new_primary: fb,
          reason: `model ${failedModelKey} unhealthy`,
        };
      }
    }

    const replacement = await this.service.findHealthyModel();
    if (replacement) {
      const oldPrimary = asString(agentCfg['primary'], '');
      agentCfg['primary'] = replacement;
      const fallbackList = asStringArray(agentCfg['fallbacks']);
      if (!fallbackList.includes(oldPrimary)) {
        fallbackList.unshift(oldPrimary);
        agentCfg['fallbacks'] = fallbackList;
      }
      this.service.saveConfig();
      return {
        assignment_key: assignmentKey,
        sub_key: subKey,
        old_primary: oldPrimary,
        new_primary: replacement,
        reason: `model ${failedModelKey} unhealthy, no fallback available`,
        source: 'global',
      };
    }

    return undefined;
  }
}

/** 默认 HTTP 客户端（FetchHttpClient，注入缺省时使用）。 */
const defaultHttp: HttpLike = new FetchHttpClient();

function classifyErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('connection')) {
    return 'timeout';
  }
  for (const [errType, patterns] of Object.entries(ERROR_TYPE_MAP)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return errType;
      }
    }
  }
  return 'unknown';
}

function cooldownFor(message: string): number {
  const errType = classifyErrorMessage(message);
  return ERROR_COOLDOWNS[errType] ?? ERROR_COOLDOWNS['unknown'] ?? 30;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === 'string');
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 定位包内 data 目录（缺省健康状态文件位置）。 */
function joinDataDir(fileName: string): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return `${here}data/${fileName}`;
}
