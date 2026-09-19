/**
 * Audio capture proxy controller (B21 assets; ported from clowder-ai
 * `routes/audio-proxy.ts`, F195 audio-capture).
 *
 * Proxies frontend requests to a standalone audio-service. flowforge has no
 * bundled audio-service (it is a platform route, S2), so the service URL is
 * enabled ONLY by explicit injection/`AUDIO_SERVICE_URL`; when absent every
 * endpoint returns 502 to avoid accidentally connecting to a stray process.
 *
 * The low-latency streaming endpoint `GET /api/audio/events` (SSE) does not fit
 * the JSON-only contract layer and is deliberately carried by the host platform
 * router in S2 — this controller surfaces it as a 501 so the frontend surface is
 * explicit rather than silently missing.
 */

import { randomUUID } from 'node:crypto';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';

/** Injectable timer facade so lease heartbeat is unit-testable without real timers. */
export interface Scheduler {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_LEASE_TTL_MS = 15_000;
const SHUTDOWN_STOP_TIMEOUT_MS = 5_000;

export interface AudioProxyControllerOptions {
  /** Explicit audio-service base URL. Absent → all endpoints return 502. */
  audioServiceUrl?: string | undefined;
  /** Transport (defaults to global fetch; inject for contract tests). */
  fetchImpl?: typeof fetch | undefined;
  /** Lease time-to-live in ms (default 15s, mirrors clowder `CONTROLLER_LEASE_TTL_S`). */
  leaseTtlMs?: number | undefined;
  /** Lease heartbeat cadence in ms (defaults to ttl/3). */
  heartbeatIntervalMs?: number | undefined;
  /** Timer facade (defaults to Node timers). */
  scheduler?: Scheduler | undefined;
  /** Clock (defaults to `Date.now`). */
  now?: () => number;
}

interface ActiveCaptureLease {
  token: string;
  threadId: string;
  heartbeat: unknown;
  expiresAtMs: number;
}

function captureBody(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

const AUDIO_UNAVAILABLE = { error: 'Audio service unavailable' };

export class AudioProxyController extends RestControllerBase {
  private readonly audioServiceUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly leaseTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly scheduler: Scheduler;
  private readonly nowFn: () => number;
  private activeLease: ActiveCaptureLease | null = null;

  constructor(private readonly identity: RequestContextResolver, opts: AudioProxyControllerOptions = {}) {
    super();
    this.audioServiceUrl = opts.audioServiceUrl;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? Math.floor(this.leaseTtlMs / 3);
    this.scheduler = opts.scheduler ?? defaultScheduler();
    this.nowFn = opts.now ?? (() => Date.now());
    this.registerRoutes();
  }

  /** Configured service base URL, or null when the proxy is not enabled. */
  private serviceBase(): string | null {
    return this.audioServiceUrl && this.audioServiceUrl.length > 0 ? this.audioServiceUrl.replace(/\/$/, '') : null;
  }

  private requireIdentity(req: { headers: Record<string, string | undefined> }): boolean {
    return this.identity.resolveUserId(req as never) !== null;
  }

  private releaseLease(lease: ActiveCaptureLease): void {
    this.scheduler.clearInterval(lease.heartbeat);
    if (this.activeLease === lease) this.activeLease = null;
  }

  private releaseLeaseIfExpired(lease: ActiveCaptureLease | null): boolean {
    if (!lease || this.nowFn() < lease.expiresAtMs) return false;
    this.releaseLease(lease);
    return true;
  }

  private getActiveLease(): ActiveCaptureLease | null {
    const lease = this.activeLease;
    return this.releaseLeaseIfExpired(lease) ? null : lease;
  }

  private async renewLease(): Promise<void> {
    const lease = this.activeLease;
    const base = this.serviceBase();
    if (!lease || !base) return;
    try {
      const resp = await this.fetchImpl(`${base}/lease`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lease_token: lease.token, thread_id: lease.threadId }),
        signal: AbortSignal.timeout(2_000),
      });
      if (!resp.ok) {
        this.releaseLease(lease);
      } else if (this.activeLease === lease) {
        lease.expiresAtMs = this.nowFn() + this.leaseTtlMs;
      }
    } catch {
      // Transient transport failure: keep retrying until the last confirmed renewal
      // expires (the sidecar independently finalizes on the same TTL).
      this.releaseLeaseIfExpired(lease);
    }
  }

  private async proxyJson(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const base = this.serviceBase();
    if (!base) throw new Error('Audio service not configured');
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const resp = await this.fetchImpl(`${base}${path}`, init);
    const data = (await resp.json()) as unknown;
    return { status: resp.status, body: data };
  }

  /** Graceful stop on shutdown (mirrors clowder `onClose`). Idempotent. */
  async dispose(): Promise<void> {
    const lease = this.activeLease;
    this.activeLease = null;
    const base = this.serviceBase();
    if (!lease || !base) return;
    this.scheduler.clearInterval(lease.heartbeat);
    try {
      await this.fetchImpl(`${base}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lease_token: lease.token, reason: 'runtime-graceful-shutdown' }),
        signal: AbortSignal.timeout(SHUTDOWN_STOP_TIMEOUT_MS),
      });
    } catch {
      // A failed graceful stop still converges through controller lease expiry.
    }
  }

  private registerRoutes(): void {
    // POST /api/audio/start
    this.post('/api/audio/start', async (req) => {
      if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
      const body = captureBody(req.body);
      const threadId = body?.thread_id;
      if (typeof threadId !== 'string' || !threadId.trim()) {
        return { status: 400, body: { error: 'thread_id is required for active audio capture' } };
      }
      if (this.getActiveLease()) {
        return { status: 409, body: { error: 'Audio capture is already owned by this runtime' } };
      }
      const base = this.serviceBase();
      if (!base) return { status: 502, body: AUDIO_UNAVAILABLE };
      try {
        const resp = await this.fetchImpl(`${base}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            thread_id: threadId.trim(),
            controller_id: `api-runtime:${randomUUID()}`,
            lease_ttl_s: Math.floor(this.leaseTtlMs / 1000),
          }),
        });
        const data = (await resp.json()) as Record<string, unknown>;
        if (!resp.ok) return { status: resp.status, body: data };
        const token = data['lease_token'];
        if (typeof token !== 'string' || !token) {
          return { status: 502, body: { error: 'Audio service start omitted controller lease token' } };
        }
        const heartbeat = this.scheduler.setInterval(() => void this.renewLease(), this.heartbeatIntervalMs);
        this.activeLease = {
          token,
          threadId: threadId.trim(),
          heartbeat,
          expiresAtMs: this.nowFn() + this.leaseTtlMs,
        };
        const clientData = { ...data };
        delete clientData['lease_token'];
        return { status: resp.status, body: clientData };
      } catch {
        return { status: 502, body: AUDIO_UNAVAILABLE };
      }
    });

    // POST /api/audio/stop
    this.post('/api/audio/stop', async (req) => {
      if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
      const lease = this.getActiveLease();
      if (!lease) return { status: 409, body: { error: 'No audio capture lease is owned by this runtime' } };
      const base = this.serviceBase();
      if (!base) return { status: 502, body: AUDIO_UNAVAILABLE };
      try {
        const resp = await this.fetchImpl(`${base}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lease_token: lease.token, reason: 'controller-stop' }),
        });
        const data = (await resp.json()) as unknown;
        if (resp.ok) this.releaseLease(lease);
        return { status: resp.status, body: data };
      } catch {
        return { status: 502, body: AUDIO_UNAVAILABLE };
      }
    });

    // GET /api/audio/status
    this.get('/api/audio/status', (req) => this.jsonProxyRoute(req, 'GET', '/status'));

    // GET /api/audio/transcript
    this.get('/api/audio/transcript', async (req) => {
      if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
      const params = new URLSearchParams();
      for (const key of ['from', 'to', 'latest', 'mode', 'format'] as const) {
        const value = req.query?.[key];
        if (value) params.set(key, value);
      }
      const qs = params.toString();
      try {
        const result = await this.proxyJson('GET', `/transcript${qs ? `?${qs}` : ''}`);
        return { status: result.status, body: result.body };
      } catch {
        return { status: 502, body: AUDIO_UNAVAILABLE };
      }
    });

    // POST passthroughs (transport errors → 502, mirroring clowder).
    this.post('/api/audio/enroll', (req) => this.jsonProxyPost(req, '/enroll'));
    this.post('/api/audio/transcript/correct', (req) => this.jsonProxyPost(req, '/transcript/correct'));
    this.post('/api/audio/map-speaker', (req) => this.jsonProxyPost(req, '/map-speaker'));
    this.post('/api/audio/advisory-mode', (req) => this.jsonProxyPost(req, '/advisory-mode'));
    this.post('/api/audio/talking-points', (req) => this.jsonProxyPost(req, '/talking-points'));
    this.post('/api/audio/advisory-dnd', async (req) => {
      if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
      try {
        const result = await this.proxyJson('POST', '/advisory-dnd');
        return { status: result.status, body: result.body };
      } catch {
        return { status: 502, body: AUDIO_UNAVAILABLE };
      }
    });
    this.post('/api/audio/pause', (req) => this.jsonProxyLeased(req, '/pause'));
    this.post('/api/audio/resume', (req) => this.jsonProxyLeased(req, '/resume'));

    // GET /api/audio/sources
    this.get('/api/audio/sources', (req) => this.jsonProxyRoute(req, 'GET', '/sources'));

    // GET /api/audio/events — low-level SSE streaming is a host platform route (S2),
    // not expressible in the JSON-only contract layer. Surface as explicit 501.
    this.get('/api/audio/events', (req) => {
      if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
      return {
        status: 501,
        body: { error: 'SSE audio event streaming is provided by the host platform route (S2)' },
      };
    });
  }

  private async jsonProxyRoute(req: { headers: Record<string, string | undefined> }, method: 'GET' | 'POST', path: string): Promise<{ status: number; body: unknown }> {
    if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
    try {
      const result = await this.proxyJson(method, path);
      return { status: result.status, body: result.body };
    } catch {
      return { status: 502, body: AUDIO_UNAVAILABLE };
    }
  }

  private async jsonProxyPost(req: { headers: Record<string, string | undefined>; body?: unknown }, path: string): Promise<{ status: number; body: unknown }> {
    if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
    try {
      const result = await this.proxyJson('POST', path, req.body ?? undefined);
      return { status: result.status, body: result.body };
    } catch {
      return { status: 502, body: AUDIO_UNAVAILABLE };
    }
  }

  private async jsonProxyLeased(req: { headers: Record<string, string | undefined> }, path: string): Promise<{ status: number; body: unknown }> {
    if (!this.requireIdentity(req)) return { status: 401, body: { error: 'Identity required' } };
    const lease = this.getActiveLease();
    const base = this.serviceBase();
    if (!lease || !base) return { status: 409, body: { error: 'No audio capture lease is owned by this runtime' } };
    try {
      const result = await this.proxyJson('POST', path, { lease_token: lease.token });
      return { status: result.status, body: result.body };
    } catch {
      return { status: 502, body: AUDIO_UNAVAILABLE };
    }
  }
}

function defaultScheduler(): Scheduler {
  return {
    setInterval(fn, ms) {
      return setInterval(fn, ms);
    },
    clearInterval(handle) {
      clearInterval(handle as ReturnType<typeof setInterval>);
    },
  };
}