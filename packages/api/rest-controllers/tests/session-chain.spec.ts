/**
 * Session chain controller contract tests (list/get/seal/unseal/bind).
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { SessionChainController, type SessionChainControllerOptions } from '../src/controllers/session-chain.ts';
import {
  MemorySessionChainStore,
  MemorySessionSealer,
  MemoryThreadStore,
  type ISessionChainStore,
  type SessionSealer,
  type Thread,
} from '../src/ports/stores.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';
import type { SessionRecord } from '../src/contract/session.ts';

function req(
  method: string,
  url: string,
  opts: { headers?: Record<string, string | undefined>; body?: unknown; query?: Record<string, string> } = {},
): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}), ...(opts.query ? { query: opts.query } : {}) };
}

/** A real in-memory sealer seam that seals the store on finalize (matches host reaper). */
class SealingSealer implements SessionSealer {
  constructor(private readonly store: ISessionChainStore) {}
  async requestSeal(): Promise<{ accepted: boolean; status?: string }> {
    return { accepted: true, status: 'active' };
  }
  async finalize(input: { sessionId: string }): Promise<{ sealed: boolean; clean: boolean }> {
    this.store.update?.(input.sessionId, 'sealed');
    return { sealed: true, clean: true };
  }
}

const BUILDER_DEFAULTS = { userId: 'default-user' };

function record(over: Partial<SessionRecord> & { id: string; threadId: string; catId: string }): SessionRecord {
  return { userId: BUILDER_DEFAULTS.userId, seq: 0, status: 'active', messageCount: 0, ...over };
}

function thread(id: string, createdBy = 'default-user', extra: Partial<Thread> = {}): Thread {
  return { id, createdBy, ...extra };
}

interface MakeOpts {
  threads?: Record<string, Thread>;
  sessions?: SessionRecord[];
  options?: Partial<SessionChainControllerOptions>;
  sealer?: SessionSealer;
}

function make(o: MakeOpts = {}) {
  const threadStore = new MemoryThreadStore(o.threads ?? {});
  const sessionChainStore = new MemorySessionChainStore(o.sessions ?? []);
  const sealer = o.sealer ?? new MemorySessionSealer();
  const controller = new SessionChainController({
    sessionChainStore,
    threadStore,
    sessionSealer: sealer,
    identity: new DefaultRequestContextResolver(),
    ...o.options,
  });
  return { controller, sessionChainStore, threadStore };
}

describe('session list', () => {
  const sessions = [
    record({ id: 's1', threadId: 't1', catId: 'cat1' }),
    record({ id: 's2', threadId: 't1', catId: 'cat1' }),
    record({ id: 's3', threadId: 't1', catId: 'cat2' }),
  ];
  it('lists all sessions for a thread when no cat filter is given', async () => {
    const { controller } = make({ threads: { t1: thread('t1') }, sessions });
    const res = await controller.handle(req('GET', '/api/threads/t1/sessions'));
    expect(res.status).toBe(200);
    const ids = (res.body as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id);
    expect(ids.sort()).toEqual(['s1', 's2', 's3']);
  });
  it('filters by catId when provided', async () => {
    const { controller } = make({ threads: { t1: thread('t1') }, sessions });
    const res = await controller.handle(req('GET', '/api/threads/t1/sessions', { query: { catId: 'cat1' } }));
    const ids = (res.body as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id);
    expect(ids.sort()).toEqual(['s1', 's2']);
  });
  it('rejects a cross-cat query when header conflicts with query cat', async () => {
    const { controller } = make({ threads: { t1: thread('t1') }, sessions });
    const res = await controller.handle(req('GET', '/api/threads/t1/sessions', { query: { catId: 'cat2' }, headers: { 'x-cat-id': 'cat1' } }));
    expect(res.status).toBe(403);
  });
  it('returns 403 for a thread owned by another user', async () => {
    const { controller } = make({ threads: { t1: thread('t1', 'someone-else') }, sessions });
    const res = await controller.handle(req('GET', '/api/threads/t1/sessions'));
    expect(res.status).toBe(403);
  });
});

describe('session get', () => {
  it('returns 404 when the session is missing', async () => {
    const { controller } = make({ threads: { t1: thread('t1') } });
    const res = await controller.handle(req('GET', '/api/sessions/nope'));
    expect(res.status).toBe(404);
  });
  it('returns the session for an authorized user', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [session] });
    const res = await controller.handle(req('GET', '/api/sessions/s1'));
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe('s1');
  });
  it('returns 403 when the thread is not accessible', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({ threads: { t1: thread('t1', 'other') }, sessions: [session] });
    const res = await controller.handle(req('GET', '/api/sessions/s1'));
    expect(res.status).toBe(403);
  });
});

