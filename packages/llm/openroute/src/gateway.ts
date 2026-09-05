/**
 * OpenRoute 网关共享层 — 配置解析 + 带重试的 chat/completions 调用。
 *
 * TS 移植自三个 proxy（forgemind/{anthropic,gemini,responses}_to_openroute_proxy.py）
 * 中重复的 HTTP 客户端段（call_openroute / INVALID_RESPONSE_PATTERNS / FALLBACK_MODELS），
 * 以及 openroute_adapter.py 的环境变量优先级解析；trae-bridge operator.ts 为先例参考。
 *
 * 行为基线（对齐 Python）：
 *   - OpenRoute 的 stream 实现有 bug（返回非 SSE JSON），因此**总是以 stream:false 调用**，
 *     由各 proxy 把完整响应在本地切分为 SSE 事件流（CHUNK_SIZE=64）。
 *   - 沉默失败检测：内容为空/过短（<2 字符）或命中 INVALID_RESPONSE_PATTERNS 视为无效，
 *     自动按 FALLBACK_MODELS 顺序重试，最多 3 次。
 *   - 环境变量优先级：FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL > OPENROUTE_BASE_URL >
 *     默认 http://localhost:13001；API key：FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY >
 *     OPENROUTE_API_KEY > ''。
 */

/** fetch 注入（测试用；默认全局 fetch，结构与全局 fetch Response 兼容） */
export type OpenrouteFetchFn = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal | undefined;
  },
) => Promise<OpenrouteFetchResponse>;

/** fetch 响应最小结构（与全局 fetch Response 兼容） */
export interface OpenrouteFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** 默认 fetch 注入 */
export const defaultOpenrouteFetch: OpenrouteFetchFn = async (url, init) =>
  await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });

/** 环境变量字典（测试注入用） */
export type OpenrouteEnv = Record<string, string | undefined>;

export interface OpenrouteGatewayConfig {
  /** 规范化后的 OpenRoute 网关基础 URL（尾部 / 与 /v1 已剥离） */
  readonly baseUrl: string;
  /** Bearer API key（可为空串） */
  readonly apiKey: string;
  /** 各 proxy 的默认 OpenRoute 模型 */
  readonly defaultModel: string;
}

/**
 * 解析网关配置（对齐 openroute_adapter.py / 各 proxy 的 env 优先级）。
 *
 * @param opts.defaultModel - 网关默认模型（各 proxy 有独立 env 与缺省值）
 * @param opts.baseUrlOverride - 显式覆盖（等价 Python CLI --openroute-base）
 * @param opts.apiKeyOverride - 显式覆盖（等价 --openroute-key）
 */
export function resolveOpenrouteGatewayConfig(
  env: OpenrouteEnv,
  opts: {
    readonly defaultModel: string;
    readonly baseUrlOverride?: string | undefined;
    readonly apiKeyOverride?: string | undefined;
  },
): OpenrouteGatewayConfig {
  const rawBase =
    opts.baseUrlOverride
    ?? env['FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL']
    ?? env['OPENROUTE_BASE_URL']
    ?? 'http://localhost:13001/v1';
  const apiKey =
    opts.apiKeyOverride
    ?? env['FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY']
    ?? env['OPENROUTE_API_KEY']
    ?? '';
  return {
    baseUrl: normalizeOpenrouteBaseUrl(rawBase),
    apiKey,
    defaultModel: opts.defaultModel,
  };
}

