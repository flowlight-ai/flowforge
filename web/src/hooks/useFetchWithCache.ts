"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getCached, setCache, invalidate } from "@/lib/cache";

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseFetchOptions {
  ttl?: number;
  enabled?: boolean;
}

const inFlightRequests = new Map<string, Promise<any>>();

export function useFetchWithCache<T = any>(
  url: string | null,
  options: UseFetchOptions = {}
): FetchState<T> & { refetch: () => void } {
  const { ttl = 30_000, enabled = true } = options;
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: enabled && !!url,
    error: null,
  });
  const mountedRef = useRef(true);

  const fetchData = useCallback(
    async (forceRefresh = false) => {
      if (!url) return;

      const cacheKey = url;

      if (!forceRefresh) {
        const cached = getCached<T>(cacheKey);
        if (cached !== undefined) {
          if (mountedRef.current) {
            setState({ data: cached, loading: false, error: null });
          }
          return;
        }

        const inFlight = inFlightRequests.get(cacheKey);
        if (inFlight) {
          try {
            const result = await inFlight;
            if (mountedRef.current) {
              setState({ data: result as T, loading: false, error: null });
            }
          } catch (e: any) {
            if (mountedRef.current) {
              setState({ data: null, loading: false, error: e.message });
            }
          }
          return;
        }
      }

      setState((prev) => ({ ...prev, loading: true, error: null }));

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
          setState({ data: result, loading: false, error: null });
        }
      } catch (e: any) {
        if (mountedRef.current) {
          setState({ data: null, loading: false, error: e.message });
        }
      }
    },
    [url, ttl]
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
