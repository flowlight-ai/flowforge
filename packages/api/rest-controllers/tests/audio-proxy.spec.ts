/**
 * Audio proxy controller contract tests (B21 assets).
 * Covers identity gating, explicit-config 502, JSON passthrough, lease lifecycle
 * and the SSE 501 surface (deferred to the host platform route in S2).
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { AudioProxyController, type Scheduler } from '../src/controllers/audio-proxy.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';

function req(method: string, url: string, headers?: Record<string, string>, body?: unknown): HttpRequest {
  return {
    method,
    url,
    headers: headers ?? {},
    ...(body !== undefined ? { body: body as Record<string, unknown> } : {}),
  };
}

/** Deterministic fake transport recording calls; returns canned JSON per URL. */
function fakeFetch(routes: Record<string, (() => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>)> = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? init.body : undefined });
    const route = Object.keys(routes)
      .filter((key) => url.includes(key))
      // longest match wins so '/status' and '/sources' don't collide
      .sort((a, b) => b.length - a.length)[0];
    const handler = route ? (routes[route] as () => { status: number; body: unknown }) : () => ({ status: 404, body: { error: 'nope' } });
    const outcome = await handler();
    return {
      status: outcome.status,
      ok: outcome.status >= 200 && outcome.status < 300,
      async json() {
        return outcome.body;
      },
    } as Response;
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function fakeScheduler(): Scheduler & { timers: Array<{ fn: () => void }> } {
  const timers: Array<{ fn: () => void }> = [];
  return {
    timers,
    setInterval(fn) {
      const t = { fn };
      timers.push(t);
      return t;
    },
    clearInterval(handle) {
      const idx = timers.indexOf(handle as { fn: () => void });
      if (idx >= 0) timers.splice(idx, 1);
    },
  };
}

const identity = new DefaultRequestContextResolver();
function authed(headers?: Record<string, string>): Record<string, string> {
  return { 'x-cat-cafe-user': 'u1', ...(headers ?? {}) };
}

describe('AudioProxyController not-configured', () => {
  it('returns 502 for every endpoint when no audioServiceUrl is injected', async () => {
    const { fetch } = fakeFetch();
    const controller = new AudioProxyController(identity, { fetchImpl: fetch, scheduler: fakeScheduler() });
    const res = await controller.handle(req('GET', '/api/audio/status', authed()));
    expect(res.status).toBe(502);
  });
});

describe('AudioProxyController identity', () => {
  it('returns 401 without an acting user', async () => {
    const { fetch } = fakeFetch();
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: fakeScheduler(),
    });
    const res = await controller.handle(req('GET', '/api/audio/status'));
    expect(res.status).toBe(401);
  });
});

describe('AudioProxyController JSON passthrough', () => {
  it('proxies GET /status and preserves upstream status/body', async () => {
    const { fetch, calls } = fakeFetch({
      '/status': () => ({ status: 200, body: { mixer: 'ok' } }),
    });
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: fakeScheduler(),
    });
    const res = await controller.handle(req('GET', '/api/audio/status', authed()));
    expect(res.status).toBe(200);
    expect((res.body as { mixer: string }).mixer).toBe('ok');
    expect(calls[0]?.url).toBe('http://audio:9881/status');
  });

  it('maps illegal fetch panics to 502', async () => {
    let throwOnce = true;
    const impl = (async () => {
      if (throwOnce) {
        throwOnce = false;
      }
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: impl,
      scheduler: fakeScheduler(),
    });
    const res = await controller.handle(req('GET', '/api/audio/sources', authed()));
    expect(res.status).toBe(502);
  });
});

describe('AudioProxyController lease lifecycle', () => {
  it('start acquires a lease and proxies; data omits lease_token', async () => {
    const { fetch, calls } = fakeFetch({
      '/start': () => ({ status: 200, body: { lease_token: 'tok-1', device: 'mic' } }),
    });
    const sched = fakeScheduler();
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: sched,
      leaseTtlMs: 15000,
      heartbeatIntervalMs: 5000,
    });
    const res = await controller.handle(req('POST', '/api/audio/start', authed(), { thread_id: 't1' }));
    expect(res.status).toBe(200);
    expect((res.body as { device: string }).device).toBe('mic');
    expect((res.body as { lease_token?: string }).lease_token).toBeUndefined();
    expect(calls[0]?.body).toContain('"controller_id"');
    // heartbeat registered
    expect(sched.timers.length).toBe(1);

    // A second start is rejected while a lease is owned.
    const dup = await controller.handle(req('POST', '/api/audio/start', authed(), { thread_id: 't2' }));
    expect(dup.status).toBe(409);
  });

  it('start returns 502 when the upstream rejects the start', async () => {
    const { fetch } = fakeFetch({
      '/start': () => ({ status: 500, body: { error: 'nope' } }),
      '/status': () => ({ status: 200, body: {} }),
    });
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: fakeScheduler(),
    });
    const res = await controller.handle(req('POST', '/api/audio/start', authed(), { thread_id: 't1' }));
    expect(res.status).toBe(500);
  });

  it('stop releases the lease and reports missing leases as 409', async () => {
    const { fetch } = fakeFetch({
      '/start': () => ({ status: 200, body: { lease_token: 'tok-2' } }),
      '/stop': () => ({ status: 200, body: { stopped: true } }),
    });
    const sched = fakeScheduler();
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: sched,
    });
    await controller.handle(req('POST', '/api/audio/start', authed(), { thread_id: 't1' }));
    const stop = await controller.handle(req('POST', '/api/audio/stop', authed()));
    expect(stop.status).toBe(200);
    expect((stop.body as { stopped: boolean }).stopped).toBe(true);
    expect(sched.timers.length).toBe(0);
    const again = await controller.handle(req('POST', '/api/audio/stop', authed()));
    expect(again.status).toBe(409);
  });

  it('dispose performs graceful stop and clears the heartbeat', async () => {
    const { fetch } = fakeFetch({
      '/start': () => ({ status: 200, body: { lease_token: 'tok-3' } }),
      '/stop': () => ({ status: 200, body: { stopped: true } }),
    });
    const sched = fakeScheduler();
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: sched,
    });
    await controller.handle(req('POST', '/api/audio/start', authed(), { thread_id: 't1' }));
    await controller.dispose();
    expect(sched.timers.length).toBe(0);
  });
});

describe('AudioProxyController SSE surface', () => {
  it('returns 501 for /api/audio/events (host platform route in S2)', async () => {
    const { fetch } = fakeFetch();
    const controller = new AudioProxyController(identity, {
      audioServiceUrl: 'http://audio:9881',
      fetchImpl: fetch,
      scheduler: fakeScheduler(),
    });
    const res = await controller.handle(req('GET', '/api/audio/events', authed()));
    expect(res.status).toBe(501);
  });
});