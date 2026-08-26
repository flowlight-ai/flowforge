/**
 * @flowforge/llm-route — HTTP 抽象（对齐 Python httpx 语义）
 *
 * ModelService 健康检查依赖 HTTP 探测（chat/completions + /health）。
 * 通过 HttpLike 接口注入，默认实现基于全局 fetch + AbortController 超时；
 * 测试注入 mock，避免真实网络依赖。
 *
 * @module @flowforge/llm-route/http
 */

/** HTTP 响应（对齐 httpx.Response 的最小面）。 */
export interface HttpResponse {
  readonly status: number;
  json(): Promise<Record<string, unknown>>;
}

/** HTTP 客户端最小接口（post/get 两个动作，与 Python httpx.AsyncClient 对应）。 */
export interface HttpLike {
  post(
    url: string,
    options: {
      json?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<HttpResponse>;
  get(url: string, options: { timeoutMs?: number }): Promise<HttpResponse>;
}

/** 基于全局 fetch 的默认实现（Node 18+ 内置）。 */
export class FetchHttpClient implements HttpLike {
  async post(
    url: string,
    options: {
      json?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<HttpResponse> {
    const { json: body, headers, timeoutMs = 15000 } = options;
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    return toHttpResponse(response);
  }

  async get(
    url: string,
    options: { timeoutMs?: number } = {},
  ): Promise<HttpResponse> {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
    return toHttpResponse(response);
  }
}

async function toHttpResponse(response: Response): Promise<HttpResponse> {
  return {
    status: response.status,
    async json(): Promise<Record<string, unknown>> {
      const data: unknown = await response.json();
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return {};
      }
      return data as Record<string, unknown>;
    },
  };
}
