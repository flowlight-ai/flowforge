/**
 * @flowforge/llm-openroute — OpenRoute 网关客户端与三协议转换代理 Cordis 插件。
 *
 * TS 移植自 forgemind 四个 Python 模块：
 *   - openroute_adapter.py        → src/adapter.ts（OpenRouteLlmClient，ForgekinBase 兜底 LLM 客户端）
 *   - anthropic_to_openroute_proxy.py → src/anthropic-proxy.ts（Claude CLI → OpenRoute）
 *   - gemini_to_openroute_proxy.py    → src/gemini-proxy.ts（Gemini CLI → OpenRoute）
 *   - responses_to_openroute_proxy.py → src/responses-proxy.ts（Codex CLI → OpenRoute）
 *
 * 插件化改造决策（对照 Python 直起 uvicorn 监听固定端口）：
 *   - 纯函数层不依赖 Cordis；HTTP 挂载导出 fetch 风格处理器，由宿主 webserver 组合根
 *     按配置挂载（红线：禁止硬编码端口，R13 插件化）
 *   - 共享重试/沉默失败检测收口到 src/gateway.ts（三个 proxy 的重复段合并）
 *   - env 变量登记进 @flowforge/harness-env-registry（R17）
 *
 * 消费者加载默认插件：
 * ```ts
 * import OpenrouteService from '@flowforge/llm-openroute'
 * ctx.plugin(OpenrouteService)
 * // ctx.forgeOpenroute.client.chat({ messages }) — ForgekinBase 兜底 LLM 调用
 * // ctx.forgeOpenroute.anthropicHandler() — 挂载到 webserver
 * ```
 *
 * @module @flowforge/llm-openroute
 */

import { Context, Service } from '@flowforge/cordis';

import { OpenRouteLlmClient } from './adapter.ts';
import {
  resolveOpenrouteGatewayConfig,
  type OpenrouteCallOptions,
  type OpenrouteEnv,
  type OpenrouteGatewayConfig,
} from './gateway.ts';
import {
  createAnthropicProxyHandler,
  createGeminiProxyHandler,
  createResponsesProxyHandler,
} from './proxy-handler.ts';

export {
  callOpenrouteChat,
  extractFirstChoiceContent,
  FALLBACK_MODELS,
  INVALID_RESPONSE_PATTERNS,
  isInvalidOpenrouteResponse,
  normalizeOpenrouteBaseUrl,
  openrouteChatEndpoint,
  resolveOpenrouteGatewayConfig,
} from './gateway.ts';
export type {
  OpenrouteCallOptions,
  OpenrouteCallResult,
  OpenrouteEnv,
  OpenrouteFetchFn,
  OpenrouteFetchResponse,
  OpenrouteGatewayConfig,
} from './gateway.ts';
export { OpenRouteLlmClient } from './adapter.ts';
export type {
  OpenrouteChatArgs,
  OpenrouteChatMessage,
  OpenrouteChatResult,
  OpenrouteClientOptions,
} from './adapter.ts';
export {
  anthropicToOpenai,
  ANTHROPIC_MODEL_MAPPING,
  ANTHROPIC_PROXY_DEFAULT_MODEL,
  CLAUDE_TO_OPENROUTE_MODEL,
  openaiToAnthropic,
  streamOpenaiToAnthropic,
  stripModelSuffix,
} from './anthropic-proxy.ts';
export {
  geminiRequestToOpenai,
  GEMINI_MODEL_MAPPING,
  GEMINI_PROXY_DEFAULT_MODEL,
  GEMINI_TO_OPENROUTE_MODEL,
  openaiResponseToGemini,
  streamOpenaiToGemini,
} from './gemini-proxy.ts';
export {
  chatToResponses,
  RESPONSES_MODEL_MAPPING,
  RESPONSES_PROXY_DEFAULT_MODEL,
  responsesToChat,
  streamChatToResponses,
} from './responses-proxy.ts';
export {
  createAnthropicProxyHandler,
  createGeminiProxyHandler,
  createResponsesProxyHandler,
} from './proxy-handler.ts';

/** 插件选项（显式覆盖 env 解析；等价 Python CLI 参数） */
export interface OpenrouteServiceOptions {
  readonly env?: OpenrouteEnv | undefined;
  readonly baseUrlOverride?: string | undefined;
  readonly apiKeyOverride?: string | undefined;
  readonly callOptions?: OpenrouteCallOptions | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** OpenRoute 网关客户端与协议代理服务 */
    forgeOpenroute: OpenrouteService;
  }
}

/**
 * OpenRoute 服务：网关配置解析 + ForgekinBase 兜底 LLM 客户端 + 三协议代理处理器。
 * 生命周期为纯装配（无后台任务），created 即就绪。
 */
export class OpenrouteService extends Service {
  /** 网关配置（adapter 用非 /v1 形态；proxy 网关已统一规范化） */
  readonly gateway: OpenrouteGatewayConfig;
  /** ForgekinBase 兜底 LLM 客户端（对齐 openroute_adapter.py） */
  readonly client: OpenRouteLlmClient;
  private readonly callOptions: OpenrouteCallOptions;

  constructor(ctx: Context, options: OpenrouteServiceOptions = {}) {
    super(ctx, 'forgeOpenroute');
    const env = options.env ?? process.env;
    this.gateway = resolveOpenrouteGatewayConfig(env, {
      defaultModel: env['FLOWFORGE_FORGEMIND_OPENROUTE_MODEL'] ?? 'openai/gpt-4o-mini',
      baseUrlOverride: options.baseUrlOverride,
      apiKeyOverride: options.apiKeyOverride,
    });
    this.client = new OpenRouteLlmClient({
      env,
      baseUrlOverride: options.baseUrlOverride,
      apiKeyOverride: options.apiKeyOverride,
    });
    this.callOptions = options.callOptions ?? {};
  }

  /** Anthropic Messages → OpenRoute 处理器（挂载到宿主 webserver） */
  anthropicHandler(): (request: Request) => Promise<Response> {
    return createAnthropicProxyHandler(this.gateway, { callOptions: this.callOptions });
  }

  /** Gemini generateContent → OpenRoute 处理器 */
  geminiHandler(): (request: Request) => Promise<Response> {
    return createGeminiProxyHandler(this.gateway, { callOptions: this.callOptions });
  }

  /** OpenAI Responses API → OpenRoute 处理器 */
  responsesHandler(): (request: Request) => Promise<Response> {
    return createResponsesProxyHandler(this.gateway, { callOptions: this.callOptions });
  }
}

export default OpenrouteService;
