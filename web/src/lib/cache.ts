interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const store = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL = 30_000;

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
