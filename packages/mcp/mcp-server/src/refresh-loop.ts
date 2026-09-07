/**
 * MCP client background refresh loop.
 *
 * Periodically pings POST /api/callbacks/refresh-token to keep the callback
 * token alive in long sessions. Uses an adaptive interval:
 *   nextDelayMs = clamp(ttlRemainingMs / 4, 5min, 30min) * jitter
 *
 * Refresh is plumbing, not a cognitive action; best-effort. Failures log a
 * warning and reschedule — the next real verify() surfaces auth issues with a
 * structured reason.
 *
 * The callback endpoint seam is injectable via `./callback-config.ts`; when no
 * config is present the loop is a no-op (matches the clowder source).
 */

import { buildAuthHeaders, getCallbackConfig } from './callback-config.js';
import { type CallbackAuthFailureReason, isCallbackAuthFailureReason } from './callback-types.js';

/**
 * Server-side refresh cooldown is 5min per invocation. The client's adaptive
 * delay must NEVER fall below cooldown — otherwise the loop fires before
 * cooldown clears, gets 429, wastes a round-trip + warn-log noise.
 */
const SERVER_COOLDOWN_MS = 5 * 60_000;
const JITTER_FLOOR = 0.85; // 0.85 + Math.random() * 0.3 → range [0.85, 1.15]
const COOLDOWN_BUFFER = 1.05; // 5% margin for clock skew
const MIN_DELAY_MS = Math.ceil((SERVER_COOLDOWN_MS * COOLDOWN_BUFFER) / JITTER_FLOOR); // ≈ 6.18min
const MAX_DELAY_MS = 30 * 60_000;
const FALLBACK_DELAY_MS = MIN_DELAY_MS; // initial / on-failure back-off

/**
 * A terminal callback disposition means this MCP process no longer owns a
 * live invocation, so another refresh cannot succeed. `stale_invocation` is
 * retained for legacy/race records: it is not a persisted terminal state, but
 * the server explicitly fences the old invocation from ever refreshing again.
 */
const NON_RESCHEDULABLE_REFRESH_REASONS: ReadonlySet<CallbackAuthFailureReason> = new Set([
  'completed',
  'failed',
  'interrupted',
  'replaced',
  'revoked',
  'canceled',
  'stale_invocation',
]);

export type RefreshTickResult =
  | { ok: true; shouldReschedule: true; nextDelayMs: number }
  | { ok: false; shouldReschedule: true; nextDelayMs: number }
  | { ok: false; shouldReschedule: false; nextDelayMs: 0; terminalReason: CallbackAuthFailureReason };

/**
 * clamp(ttlRemainingMs/4, 5min, 30min) + ±15% jitter.
 *
 * Pure function — testable without a running timer or HTTP layer.
 */
export function computeNextRefreshDelay(ttlRemainingMs: number): number {
  const proportional = ttlRemainingMs / 4;
  const clamped = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, proportional));
  const jitter = JITTER_FLOOR + Math.random() * 0.3; // ±15% around 1.0
  return Math.floor(clamped * jitter);
}

/**
 * Recoverable refresh failures do not crash. They return a rescheduling
 * decision so the loop can keep trying.
 */
export function handleRefreshFailure(_err: unknown): { shouldReschedule: true; delayMs: number } {
  return { shouldReschedule: true, delayMs: FALLBACK_DELAY_MS };
}

function recoverableRefreshTickResult(err: unknown): Extract<RefreshTickResult, { shouldReschedule: true }> {
  const failure = handleRefreshFailure(err);
  return { ok: false, shouldReschedule: failure.shouldReschedule, nextDelayMs: failure.delayMs };
}

function terminalReasonFromRefreshFailure(status: number, body: string): CallbackAuthFailureReason | undefined {
  if (status !== 401) return undefined;

  try {
    const parsed = JSON.parse(body) as { error?: unknown; reason?: unknown };
    if (parsed.error !== 'callback_auth_failed' || !isCallbackAuthFailureReason(parsed.reason)) return undefined;
    return NON_RESCHEDULABLE_REFRESH_REASONS.has(parsed.reason) ? parsed.reason : undefined;
  } catch {
    return undefined;
  }
}

