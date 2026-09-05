/**
 * 三个协议代理的 HTTP 挂载层（Request → Response 处理器）。
 *
 * 对齐 Python FastAPI 路由（anthropic/gemini/responses_to_openroute_proxy.py），
 * 但按插件化改造（R13）：不再自起 uvicorn 监听固定端口（红线：禁止硬编码端口），
 * 而是导出 fetch 风格处理器，由宿主 webserver 组合根按配置挂载（如
 * /openroute/anthropic/* 前缀或独立端口由 composition 决定）。
 *
 * 处理器内部按 pathname 精确路由；不匹配的路径返回 404 JSON。
 * 流式端点把 AsyncGenerator<string> 包装为 SSE ReadableStream。
 */

import { callOpenrouteChat, type OpenrouteCallOptions, type OpenrouteGatewayConfig } from './gateway.ts';
import {
  anthropicToOpenai,
  CLAUDE_TO_OPENROUTE_MODEL,
  openaiToAnthropic,
  streamOpenaiToAnthropic,
} from './anthropic-proxy.ts';
import {
  geminiRequestToOpenai,
  GEMINI_TO_OPENROUTE_MODEL,
  openaiResponseToGemini,
  streamOpenaiToGemini,
} from './gemini-proxy.ts';
import {
  chatToResponses,
  RESPONSES_MODEL_MAPPING,
  RESPONSES_PROXY_DEFAULT_MODEL,
  responsesToChat,
  streamChatToResponses,
} from './responses-proxy.ts';

type Json = Record<string, unknown>;

function jsonError(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(value));
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function readJsonBody(request: Request): Promise<Json> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

export interface ProxyHandlerOptions {
  readonly callOptions?: OpenrouteCallOptions | undefined;
}

// ── Anthropic → OpenRoute ───────────────────────────────────────────────────

/**
 * Anthropic Messages → OpenRoute 处理器。
 *
 * Claude CLI 配置：ANTHROPIC_BASE_URL 指向本处理器挂载地址 + ANTHROPIC_AUTH_TOKEN。
 * 端点：POST /v1/messages（流式/非流式）、GET /v1/models、GET /health。
 */
export function createAnthropicProxyHandler(
  gateway: OpenrouteGatewayConfig,
  opts: ProxyHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return Response.json({
        status: 'healthy',
        service: 'anthropic-to-openroute-proxy',
        openroute_base: gateway.baseUrl,
        default_model: gateway.defaultModel,
      });
    }
    if (request.method === 'GET' && pathname === '/v1/models') {
      const models = Object.entries(CLAUDE_TO_OPENROUTE_MODEL).map(([claudeName, openrouteName]) => ({
        id: claudeName,
        display_name: claudeName,
        type: 'model',
        proxied_to: openrouteName,
      }));
      return Response.json({ data: models });
    }
    if (request.method !== 'POST' || pathname !== '/v1/messages') {
      return jsonError(404, { error: { type: 'not_found', message: `no route: ${request.method} ${pathname}` } });
    }

    const body = await readJsonBody(request);
    const rawModel = typeof body['model'] === 'string' ? body['model'] : 'claude-sonnet-4';
    const model = CLAUDE_TO_OPENROUTE_MODEL[stripSuffix(rawModel)] ?? rawModel;
    const stream = body['stream'] === true;

    try {
      const openaiBody = anthropicToOpenai(body);
      const oaResp = await callOpenrouteChat(gateway, openaiBody, opts.callOptions);

      if (oaResp.status !== 200) {
        return jsonError(oaResp.status, {
          type: 'error',
          error: { type: 'api_error', message: oaResp.text },
        });
      }
      const oaData = oaResp.data ?? {};
      if (stream) {
        const msgId = `msg_${Date.now()}`;
        return sseResponse(streamOpenaiToAnthropic(oaData, model, msgId));
      }
      return Response.json(openaiToAnthropic(oaData, model));
    } catch (exc) {
      return jsonError(500, { type: 'error', error: { type: 'api_error', message: String(exc) } });
    }
  };
}

function stripSuffix(model: string): string {
  return model.includes('[') ? model.split('[', 1)[0] ?? model : model;
}

// ── Gemini → OpenRoute ──────────────────────────────────────────────────────

/**
 * Gemini → OpenRoute 处理器。
 *
 * Gemini CLI 配置：GOOGLE_GEMINI_BASE_URL 指向本处理器挂载地址。
 * 端点：POST /v1beta/models/{model}:generateContent、
 * POST /v1beta/models/{model}:streamGenerateContent、GET /v1beta/models、GET /health。
 */
