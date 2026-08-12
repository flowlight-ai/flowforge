/**
 * FlowForgeClient — 共享 HTTP 客户端 SDK
 *
 * 从 contentforge / devforge / novelforge / mallforge 中提取的通用请求逻辑，
 * 消除跨项目重复代码。
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export class FlowForgeClient {
  private baseUrl: string;

  constructor(baseUrl: string = "/api/v1") {
    this.baseUrl = baseUrl;
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    // 超时 + 外部取消双通道：默认 30s 超时，同时透传调用方 AbortSignal
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DEFAULT_TIMEOUT_MS);
    const externalSignal = options?.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { "Content-Type": "application/json", ...options?.headers },
        ...options,
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(`${err.detail || `HTTP ${res.status}`}（${this.baseUrl}${path}）`);
      }
      return res.json();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error(timedOut ? `请求超时（${DEFAULT_TIMEOUT_MS / 1000}s）: ${this.baseUrl}${path}` : `请求已取消: ${this.baseUrl}${path}`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}

/**
 * 工厂函数：创建 FlowForgeClient 实例
 * @param baseUrl 可选，默认为 "/api/v1"（浏览器端自动使用相对路径）
 */
export function createFlowForgeClient(baseUrl?: string): FlowForgeClient {
  const base = baseUrl ?? "/api/v1";
  return new FlowForgeClient(base);
}
