"use client";

import { useState, useCallback } from "react";

export function useApi<T = any>(baseUrl: string = "/api/v1") {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <R = T>(
    path: string,
    options?: RequestInit
  ): Promise<R> => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${baseUrl}${path}`, {
        headers: { "Content-Type": "application/json", ...options?.headers },
        ...options,
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.detail || `HTTP ${r.status}`);
      }
      return data as R;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
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
