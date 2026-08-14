"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getCached, setCache, invalidate } from "@/lib/cache";

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /**
   * 当前 data 是否来自缓存（等待网络刷新）。
   * 参考 clowder-ai cachedFrom 机制：消费方可据此显示 "缓存中" 提示，
   * 或在 hydration merge 时用服务端真相替换缓存数据。
   */
  fromCache: boolean;
}

interface UseFetchOptions<T = unknown> {
  ttl?: number;
  enabled?: boolean;
  /**
   * IndexedDB 缓存回退（cache-then-network）。
   * 提供时：先读 IDB 立即显示（fromCache=true），再 fetch 网络刷新。
   * 未提供时：走原内存缓存逻辑。
   */
  idbFallback?: () => Promise<T | null>;
  /**
   * 网络刷新成功后回调。消费方可在此将新鲜数据持久化到 IDB（write-through）。
   */
  onRefresh?: (data: T) => void;
}

const inFlightRequests = new Map<string, Promise<any>>();

export function useFetchWithCache<T = any>(
  url: string | null,
  options: UseFetchOptions<T> = {}
): FetchState<T> & { refetch: () => void } {
  const { ttl = 30_000, enabled = true, idbFallback, onRefresh } = options;
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: enabled && !!url,
    error: null,
    fromCache: false,
  });
  const mountedRef = useRef(true);
  // 持有最新的 onRefresh，避免 useEffect 依赖频繁重建
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      if (!url) return;

      const cacheKey = url;

      // ── 1. IndexedDB 缓存优先：立即显示，再异步网络刷新 ──────────
      // 仅在非强制刷新且提供 idbFallback 时启用。
      if (!forceRefresh && idbFallback) {
        try {
          const idbData = await idbFallback();
          if (idbData !== null && idbData !== undefined) {
            if (mountedRef.current) {
              // 立即渲染缓存数据（秒开），fromCache=true 标记待刷新
              setState({
                data: idbData,
                loading: false,
                error: null,
                fromCache: true,
              });
            }
            // 不 return —— 继续走网络刷新（cache-then-network）
          }
        } catch {
          // IDB 读取失败，降级为纯网络流程
        }
      } else if (!forceRefresh) {
        // ── 2. 内存缓存命中（无 IDB 回退时） ──────────────────────
        const cached = getCached<T>(cacheKey);
        if (cached !== undefined) {
          if (mountedRef.current) {
            setState({ data: cached, loading: false, error: null, fromCache: false });
          }
          return;
        }

        // 去重：复用进行中的同 URL 请求
        const inFlight = inFlightRequests.get(cacheKey);
        if (inFlight) {
          try {
            const result = await inFlight;
            if (mountedRef.current) {
              setState({ data: result as T, loading: false, error: null, fromCache: false });
            }
          } catch (e: any) {
            if (mountedRef.current) {
              setState({ data: null, loading: false, error: e.message, fromCache: false });
            }
          }
          return;
        }
      }

      // ── 3. 网络刷新 ────────────────────────────────────────────
      // 有 IDB 缓存数据时不设 loading=true（避免缓存数据被遮蔽），
      // 仅靠 fromCache 标记表达 "后台刷新中"。
      setState((prev) => ({
        ...prev,
        loading: prev.data === null,
        error: null,
      }));

      const promise = fetch(url)
        .then((r) => r.json())
        .then((raw) => {
          const data = raw?.data ?? raw;
          setCache(cacheKey, data as T, ttl);
          inFlightRequests.delete(cacheKey);
          return data as T;
        })
        .catch((e) => {
          inFlightRequests.delete(cacheKey);
          throw e;
        });

      inFlightRequests.set(cacheKey, promise);

      try {
        const result = await promise;
        if (mountedRef.current) {
          setState({ data: result, loading: false, error: null, fromCache: false });
        }
        // 通知消费方持久化新鲜数据到 IDB
        onRefreshRef.current?.(result);
      } catch (e: any) {
        if (mountedRef.current) {
          setState((prev) => ({
            // 网络失败时保留已有缓存数据（若有），仅记录错误
            data: prev.data,
            loading: false,
            error: e.message,
            fromCache: prev.fromCache,
          }));
        }
      }
    },
    [url, ttl, idbFallback]
  );

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && url) {
      fetchData();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, enabled, url]);

  const refetch = useCallback(() => {
    if (url) {
      invalidate(url);
      fetchData(true);
    }
  }, [fetchData, url]);

  return { ...state, refetch };
}
