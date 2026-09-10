/**
 * Injectable sorted-set / counter store port for the tool-usage domain.
 *
 * FlowForge convention: external storage (Redis) is abstracted behind a package
 * port with an in-memory contract implementation, so the domain is testable
 * without a live store. Ported in place of clowder's `RedisClient` dependency.
 */
export interface SortedSetStore {
  /** Optional key prefix emulation (ioredis keyPrefix); SCAN does not auto-apply it. */
  keyPrefix: string

  /** Add/update a member with a score. Resolves 1 if newly added, 0 if updated. */
  zadd(key: string, score: number, member: string): Promise<number>

  /** Members ordered by (score, member) ascending within the inclusive [start,stop] rank window. */
  zrange(key: string, start: number, stop: number): Promise<string[]>

  /** Members+score tuples (flat [member,score,…] layout) within the inclusive rank window. */
  zrangeWithScores(key: string, start: number, stop: number): Promise<string[]>

  /** Removes a member; resolves 1 if removed, 0 otherwise. */
  zrem(key: string, member: string): Promise<number>

  /** Removes members within the inclusive rank window; resolves the count removed. */
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>

  /** No-op TTL touch; resolves 1 for port compatibility. */
  expire(key: string, ttlSeconds: number): Promise<number>

  /** Atomic increment; returns the post-increment value. */
  incr(key: string): Promise<number>

  /** All keys matching a glob pattern (cursor scan emulated; dedup applied). */
  scan(pattern: string): Promise<string[]>

  /** Read counter/string values (nullable for missing/mistyped keys). */
  mget(...keys: string[]): Promise<Array<string | null>>
}

/** In-memory contract implementation for tests & lightweight runtimes. */
export class InMemorySortedSetStore implements SortedSetStore {
  keyPrefix = ''
  private readonly buckets = new Map<string, Map<string, number>>()
  private readonly counters = new Map<string, number>()

  async zadd(key: string, score: number, member: string): Promise<number> {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = new Map<string, number>()
      this.buckets.set(key, bucket)
    }
    const existed = bucket.has(member)
    bucket.set(member, score)
    return existed ? 0 : 1
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.ranked(key, start, stop)
  }

  async zrangeWithScores(key: string, start: number, stop: number): Promise<string[]> {
    const members = this.ranked(key, start, stop)
    const bucket = this.buckets.get(key)
    const flat: string[] = []
    for (const member of members) {
      flat.push(member, String(bucket?.get(member) ?? 0))
    }
    return flat
  }

  async zrem(key: string, member: string): Promise<number> {
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    return bucket.delete(member) ? 1 : 0
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    const remove = new Set(this.ranked(key, start, stop))
    let removed = 0
    for (const member of remove) {
      if (bucket.delete(member)) removed += 1
    }
    return removed
  }

  async expire(_key: string, _ttlSeconds: number): Promise<number> {
    return 1
  }

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, next)
    return next
  }

  async scan(pattern: string): Promise<string[]> {
    const re = globToRegExp(pattern)
    const keys = new Set<string>()
    for (const key of this.buckets.keys()) if (re.test(key)) keys.add(key)
    for (const key of this.counters.keys()) if (re.test(key)) keys.add(key)
    return [...keys]
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => {
      const value = this.counters.get(key)
      return value === undefined ? null : String(value)
    })
  }

  private ranked(key: string, start: number, stop: number): string[] {
    const bucket = this.buckets.get(key)
    if (!bucket) return []
    const members = [...bucket.entries()]
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([member]) => member)
    const n = members.length
    if (n === 0) return []
    let s = start < 0 ? Math.max(0, n + start) : Math.min(n - 1, start)
    let e = stop < 0 ? n + stop : Math.min(n - 1, stop)
    if (s > e) return []
    if (s < 0) s = 0
    if (e > n - 1) e = n - 1
    return members.slice(s, e + 1)
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}