export function createGeminiProxyHandler(
  gateway: OpenrouteGatewayConfig,
  opts: ProxyHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return Response.json({
        status: 'healthy',
        service: 'gemini-to-openroute-proxy',
        openroute_base: gateway.baseUrl,
      });
    }
    if (request.method === 'GET' && pathname === '/v1beta/models') {
      const models = Object.entries(GEMINI_TO_OPENROUTE_MODEL).map(([name, openrouteName]) => ({
        name: `models/${name}`,
        displayName: name,
        description: `Proxied to OpenRoute ${openrouteName}`,
      }));
      // 也加上 openroute 原生模型名（gemini CLI 可能直接用）
      for (const openrouteName of new Set(Object.values(GEMINI_TO_OPENROUTE_MODEL))) {
        models.push({
          name: `models/${openrouteName}`,
          displayName: openrouteName,
          description: 'OpenRoute native model',
        });
      }
      return Response.json({ models });
    }

    const generateMatch = /^\/v1beta\/models\/([^:]+):generateContent$/.exec(pathname);
    const streamMatch = /^\/v1beta\/models\/([^:]+):streamGenerateContent$/.exec(pathname);
    if (request.method !== 'POST' || (generateMatch === null && streamMatch === null)) {
      return jsonError(404, { error: { code: 404, message: `no route: ${request.method} ${pathname}` } });
    }
    const model = decodeURIComponent((generateMatch ?? streamMatch)?.[1] ?? '');
    const body = await readJsonBody(request);

    try {
      const openaiBody = geminiRequestToOpenai(model, body);
      const oaResp = await callOpenrouteChat(gateway, openaiBody, opts.callOptions);

      if (oaResp.status !== 200) {
        const errBody = { error: { code: oaResp.status, message: oaResp.text } };
        if (streamMatch !== null) {
          return sseResponse((async function* () {
            yield `data: ${JSON.stringify(errBody)}\n\n`;
          })());
        }
        return jsonError(oaResp.status, errBody);
      }
      const oaData = oaResp.data ?? {};
      if (streamMatch !== null) {
        return sseResponse(streamOpenaiToGemini(oaData, model));
      }
      return Response.json(openaiResponseToGemini(oaData, model));
    } catch (exc) {
      const errBody = { error: { code: 500, message: String(exc) } };
      if (streamMatch !== null) {
        return sseResponse((async function* () {
          yield `data: ${JSON.stringify(errBody)}\n\n`;
        })());
      }
      return jsonError(500, errBody);
    }
  };
}

// ── Responses → OpenRoute ───────────────────────────────────────────────────

/**
 * OpenAI Responses API → OpenRoute 处理器。
 *
 * Codex CLI 配置：base_url 指向本处理器挂载地址 + wire_api="responses"。
 * 端点：POST /v1/responses（流式/非流式）、GET /v1/models、GET /health。
 */
export function createResponsesProxyHandler(
  gateway: OpenrouteGatewayConfig,
  opts: ProxyHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return Response.json({
        status: 'healthy',
        service: 'responses-to-openroute-proxy',
        openroute_base: gateway.baseUrl,
        default_model: gateway.defaultModel,
      });
    }
    if (request.method === 'GET' && pathname === '/v1/models') {
      return Response.json({
        data: [gateway.defaultModel, 'Kimi-K2.6', 'GLM-5.1', 'Doubao-Seed2.0'].map((id) => ({
          id,
          object: 'model',
        })),
      });
    }
    if (request.method !== 'POST' || pathname !== '/v1/responses') {
      return jsonError(404, { error: { message: `no route: ${request.method} ${pathname}`, type: 'invalid_request_error' } });
    }

    const body = await readJsonBody(request);
    const rawModel =
      typeof body['model'] === 'string' && body['model'] !== ''
        ? body['model']
        : RESPONSES_PROXY_DEFAULT_MODEL;
    const model = RESPONSES_MODEL_MAPPING[rawModel] ?? rawModel;
    const stream = body['stream'] === true;

    try {
      const chatBody = responsesToChat(body);
      const oaResp = await callOpenrouteChat(gateway, chatBody, opts.callOptions);

      if (oaResp.status !== 200) {
        return jsonError(oaResp.status, { error: { message: oaResp.text, type: 'api_error' } });
      }
      const oaData = oaResp.data ?? {};
      if (stream) {
        const respId = `resp_${Date.now()}`;
        return sseResponse(streamChatToResponses(oaData, model, respId));
      }
      return Response.json(chatToResponses(oaData, model));
    } catch (exc) {
      return jsonError(500, { error: { message: String(exc), type: 'api_error' } });
    }
  };
}
