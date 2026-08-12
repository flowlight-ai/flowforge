interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const store = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL = 30_000;
/** 缓存条目上限，超出后按最旧条目淘汰（防无界增长） */
const MAX_ENTRIES = 500;

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > (entry.ttl ?? DEFAULT_TTL)) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
  store.set(key, { data, timestamp: Date.now(), ttl });
  // 简单 LRU：超出上限时淘汰最旧的条目
  if (store.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of store) {
      if (v.timestamp < oldestTs) {
        oldestTs = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function invalidatePattern(pattern: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(pattern)) store.delete(k);
  }
}

export function clearAll(): void {
  store.clear();
}
