/**
 * @flowforge/forgekin-trae-bridge — 配置（TS 移植自 `llm/trae/config.py`）
 *
 * 两个配置域：
 *   - TraeBridgeConfig：桥接协议配置（目录/超时/归档，对应 config/trae-bridge.yaml）
 *   - TraeClientConfig：LLM 客户端配置（mode/默认模型/会话持久化，对齐 Python TraeConfig 精简子集）
 *
 * 不变量 6（路径不硬编码）：
 *   - ${ENV_VAR:default} 占位符展开（正则 /\$\{([^}]+)\}/）
 *   - FLOWFORGE_BRIDGE_* 环境变量覆盖（优先级高于 YAML，对齐 pydantic-settings env_prefix）
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** 桥接共享目录默认值：锚定进程工作目录的 .trae_bridge（可用 FLOWFORGE_BRIDGE_DIR 覆盖） */
export function defaultSharedDir(): string {
  return path.join(process.cwd(), '.trae_bridge');
}

/** Trae 桥接协议配置 — F045 §2.2 + §2.3 不变量（对应 trae_bridge.yaml bridge 段） */
export interface TraeBridgeConfig {
  /** 是否启用桥接（false 时 chat 直接抛 TraeBridgeConfigError） */
  enabled: boolean;
  /** 共享目录路径（默认工作目录 .trae_bridge） */
  shared_dir: string;
  /** 请求文件子目录名（request_{uuid}.json） */
  requests_dir: string;
  /** 响应文件子目录名（response_{uuid}.json） */
  responses_dir: string;
  /** 取消文件子目录名（不变量 8 逃生舱） */
  cancels_dir: string;
  /** 确认文件子目录名（可选） */
  acks_dir: string;
  /** 归档子目录名（不变量 4 不丢数据） */
  archive_dir: string;
  /** 轮询响应文件间隔秒数（最小 0.5） */
  poll_interval_seconds: number;
  /** 默认超时秒数（5 分钟） */
  default_timeout_seconds: number;
  /** 长任务超时秒数（30 分钟，文档生成等） */
  long_task_timeout_seconds: number;
  /** 等待 operator ack 的超时秒数（0=不等待） */
  ack_timeout_seconds: number;
  /** 完成的请求是否归档到 archive/ */
  archive_completed: boolean;
  /** 归档目录最大文件数（超过自动清理最旧） */
  max_archive_files: number;
  /** 启动时清理遗留 pending 请求（标记为 timeout） */
  cleanup_on_startup: boolean;
  /** 写入 request 时是否更新 status.json */
  update_status_on_write: boolean;
  /** 完成响应时是否更新 status.json */
  update_status_on_complete: boolean;
  /** 是否启用流式响应（预留） */
  stream_enabled: boolean;
  /** 流式轮询间隔秒数 */
  stream_chunk_interval: number;
  /** 初始化时检查目录可写性 */
  health_check_on_init: boolean;
}

/** 创建默认桥接配置（空 shared_dir 回退默认值，对齐 Python _validate_shared_dir） */
export function makeTraeBridgeConfig(
  overrides: Partial<TraeBridgeConfig> = {},
): TraeBridgeConfig {
  const sharedDir = (overrides.shared_dir ?? '').trim() || defaultSharedDir();
  return {
    enabled: true,
    requests_dir: 'requests',
    responses_dir: 'responses',
    cancels_dir: 'cancels',
    acks_dir: 'acks',
    archive_dir: 'archive',
    poll_interval_seconds: 2.0,
    default_timeout_seconds: 300,
    long_task_timeout_seconds: 1800,
    ack_timeout_seconds: 60,
    archive_completed: true,
    max_archive_files: 1000,
    cleanup_on_startup: false,
    update_status_on_write: true,
    update_status_on_complete: true,
    stream_enabled: false,
    stream_chunk_interval: 0.5,
    health_check_on_init: true,
    ...overrides,
    shared_dir: sharedDir,
  };
}

