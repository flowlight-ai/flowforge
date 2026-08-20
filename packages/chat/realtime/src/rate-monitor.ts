/**
 * BroadcastRateMonitor — per-thread broadcast rate monitor.
 *
 * 移植自 clowder-ai `BroadcastRateMonitor.ts`（F183 Phase C2/C3）：在
 * broadcastAgentMessage 唯一 choke point 加 per-thread emit rate 滑动窗口，
 * 超阈值时去抖告警一次 + 暴露 `getStats(threadId)` 给 admin/test 洞察。
 *
 * 设计选择（保持 clowder-ai 结论）：
 * - **不做 buffer/drop**：socket.io emit 是 best-effort，无内置 drop 点；
 *   客户端 gap detection + retry catch-up 是 user-visible safety net。
 *   先让 observability 看到再谈 enforcement（premature buffer/drop 是过度设计）。
 * - **滑动窗口**：1s 窗口计数，O(1) per emit（head-index 而非 shift）。
 * - **去抖告警**：同 thread 至多每 5s 一次，避免 log 风暴。
 * - **单调时钟**：wall-clock（Date.now）会被 NTP/VM 回拨，默认
 *   `performance.now()`（进程相对单调）。
 *
 * @module @flowforge/chat-realtime/rate-monitor
 */

const DEFAULT_RATE_THRESHOLD = 200 // events/sec
const WINDOW_MS = 1000 // 1s sliding window
const WARN_DEDUP_MS = 5000 // 5s dedup interval per thread

export interface BroadcastRateMonitorOptions {
  /** Rate threshold (events per WINDOW_MS) above which a warning is logged. Default 200. */
  rateThreshold?: number
  /** Sliding window size in ms. Default 1000ms. */
  windowMs?: number
  /** Min interval between warnings per thread (ms). Default 5000ms. */
  warnDedupMs?: number
  /** Logger callback. Default no-op (caller injects logger). */
  onWarn?: (event: BroadcastRateWarnEvent) => void
  /**
   * Clock injection. Must be **monotonic** — wall-clock sources (`Date.now`)
   * get adjusted by NTP / VM time sync and can move backward, which makes
   * throttle / dedup checks `ts - lastT >= window` go negative and silently
   * suppress eviction + warnings. Default uses `performance.now()`.
   */
  now?: () => number
}

export interface BroadcastRateWarnEvent {
  threadId: string
  /** Events counted in the most recent window. */
  windowCount: number
  /** Configured threshold that triggered the warn. */
  threshold: number
  /** Window size in ms. */
  windowMs: number
  /**
   * Timestamp of warn emission, from the injected `now()` clock. Default is
   * monotonic (`performance.now()` ms since process start) — NOT wall-clock.
   */
  timestamp: number
}

export interface BroadcastRateStats {
  /** Events counted in the current sliding window. */
  windowCount: number
  /** Sliding window size (ms). */
  windowMs: number
  /** Configured rate threshold (events / windowMs). */
  threshold: number
  /** Last warn timestamp (ms) or 0 if never warned. */
  lastWarnAt: number
}

/**
 * Sliding window state per thread. Uses head-index (deque-style) instead of
 * `Array.shift()` to keep `record()` amortized O(1) under sustained load —
 * repeated shifts make the monitor itself the bottleneck it's there to detect.
 */
interface WindowState {
  /** Append-only buffer of emit timestamps */
  readonly stamps: number[]
  /** Index of first unexpired entry (entries [0..head) are dead) */
  head: number
}

export class BroadcastRateMonitor {
  private readonly threshold: number
  private readonly window: number
  private readonly warnDedup: number
  private readonly onWarn: (event: BroadcastRateWarnEvent) => void
  private readonly now: () => number
  /** threadId → sliding window state */
  private readonly threadEmits: Map<string, WindowState> = new Map()
  /** threadId → last warn timestamp */
  private readonly lastWarnAt: Map<string, number> = new Map()
  /**
   * Throttle eviction to at most once per window. Sentinel is `-Infinity`
   * (never swept) so the first call always passes the gate regardless of
   * clock base — `0` collides with `performance.now()`'s process-relative
   * time base and would falsely gate the first sweep.
   */
  private lastEvictAt = Number.NEGATIVE_INFINITY
  /** Diagnostic counter — number of eviction sweeps performed. */
  private evictCount = 0

  constructor(opts: BroadcastRateMonitorOptions = {}) {
    this.threshold = opts.rateThreshold ?? DEFAULT_RATE_THRESHOLD
    this.window = opts.windowMs ?? WINDOW_MS
    this.warnDedup = opts.warnDedupMs ?? WARN_DEDUP_MS
    this.onWarn = opts.onWarn ?? (() => {})
    this.now = opts.now ?? (() => performance.now())
  }

