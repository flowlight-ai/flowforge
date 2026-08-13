"use client";

import { useState, useCallback } from "react";

const DEFAULT_TIMEOUT_MS = 30_000;

export function useApi<T = any>(baseUrl: string = "/api/v1") {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <R = T>(
    path: string,
    options?: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<R> => {
    setLoading(true);
    setError(null);
    // 超时 + 外部取消双通道，组件卸载/请求挂起时均可中止
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const externalSignal = options?.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    }
    try {
      const r = await fetch(`${baseUrl}${path}`, {
        headers: { "Content-Type": "application/json", ...options?.headers },
        ...options,
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.detail || `HTTP ${r.status}`);
      }
      return data as R;
    } catch (e: unknown) {
      let msg: string;
      if (e instanceof DOMException && e.name === "AbortError") {
        msg = timedOut ? `请求超时（${timeoutMs / 1000}s）: ${path}` : "请求已取消";
      } else {
        msg = e instanceof Error ? e.message : String(e);
      }
      setError(msg);
      throw e;
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      setLoading(false);
    }
  }, [baseUrl]);

  const get = useCallback(<R = T>(path: string) => request<R>(path), [request]);
  const post = useCallback(<R = T>(path: string, body: any) =>
    request<R>(path, { method: "POST", body: JSON.stringify(body) }), [request]);
  const put = useCallback(<R = T>(path: string, body: any) =>
    request<R>(path, { method: "PUT", body: JSON.stringify(body) }), [request]);
  const del = useCallback(<R = T>(path: string) =>
    request<R>(path, { method: "DELETE" }), [request]);

  return { loading, error, get, post, put, del, request };
}