// ── 路径派生（对齐 Python properties）─────────────────────────────

export function requestsPath(config: TraeBridgeConfig): string {
  return path.join(config.shared_dir, config.requests_dir);
}

export function responsesPath(config: TraeBridgeConfig): string {
  return path.join(config.shared_dir, config.responses_dir);
}

export function cancelsPath(config: TraeBridgeConfig): string {
  return path.join(config.shared_dir, config.cancels_dir);
}

export function acksPath(config: TraeBridgeConfig): string {
  return path.join(config.shared_dir, config.acks_dir);
}

export function archivePath(config: TraeBridgeConfig): string {
  return path.join(config.shared_dir, config.archive_dir);
}

export function statusFilePath(config: TraeBridgeConfig): string {
  return path.join(config.shared_dir, 'status.json');
}

// ── YAML 加载 ─────────────────────────────────────────────────────

const ENV_PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

/** 展开 ${ENV_VAR:default} 占位符（不变量 6；无冒号时缺省为空串） */
export function expandEnvPlaceholders(
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return raw.replaceAll(ENV_PLACEHOLDER_RE, (_match, expr: string) => {
    const colon = expr.indexOf(':');
    if (colon >= 0) {
      const envKey = expr.slice(0, colon).trim();
      const fallback = expr.slice(colon + 1).trim();
      return env[envKey] ?? fallback;
    }
    return env[expr.trim()] ?? '';
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * 从 trae_bridge.yaml 加载桥接配置.
 *
 * - 文件不存在 → 返回默认配置（对齐 Python load_from_yaml FileNotFoundError 分支）
 * - 支持 ${ENV_VAR:default} 占位符展开
 * - FLOWFORGE_BRIDGE_* 环境变量优先级高于 YAML
 */
export async function loadTraeBridgeConfigFromYaml(
  yamlPath: string,
  options: { env?: Record<string, string | undefined> | undefined } = {},
): Promise<TraeBridgeConfig> {
  const env = options.env ?? process.env;
  let raw: string;
  try {
    raw = await readFile(yamlPath, 'utf-8');
  } catch {
    return makeTraeBridgeConfig();
  }

  const expanded = expandEnvPlaceholders(raw, env);
  let data: unknown;
  try {
    data = parseYaml(expanded);
  } catch {
    data = {};
  }
  const bridge = asRecord(asRecord(data)['bridge']);

  const overrides: Partial<TraeBridgeConfig> = {};
  const assign = (
    key: keyof TraeBridgeConfig,
    value: unknown,
    kind: 'bool' | 'num' | 'str',
  ): void => {
    if (value === undefined || value === null) {
      return;
    }
    if (kind === 'bool' && typeof value === 'boolean') {
      overrides[key] = value as never;
    } else if (kind === 'num' && typeof value === 'number' && Number.isFinite(value)) {
      overrides[key] = value as never;
    } else if (kind === 'str' && typeof value === 'string') {
      overrides[key] = value as never;
    }
  };

  assign('enabled', bridge['enabled'], 'bool');
  assign('shared_dir', bridge['shared_dir'], 'str');
  assign('requests_dir', bridge['requests_dir'], 'str');
  assign('responses_dir', bridge['responses_dir'], 'str');
  assign('cancels_dir', bridge['cancels_dir'], 'str');
  assign('acks_dir', bridge['acks_dir'], 'str');
  assign('archive_dir', bridge['archive_dir'], 'str');
  assign('poll_interval_seconds', bridge['poll_interval_seconds'], 'num');
  assign('default_timeout_seconds', bridge['default_timeout_seconds'], 'num');
  assign('long_task_timeout_seconds', bridge['long_task_timeout_seconds'], 'num');
  assign('ack_timeout_seconds', bridge['ack_timeout_seconds'], 'num');
  assign('archive_completed', bridge['archive_completed'], 'bool');
  assign('max_archive_files', bridge['max_archive_files'], 'num');
  assign('cleanup_on_startup', bridge['cleanup_on_startup'], 'bool');
  assign('update_status_on_write', bridge['update_status_on_write'], 'bool');
  assign('update_status_on_complete', bridge['update_status_on_complete'], 'bool');
  assign('stream_enabled', bridge['stream_enabled'], 'bool');
  assign('stream_chunk_interval', bridge['stream_chunk_interval'], 'num');
  assign('health_check_on_init', bridge['health_check_on_init'], 'bool');

  // 环境变量优先级高于 YAML（对齐 pydantic-settings env_prefix FLOWFORGE_BRIDGE_）
  const envSharedDir = env['FLOWFORGE_BRIDGE_SHARED_DIR'] ?? env['FLOWFORGE_BRIDGE_DIR'];
  if (envSharedDir !== undefined && envSharedDir.trim() !== '') {
    overrides.shared_dir = envSharedDir;
  }
  const envPoll = env['FLOWFORGE_BRIDGE_POLL_INTERVAL'];
  if (envPoll !== undefined && envPoll.trim() !== '') {
    const parsed = Number.parseFloat(envPoll);
    if (Number.isFinite(parsed)) {
      overrides.poll_interval_seconds = parsed;
    }
  }
  const envTimeout = env['FLOWFORGE_BRIDGE_TIMEOUT'];
  if (envTimeout !== undefined && envTimeout.trim() !== '') {
    const parsed = Number.parseInt(envTimeout, 10);
    if (Number.isFinite(parsed)) {
      overrides.default_timeout_seconds = parsed;
    }
  }
  const envLongTimeout = env['FLOWFORGE_BRIDGE_LONG_TASK_TIMEOUT'];
  if (envLongTimeout !== undefined && envLongTimeout.trim() !== '') {
    const parsed = Number.parseInt(envLongTimeout, 10);
    if (Number.isFinite(parsed)) {
      overrides.long_task_timeout_seconds = parsed;
    }
  }
  const envEnabled = env['FLOWFORGE_BRIDGE_ENABLED'];
  if (envEnabled !== undefined && envEnabled.trim() !== '') {
    overrides.enabled = envEnabled.trim().toLowerCase() === 'true';
  }

  return makeTraeBridgeConfig(overrides);
}

// ── TraeClientConfig — LLM 客户端配置（对齐 Python TraeConfig 精简子集）──

/** 客户端工作模式（当前仅 bridge 完整实现；cli/api 预留） */
export type TraeClientMode = 'bridge' | 'cli' | 'api';

/** Trae LLM 客户端配置（mode/默认模型/会话持久化等） */
export interface TraeClientConfig {
  /** 工作模式: cli | bridge | api */
  mode: TraeClientMode;
  /** 默认模型名 */
  default_model: string;
  /** 是否保持会话上下文 */
  session_persistence: boolean;
  /** 最大重试次数 */
  max_retries: number;
  /** 单次调用超时秒数 */
  timeout: number;
  /** API 模式的 URL（预留） */
  api_url: string;
  /** API 模式的 key（预留） */
  api_key: string;
}

const VALID_CLIENT_MODES = new Set<string>(['cli', 'bridge', 'api']);

/** 创建客户端配置（非法 mode 抛错，对齐 Python _validate_mode） */
export function makeTraeClientConfig(
  overrides: Partial<TraeClientConfig> = {},
): TraeClientConfig {
  const mode = overrides.mode ?? 'bridge';
  if (!VALID_CLIENT_MODES.has(mode)) {
    throw new TypeError(`mode 必须是 cli/bridge/api 之一，得到: ${mode}`);
  }
  return {
    mode,
    default_model: overrides.default_model ?? 'trae',
    session_persistence: overrides.session_persistence ?? true,
    max_retries: overrides.max_retries ?? 3,
    timeout: overrides.timeout ?? 120,
    api_url: overrides.api_url ?? '',
    api_key: overrides.api_key ?? '',
  };
}