/** 规范化 base URL：剥离尾部 `/` 与 `/v1`，统一由 chatEndpoint 拼接 */
export function normalizeOpenrouteBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** chat/completions 端点 */
export function openrouteChatEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/chat/completions`;
}

/** 沉默失败模式（对齐三个 proxy 的 INVALID_RESPONSE_PATTERNS） */
export const INVALID_RESPONSE_PATTERNS: readonly string[] = [
  '无法回答',
  '当前不可用，请稍后重试',
  '当前不可用,请稍后重试',
  '我无法回答',
  '我不能回答',
  '我无法提供',
  '我无法完成',
];

/** 重试时的 fallback 模型序列（对齐三个 proxy 的 FALLBACK_MODELS） */
export const FALLBACK_MODELS: readonly string[] = [
  'Doubao-Seed2.0',
  'Kimi-K2.6',
  'DeepSeek-V4-Pro',
  'auto',
];

/** 检测 LLM 响应是否为无效的沉默失败内容（对齐 _is_invalid_response） */
export function isInvalidOpenrouteResponse(content: string): boolean {
  if (!content || content.trim().length < 2) {
    return true;
  }
  const stripped = content.trim();
  for (const pattern of INVALID_RESPONSE_PATTERNS) {
    if (stripped.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/** 从 OpenAI chat/completions 响应提取首个 choice 的文本 content */
export function extractFirstChoiceContent(data: Record<string, unknown>): string {
  const choices = Array.isArray(data['choices'])
    ? (data['choices'] as Array<Record<string, unknown>>)
    : [];
  const first = choices[0];
  if (first === undefined || typeof first !== 'object') {
    return '';
  }
  const message =
    typeof first['message'] === 'object' && first['message'] !== null
      ? (first['message'] as Record<string, unknown>)
      : {};
  return typeof message['content'] === 'string' ? message['content'] : '';
}

export interface OpenrouteCallResult {
  /** 上游 HTTP 状态码 */
  readonly status: number;
  /** 是否 200 */
  readonly ok: boolean;
  /** 响应 JSON（仅 200 时可靠；解析失败为 undefined） */
  readonly data: Record<string, unknown> | undefined;
  /** 原始响应文本（截断至 500 字符，用于错误回传） */
  readonly text: string;
  /** 实际使用的模型（重试时可能切换为 fallback） */
  readonly model: string;
  /** 实际尝试次数 */
  readonly attempts: number;
}

export interface OpenrouteCallOptions {
  readonly fetchFn?: OpenrouteFetchFn | undefined;
  /** 单次上游调用超时毫秒（对齐 Python httpx timeout=180.0） */
  readonly timeoutMs?: number | undefined;
  readonly logger?: { info(msg: string): void; warn(msg: string): void } | undefined;
}

/**
 * 调用 OpenRoute chat/completions（带重试 + fallback 模型 + 沉默失败检测）。
 *
 * 对齐 call_openroute：最多 3 次；attempt=1 用请求模型，attempt≥2 按 FALLBACK_MODELS
 * 顺序切换；非 200 或无效内容继续重试，最后一次直接返回；网络异常重试耗尽后抛出。
 */
export async function callOpenrouteChat(
  gateway: OpenrouteGatewayConfig,
  body: Record<string, unknown>,
  opts: OpenrouteCallOptions = {},
): Promise<OpenrouteCallResult> {
  const fetchFn = opts.fetchFn ?? defaultOpenrouteFetch;
  const logger = opts.logger ?? { info: () => {}, warn: () => {} };
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const endpoint = openrouteChatEndpoint(gateway.baseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${gateway.apiKey}`,
    'Content-Type': 'application/json',
  };

  const originalModel =
    typeof body['model'] === 'string' && body['model'] !== '' ? body['model'] : gateway.defaultModel;
  let last: { status: number; ok: boolean; data: Record<string, unknown> | undefined; text: string; model: string; attempts: number } | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // 模型选择：attempt=1 用原模型，attempt≥2 切换 fallback（对齐 min(attempt-2, len-1)）
    let model = originalModel;
    if (attempt > 1) {
      const fallbackIdx = Math.min(attempt - 2, FALLBACK_MODELS.length - 1);
      model = FALLBACK_MODELS[fallbackIdx] ?? gateway.defaultModel;
      logger.info(`Retry ${attempt}/3 with fallback model: ${model}`);
    }

    const requestBody = { ...body, model, stream: false };
    let resp: OpenrouteFetchResponse;
    try {
      resp = await fetchFn(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      logger.warn(`OpenRoute call failed (attempt ${attempt}): ${String(error)}`);
      if (attempt < 3) {
        continue;
      }
      throw error;
    }

    const fullText = await resp.text();
    const candidate = {
      status: resp.status,
      ok: resp.ok,
      data: undefined as Record<string, unknown> | undefined,
      text: fullText.slice(0, 500),
      model,
      attempts: attempt,
    };

    if (resp.status !== 200) {
      logger.warn(`OpenRoute returned ${resp.status} (attempt ${attempt})`);
      last = candidate;
      if (attempt < 3) {
        continue;
      }
      return candidate;
    }

    // 200：解析并检测沉默失败
    try {
      const parsed: unknown = JSON.parse(fullText);
      if (typeof parsed === 'object' && parsed !== null) {
        candidate.data = parsed as Record<string, unknown>;
      }
    } catch {
      // JSON 解析失败视为无效内容（对齐 Python except: pass 后返回响应）
    }
    const content = candidate.data !== undefined ? extractFirstChoiceContent(candidate.data) : '';
    if (isInvalidOpenrouteResponse(content)) {
      logger.warn(`Invalid response from ${model} (attempt ${attempt}): ${content.slice(0, 50)}`);
      last = candidate;
      if (attempt < 3) {
        continue;
      }
      return candidate;
    }

    return candidate;
  }

  // 防御性兜底：循环必然在内部返回（理论不可达）
  return (
    last ?? {
      status: 503,
      ok: false,
      data: undefined,
      text: 'All retry attempts failed',
      model: originalModel,
      attempts: 3,
    }
  );
}