describe('manual seal', () => {
  it('rejects 404 for an unknown session', async () => {
    const { controller } = make({ threads: { t1: thread('t1') } });
    const res = await controller.handle(req('POST', '/api/sessions/nope/seal'));
    expect(res.status).toBe(404);
  });
  it('rejects 403 when access is denied', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({ threads: { t1: thread('t1', 'other') }, sessions: [session] });
    const res = await controller.handle(req('POST', '/api/sessions/s1/seal'));
    expect(res.status).toBe(403);
  });
  it('rejects 409 when the session is not active', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1', status: 'sealed' });
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [session] });
    const res = await controller.handle(req('POST', '/api/sessions/s1/seal'));
    expect(res.status).toBe(409);
  });
  it('returns 503 when liveness cannot be established', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({
      threads: { t1: thread('t1') },
      sessions: [session],
      options: { resolveSessionSealLiveness: async () => ({ catIds: [], complete: false }) },
    });
    const res = await controller.handle(req('POST', '/api/sessions/s1/seal'));
    expect(res.status).toBe(503);
  });
  it('returns 409 when an active invocation occupies the cat', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({
      threads: { t1: thread('t1') },
      sessions: [session],
      options: {
        resolveSessionSealLiveness: async () => ({ catIds: ['cat1'], complete: true }),
      },
    });
    const res = await controller.handle(req('POST', '/api/sessions/s1/seal'));
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('SESSION_ACTIVE_INVOCATION');
  });
  it('seals a ready session (200) using a store-sealing sealer', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const threadStore = new MemoryThreadStore({ t1: thread('t1') });
    const sessionChainStore = new MemorySessionChainStore([session]);
    const controller = new SessionChainController({
      sessionChainStore,
      threadStore,
      sessionSealer: new SealingSealer(sessionChainStore),
      identity: new DefaultRequestContextResolver(),
      resolveSessionSealLiveness: async () => ({ catIds: [], complete: true }),
    });
    const res = await controller.handle(req('POST', '/api/sessions/s1/seal'));
    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe('sealed');
  });
  it('rejects 409 with seal-race when the sealer declines', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({
      threads: { t1: thread('t1') },
      sessions: [session],
      sealer: new MemorySessionSealer({ requestFail: true }),
      options: { resolveSessionSealLiveness: async () => ({ catIds: [], complete: true }) },
    });
    const res = await controller.handle(req('POST', '/api/sessions/s1/seal'));
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('SESSION_SEAL_RACE');
  });
});

describe('unseal / restore', () => {
  const sealedActivePair = () => [
    record({ id: 'sealed1', threadId: 't1', catId: 'cat1', status: 'sealed' }),
    record({ id: 'active1', threadId: 't1', catId: 'cat1' }),
  ];
  it('returns already_active when the target session is active', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [session] });
    const res = await controller.handle(req('POST', '/api/sessions/s1/unseal', { body: {} }));
    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe('already_active');
  });
  it('requires confirmation when a different active session exists', async () => {
    const [sealed1, active1] = sealedActivePair();
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [sealed1, active1] });
    const res = await controller.handle(req('POST', '/api/sessions/sealed1/unseal', { body: {} }));
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('active_session_confirmation_required');
  });
  it('restores a historical sealed session when there is no active competitor', async () => {
    const session = record({ id: 'sealed1', threadId: 't1', catId: 'cat1', status: 'sealed' });
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [session] });
    const res = await controller.handle(req('POST', '/api/sessions/sealed1/unseal', { body: {} }));
    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe('restored');
  });
  it('returns 409 for a non-sealed, non-active status via store result', async () => {
    const session = record({ id: 'completed1', threadId: 't1', catId: 'cat1', status: 'completed' });
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [session] });
    const res = await controller.handle(req('POST', '/api/sessions/completed1/unseal', { body: {} }));
    expect(res.status).toBe(409);
  });
  it('returns 404 when the target session is missing', async () => {
    const { controller } = make({ threads: { t1: thread('t1') } });
    const res = await controller.handle(req('POST', '/api/sessions/nope/unseal', { body: {} }));
    expect(res.status).toBe(404);
  });
});

describe('bind cli session', () => {
  const catRegistry = { has: () => true };
  it('returns 400 for an unknown cat', async () => {
    const { controller } = make({ threads: { t1: thread('t1') }, options: { catRegistry: { has: () => false } } });
    const res = await controller.handle(req('PATCH', '/api/threads/t1/sessions/cat1/bind', { body: { cliSessionId: 'cli-x' } }));
    expect(res.status).toBe(400);
  });
  it('returns 400 for a malformed body', async () => {
    const { controller } = make({ threads: { t1: thread('t1') }, options: { catRegistry } });
    const res = await controller.handle(req('PATCH', '/api/threads/t1/sessions/cat1/bind', { body: {} }));
    expect(res.status).toBe(400);
  });
  it('returns 404 when the thread is missing', async () => {
    const { controller } = make({ options: { catRegistry } });
    const res = await controller.handle(req('PATCH', '/api/threads/t1/sessions/cat1/bind', { body: { cliSessionId: 'cli-x' } }));
    expect(res.status).toBe(404);
  });
  it('returns 403 when access to the thread is denied', async () => {
    const { controller } = make({ threads: { t1: thread('t1', 'other') }, options: { catRegistry } });
    const res = await controller.handle(req('PATCH', '/api/threads/t1/sessions/cat1/bind', { body: { cliSessionId: 'cli-x' } }));
    expect(res.status).toBe(403);
  });
  it('binds an existing active session as updated', async () => {
    const session = record({ id: 's1', threadId: 't1', catId: 'cat1' });
    const { controller } = make({ threads: { t1: thread('t1') }, sessions: [session], options: { catRegistry } });
    const res = await controller.handle(req('PATCH', '/api/threads/t1/sessions/cat1/bind', { body: { cliSessionId: 'cli-x' } }));
    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe('updated');
  });
  it('creates a session and reports historyImport for a fresh bind', async () => {
    const { controller } = make({
      threads: { t1: thread('t1') },
      options: { catRegistry, historyImporter: async () => ({ imported: true }) },
    });
    const res = await controller.handle(req('PATCH', '/api/threads/t1/sessions/cat1/bind', { body: { cliSessionId: 'cli-y' } }));
    expect(res.status).toBe(200);
    expect((res.body as { mode: string; historyImport: { imported: boolean } }).mode).toBe('created');
    expect((res.body as { historyImport: { imported: boolean } }).historyImport.imported).toBe(true);
  });
});