  /**
   * Record an emit for a thread. Updates sliding window + triggers warn
   * callback if rate exceeds threshold (debounced per thread).
   *
   * **best-effort guarantee**: `onWarn` is wrapped in try/catch — a logger
   * throw must NOT propagate to the caller. Otherwise broadcast emit (which
   * calls record() before transport emit) would be aborted by observability,
   * making the monitor cause the very symptom it's there to detect.
   */
  record(threadId: string): void {
    const ts = this.now()
    // Opportunistic eviction, throttled to at most once per window, runs at
    // any cardinality: transient threadIds in a long-running process would
    // otherwise grow unbounded; idle stamps get evicted on the next record().
    if (this.threadEmits.size > 0 && ts - this.lastEvictAt >= this.window) {
      this.evictExpired(ts)
    }
    let state = this.threadEmits.get(threadId)
    if (!state) {
      state = { stamps: [], head: 0 }
      this.threadEmits.set(threadId, state)
    }
    // Advance head past expired entries — O(k) where k is # of newly-expired
    // entries this call (NOT total array length). Amortized O(1) per record.
    // Inclusive `<= cutoff` boundary: a burst at t=0 and a burst at
    // t=windowMs must not double-count the t=0 entries.
    const cutoff = ts - this.window
    while (state.head < state.stamps.length && state.stamps[state.head]! <= cutoff) {
      state.head++
    }
    // Bound memory: when dead-prefix exceeds live count, compact in batches.
    if (state.head > 0 && state.head >= state.stamps.length - state.head) {
      state.stamps.splice(0, state.head)
      state.head = 0
    }
    state.stamps.push(ts)

    const liveCount = state.stamps.length - state.head
    if (liveCount > this.threshold) {
      // `undefined` (never warned) bypasses dedup directly — do NOT fall
      // back to `0`, which collides with `performance.now()`'s
      // process-relative time base (early `ts < warnDedupMs` would
      // suppress the first warning).
      const lastWarn = this.lastWarnAt.get(threadId)
      if (lastWarn === undefined || ts - lastWarn >= this.warnDedup) {
        this.lastWarnAt.set(threadId, ts)
        try {
          this.onWarn({
            threadId,
            windowCount: liveCount,
            threshold: this.threshold,
            windowMs: this.window,
            timestamp: ts,
          })
        } catch {
          // Best-effort observability: swallow callback errors.
        }
      }
    }
  }

  /** Read current stats for a thread (test/admin introspection). */
  getStats(threadId: string): BroadcastRateStats {
    const state = this.threadEmits.get(threadId)
    let windowCount = 0
    if (state) {
      const ts = this.now()
      const cutoff = ts - this.window
      for (let i = state.head; i < state.stamps.length; i++) {
        if (state.stamps[i]! > cutoff) windowCount++
      }
    }
    return {
      windowCount,
      windowMs: this.window,
      threshold: this.threshold,
      lastWarnAt: this.lastWarnAt.get(threadId) ?? 0,
    }
  }

  /**
   * Sweep expired-only entries. Called opportunistically from `record()`
   * once per window. Pure cleanup; does not affect any observable behavior
   * for active threads. Stamps `lastEvictAt` so subsequent record() calls
   * within the same window skip this O(n) walk.
   */
  private evictExpired(ts: number): void {
    this.evictCount++
    this.lastEvictAt = ts
    const cutoff = ts - this.window
    for (const [threadId, state] of this.threadEmits) {
      // Skip if any live entry remains (cheap last-stamp check)
      const lastStamp = state.stamps[state.stamps.length - 1] ?? 0
      if (lastStamp > cutoff) continue
      // All entries expired — drop state entirely (lastWarnAt stays for
      // dedup correctness; swept below when stale enough).
      this.threadEmits.delete(threadId)
    }
    // Sweep stale lastWarnAt: any warn timestamp older than 2 dedup windows
    // is also evictable (no dedup decision depends on it anymore).
    const warnCutoff = ts - this.warnDedup * 2
    for (const [threadId, lastWarn] of this.lastWarnAt) {
      if (lastWarn < warnCutoff && !this.threadEmits.has(threadId)) {
        this.lastWarnAt.delete(threadId)
      }
    }
  }

  /** Diagnostic — number of eviction sweeps performed (verifies throttle bounds frequency). */
  get sweepCount(): number {
    return this.evictCount
  }

  /** Test/admin: clear a thread's tracking state. */
  reset(threadId: string): void {
    this.threadEmits.delete(threadId)
    this.lastWarnAt.delete(threadId)
  }

  /** Test only: clear all tracking state. */
  resetAll(): void {
    this.threadEmits.clear()
    this.lastWarnAt.clear()
    this.lastEvictAt = Number.NEGATIVE_INFINITY
    this.evictCount = 0
  }
}
