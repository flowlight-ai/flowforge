/**
 * OpenRoute LLM 客户端适配器（TS 移植自 `forgemind/openroute_adapter.py`）。
 *
 * 当 Trae CN 桥接不可用（Trae CN IDE 未运行、trae_bridge 目录无响应）时，
 * ForgekinBase.chat() 需要一个兼容的 LLM 客户端保证群聊功能可用。
 * 本适配器直接调用 OpenRoute 网关的 /v1/chat/completions（默认 13001 端口），
 * 返回与 TraeLLMClient.chat() 一致的字典结构。
 *
 * 行为基线（对齐 Python，与 gateway 的 proxy 重试层不同——适配器**不重试**）：
 *   - 配置优先级：FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL > OPENROUTE_BASE_URL >
 *     默认 http://localhost:13001；key 同理；模型 FLOWFORGE_FORGEMIND_OPENROUTE_MODEL
 *     > 默认 openai/gpt-4o-mini。
 *   - 缺省参数：temperature 0.7 / max_tokens 2000 / timeout 90s。
 *   - 错误以结果字典返回（不抛出）：HTTP 非 200 / 超时 / 异常各有一个 content 前缀
 *     与 error 字段。
 */

import {
  defaultOpenrouteFetch,
  normalizeOpenrouteBaseUrl,
  openrouteChatEndpoint,
  type OpenrouteEnv,
  type OpenrouteFetchFn,
} from './gateway.ts';

/** 静默 logger（测试注入用） */
const silentLogger = {
  info: (_msg: string): void => {},
  warn: (_msg: string): void => {},
};

export interface OpenrouteClientOptions {
  readonly env?: OpenrouteEnv | undefined;
  /** 显式覆盖 baseUrl（等价 Python __init__ 直改 _base_url） */
  readonly baseUrlOverride?: string | undefined;
  readonly apiKeyOverride?: string | undefined;
  readonly modelOverride?: string | undefined;
  readonly fetchFn?: OpenrouteFetchFn | undefined;
  readonly logger?: { info(msg: string): void; warn(msg: string): void } | undefined;
}

/** chat() 输入消息（OpenAI 格式） */
export interface OpenrouteChatMessage {
  readonly role: string;
  readonly content: string;
}

/** chat() 可选参数（对齐 Python **kwargs） */
export interface OpenrouteChatArgs {
  readonly messages: readonly OpenrouteChatMessage[];
  /** 会话 ID（仅记录，不用于 OpenRoute 调用） */
  readonly sessionId?: string | undefined;
  readonly model?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  /** 单次调用超时毫秒（Python 缺省 90s） */
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** chat() 结果字典（与 TraeLLMClient.chat() 兼容的契约） */
export interface OpenrouteChatResult {
  readonly content: string;
  readonly model: string;
  readonly provider: 'openroute';
  readonly usage: {
    readonly latency_ms: number;
    readonly input_tokens?: number | undefined;
    readonly output_tokens?: number | undefined;
    readonly error?: boolean;
  };
  readonly session_id: string;
  readonly forgekin_id: '';
  readonly error?: string;
}

export class OpenRouteLlmClient {
  readonly baseUrl: string;
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly fetchFn: OpenrouteFetchFn;
  private readonly logger: { info(msg: string): void; warn(msg: string): void };

  constructor(options: OpenrouteClientOptions = {}) {
    const env = options.env ?? process.env;
    this.baseUrl = normalizeOpenrouteBaseUrl(
      options.baseUrlOverride
      ?? env['FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL']
      ?? env['OPENROUTE_BASE_URL']
      ?? 'http://localhost:13001',
    );
    this.apiKey =
      options.apiKeyOverride
      ?? env['FLOWFORGE_LLM_ROUTE_OPENROUTE_API_KEY']
      ?? env['OPENROUTE_API_KEY']
      ?? '';
    this.defaultModel =
      options.modelOverride ?? env['FLOWFORGE_FORGEMIND_OPENROUTE_MODEL'] ?? 'openai/gpt-4o-mini';
    this.fetchFn = options.fetchFn ?? defaultOpenrouteFetch;
    this.logger = options.logger ?? silentLogger;
    this.logger.info(
      `OpenRouteLlmClient 已初始化（base_url=${this.baseUrl}, model=${this.defaultModel}）`,
    );
  }

  /** 调用 OpenRoute LLM，返回兼容字典。错误以结果返回，不抛出。 */
  async chat(args: OpenrouteChatArgs): Promise<OpenrouteChatResult> {
    const model = args.model ?? this.defaultModel;
    const temperature = args.temperature ?? 0.7;
    const maxTokens = args.maxTokens ?? 2000;
    const timeoutMs = args.timeoutMs ?? 90_000;
    const sessionId = args.sessionId ?? '';

    const payload = {
      model,
      messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
    };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey !== '') {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const start = Date.now();
    const errorResult = (content: string, error: string): OpenrouteChatResult => ({
      content,
      model,
      provider: 'openroute',
      usage: { latency_ms: Date.now() - start, error: true },
      session_id: sessionId,
      forgekin_id: '',
      error,
    });

    let raw: string;
    try {
      const signal = args.signal !== undefined
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), args.signal])
        : AbortSignal.timeout(timeoutMs);
      const resp = await this.fetchFn(openrouteChatEndpoint(this.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
      args.signal?.throwIfAborted();
      const latencyMs = Date.now() - start;

      if (resp.status !== 200) {
        const errText = (await resp.text()).slice(0, 300);
        this.logger.warn(
          `OpenRoute HTTP ${resp.status}: latency=${latencyMs}ms err=${errText}`,
        );
        return errorResult(`[OpenRoute HTTP ${resp.status}] ${errText}`, `HTTP ${resp.status}: ${errText}`);
      }

      raw = await resp.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return errorResult('[OpenRoute 异常] SyntaxError: response is not JSON', 'response is not JSON');
      }

      const choices = Array.isArray(data['choices'])
        ? (data['choices'] as Array<unknown>)
        : [];
      let content = '';
      const first = choices[0];
      if (typeof first === 'object' && first !== null) {
        const msg =
          typeof (first as Record<string, unknown>)['message'] === 'object'
          && (first as Record<string, unknown>)['message'] !== null
            ? ((first as Record<string, unknown>)['message'] as Record<string, unknown>)
            : {};
        content = typeof msg['content'] === 'string' ? msg['content'] : '';
      }
      const usage =
        typeof data['usage'] === 'object' && data['usage'] !== null
          ? (data['usage'] as Record<string, unknown>)
          : {};

      this.logger.info(
        `OpenRoute chat OK: model=${model}, latency=${latencyMs}ms, len=${content.length}`,
      );
      return {
        content,
        model: typeof data['model'] === 'string' ? data['model'] : model,
        provider: 'openroute',
        usage: {
          latency_ms: latencyMs,
          input_tokens: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0,
          output_tokens:
            typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0,
        },
        session_id: sessionId,
        forgekin_id: '',
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const isTimeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      if (isTimeout) {
        this.logger.warn(`OpenRoute timeout: latency=${latencyMs}ms`);
        return errorResult(`[OpenRoute 超时] ${String(error)}`, `timeout: ${String(error)}`);
      }
      this.logger.warn(`OpenRoute chat 异常: latency=${latencyMs}ms, ${String(error)}`);
      const name = error instanceof Error ? error.name : typeof error;
      return errorResult(`[OpenRoute 异常] ${name}: ${String(error)}`, String(error));
    }
  }
}