export interface RefreshLoopHandle {
  stop: () => void;
}

/**
 * Default per-tick fetch timeout. Without an AbortSignal a hung TCP socket
 * leaves the await pending forever and the loop never reschedules.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * Single refresh attempt — raw fetch, no retry layer (the loop itself is the
 * retry mechanism). Returns a typed scheduling decision. Only a typed 401
 * lifecycle terminal stops the loop; malformed responses, other 401 reasons,
 * timeouts, 429, and 5xx remain recoverable and retain the fallback schedule.
 */
export async function performRefreshTick(options: { timeoutMs?: number } = {}): Promise<RefreshTickResult> {
  const config = getCallbackConfig();
  if (!config) {
    return recoverableRefreshTickResult(new Error('callback config unavailable'));
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  try {
    const response = await fetch(`${config.apiUrl}/api/callbacks/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(config) },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const terminalReason = terminalReasonFromRefreshFailure(response.status, body);
      if (terminalReason) {
        return { ok: false, shouldReschedule: false, nextDelayMs: 0, terminalReason };
      }
      console.warn(`[refresh-loop] refresh failed (${response.status}):`, body.slice(0, 200));
      return recoverableRefreshTickResult({ status: response.status, body });
    }

    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed?.ok && typeof parsed.ttlRemainingMs === 'number') {
        return { ok: true, shouldReschedule: true, nextDelayMs: computeNextRefreshDelay(parsed.ttlRemainingMs) };
      }
    } catch {
      /* malformed response — fall back */
    }
    return recoverableRefreshTickResult(new Error('malformed refresh response'));
  } catch (err) {
    console.warn('[refresh-loop] refresh threw:', err);
    return recoverableRefreshTickResult(err);
  }
}

/**
 * Installing custom SIGINT/SIGTERM handlers without calling process.exit()
 * suppresses Node's default termination behavior, leaving the MCP process
 * unable to shut down on signals. exit(128 + signum) preserves signal
 * semantics for shells/process managers (SIGTERM → 143, SIGINT → 130).
 *
 * Process is dependency-injected for tests.
 */
export interface ShutdownProcess {
  on: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => unknown;
  exit: (code: number) => void;
}

const SIGNAL_NUMBERS: Record<'SIGTERM' | 'SIGINT', number> = { SIGTERM: 15, SIGINT: 2 };

export function installShutdownHandlers(
  loop: RefreshLoopHandle,
  proc: ShutdownProcess = process,
  beforeExit?: () => Promise<void> | void,
): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    proc.on(signal, () => {
      loop.stop();
      const exit = () => proc.exit(128 + SIGNAL_NUMBERS[signal]);
      if (!beforeExit) {
        exit();
        return;
      }
      try {
        const cleanup = beforeExit();
        if (cleanup && typeof cleanup.then === 'function') {
          void cleanup.then(exit, exit);
        } else {
          exit();
        }
      } catch {
        exit();
      }
    });
  }
}

/**
 * Spawns a background timer that periodically calls /api/callbacks/refresh-token.
 * Returns a handle to stop the loop on process exit.
 *
 * No-op (warn) when callback config is absent — refresh isn't applicable.
 */
export function startRefreshLoop(): RefreshLoopHandle {
  const config = getCallbackConfig();
  if (!config) {
    console.warn('[refresh-loop] no callback config — refresh loop disabled');
    return { stop: () => {} };
  }

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const result = await performRefreshTick();
    if (!result.shouldReschedule) {
      stopped = true;
      return;
    }
    if (!stopped) {
      timer = setTimeout(tick, result.nextDelayMs);
      timer.unref();
    }
  };

  // First tick after FALLBACK_DELAY_MS (let server settle).
  timer = setTimeout(tick, FALLBACK_DELAY_MS);
  timer.unref();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}