/**
 * Session runtime controller + native compaction target resolution contract tests.
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { SessionRuntimeController, resolveNativeCompactionTarget, type NativeCompactionCandidate } from '../src/controllers/session-runtime.ts';
import { MemoryRuntimeSessionStore, type ExternalRuntimeSession } from '../src/ports/stores.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';

function req(method: string, url: string, opts: { headers?: Record<string, string | undefined>; body?: unknown; query?: Record<string, string> } = {}): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}), ...(opts.query ? { query: opts.query } : {}) };
}

const ext: ExternalRuntimeSession = {
  sessionId: 'rs1',
  threadId: 't1',
  catId: 'cat1',
  runtime: 'antigravity-desktop',
  runtimeSessionId: 'ags-1',
  surface: 'ide-direct',
  lastObservedAt: 1,
  lifecycleState: 'running',
};

function make() {
  const runtimeSessionStore = new MemoryRuntimeSessionStore();
  const controller = new SessionRuntimeController({
    runtimeSessionStore,
    identity: new DefaultRequestContextResolver(),
  });
  return { controller, runtimeSessionStore };
}

describe('resolveNativeCompactionTarget (pure)', () => {
  const candidates: NativeCompactionCandidate[] = [
    { sessionId: 'a', threadId: 't1', catId: 'cat1', runtime: 'r', lifecycleState: 'running' },
    { sessionId: 'b', threadId: 't1', catId: 'cat1', runtime: 'r', lifecycleState: 'running' },
    { sessionId: 'c', threadId: 't1', catId: 'cat2', runtime: 'r', lifecycleState: 'running' },
  ];
  it('returns a 404 no-target when nothing is shapable', () => {
    const res = resolveNativeCompactionTarget([{ sessionId: 'x', threadId: 't', catId: 'c', runtime: '', lifecycleState: '' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });
  it('resolves a single target', () => {
    const res = resolveNativeCompactionTarget([candidates[0] as NativeCompactionCandidate]);
    expect(res).toEqual({ ok: true, sessionId: 'a', runtime: 'r', lifecycleState: 'running' });
  });
  it('reports 409 when multiple shapable targets overlap', () => {
    const res = resolveNativeCompactionTarget(candidates, 'cat1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('compaction_target_ambiguous');
  });
  it('narrows by catId to a single target', () => {
    const res = resolveNativeCompactionTarget(candidates, 'cat2');
    expect(res.ok).toBe(true);
  });
});

describe('SessionRuntimeController /runtime-sessions', () => {
  it('lists external runtime sessions with a page envelope', async () => {
    const { controller, runtimeSessionStore } = make();
    runtimeSessionStore.registerExternal(ext);
    const res = await controller.handle(req('GET', '/api/runtime-sessions'));
    expect(res.status).toBe(200);
    const body = res.body as { sessions: ExternalRuntimeSession[]; totalMatches: number; truncated: boolean };
    expect(body.totalMatches).toBe(1);
    expect(body.sessions[0]?.runtimeSessionId).toBe('ags-1');
  });
  it('rejects an invalid query', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/runtime-sessions', { query: { runtime: 'other' } }));
    expect(res.status).toBe(400);
  });
});

describe('SessionRuntimeController register', () => {
  it('requires identity or an agent key', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/runtime-sessions/register', { body: { threadId: 't1', runtimeSessionId: 'x' } }));
    expect(res.status).toBe(401);
  });
  it('registers an external runtime session (201)', async () => {
    const { controller, runtimeSessionStore } = make();
    const res = await controller.handle(
      req('POST', '/api/runtime-sessions/register', {
        headers: { 'x-agent-key': 'k' },
        body: { threadId: 't1', runtimeSessionId: 'ags-9', lifecycleState: 'running' },
      }),
    );
    expect(res.status).toBe(201);
    const session = (res.body as { session: ExternalRuntimeSession }).session;
    expect(session.threadId).toBe('t1');
    expect(session.runtime).toBe('antigravity-desktop');
    expect(session.surface).toBe('cat-cafe-dispatch');
    expect(runtimeSessionStore.listExternal({})).toHaveLength(1);
  });
  it('returns 400 when threadId/runtimeSessionId are missing', async () => {
    const { controller } = make();
    const res = await controller.handle(req('POST', '/api/runtime-sessions/register', { headers: { 'x-agent-key': 'k' }, body: { threadId: 't1' } }));
    expect(res.status).toBe(400);
  });
});

describe('SessionRuntimeController compaction-target', () => {
  it('returns 503 when the native resolver is absent', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/threads/t1/compaction-target'));
    expect(res.status).toBe(503);
  });
  it('resolves a single compaction target (200)', async () => {
    const runtimeSessionStore = new MemoryRuntimeSessionStore();
    const controller = new SessionRuntimeController({
      runtimeSessionStore,
      identity: new DefaultRequestContextResolver(),
      compactionTarget: { candidates: () => [{ sessionId: 'a', threadId: 't1', catId: 'cat1', runtime: 'r', lifecycleState: 'running' }] },
    });
    const res = await controller.handle(req('GET', '/api/threads/t1/compaction-target'));
    expect(res.status).toBe(200);
    expect((res.body as { sessionId: string }).sessionId).toBe('a');
  });
});