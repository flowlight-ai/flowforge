/**
 * Session transcript controller + pagination helpers contract tests.
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { SessionTranscriptController, MemoryTranscriptEventsSource } from '../src/controllers/session-transcript.ts';
import { MemorySessionChainStore, MemoryThreadStore } from '../src/ports/stores.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';
import { paginateTranscriptEvents, strictParseTranscriptInteger, normalizeTranscriptView, transcriptSearchSchema } from '../src/pure/transcript-format.ts';
import type { TranscriptEvent } from '../src/controllers/session-transcript.ts';

function req(method: string, url: string, opts: { headers?: Record<string, string | undefined>; query?: Record<string, string> } = {}): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.query ? { query: opts.query } : {}) };
}

function event(id: string, seq: number, payload: Record<string, unknown> = {}): TranscriptEvent {
  return { id, seq, ts: seq, type: 'message', payload };
}

function make(events: Record<string, TranscriptEvent[]>) {
  const sessionChainStore = new MemorySessionChainStore([
    { id: 's1', threadId: 't1', catId: 'cat1', userId: 'default-user', seq: 0, status: 'active' },
  ]);
  const threadStore = new MemoryThreadStore({ t1: { id: 't1', createdBy: 'default-user' } });
  const controller = new SessionTranscriptController({
    sessionChainStore,
    threadStore,
    eventsSource: new MemoryTranscriptEventsSource(events),
    identity: new DefaultRequestContextResolver(),
  });
  return { controller };
}

describe('paginateTranscriptEvents', () => {
  const events = [event('e1', 1), event('e2', 2), event('e3', 3), event('e4', 4)];
  it('pages with a default limit and exposes nextCursor', () => {
    const page = paginateTranscriptEvents(events, { limit: 2 });
    expect(page.count).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('2');
  });
  it('converges on the end with null nextCursor', () => {
    const page = paginateTranscriptEvents(events, { limit: 10 });
    expect(page.count).toBe(4);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
  it('resumes from a numeric cursor', () => {
    const page = paginateTranscriptEvents(events, { limit: 2, cursor: '3' });
    expect(page.events.map((e) => e.seq)).toEqual([3, 4]);
  });
});

describe('strictParseTranscriptInteger / normalizeTranscriptView', () => {
  it('accepts only pure decimal strings', () => {
    expect(strictParseTranscriptInteger('42')).toBe(42);
    expect(Number.isNaN(strictParseTranscriptInteger('4 2'))).toBe(true);
    expect(Number.isNaN(strictParseTranscriptInteger('4.2'))).toBe(true);
  });
  it('normalizes views against the valid set', () => {
    expect(normalizeTranscriptView('chat')).toBe('chat');
    expect(normalizeTranscriptView(undefined)).toBe('raw');
    expect(normalizeTranscriptView('bogus')).toBe('raw');
  });
});

describe('SessionTranscriptController /events', () => {
  const events = { s1: [event('e1', 1, { text: 'hi' }), event('e2', 2, { text: 'there' }), event('e3', 3, { text: 'bye' })] };
  it('returns 404 for a missing session', async () => {
    const { controller } = make(events);
    const res = await controller.handle(req('GET', '/api/sessions/nope/events'));
    expect(res.status).toBe(404);
  });
  it('returns 401 without identity', async () => {
    const { controller } = make(events);
    const res = await controller.handle(req('GET', '/api/sessions/s1/events'));
    expect(res.status).toBe(401);
  });
  it('filters events by cursor + limit and honors the view envelope', async () => {
    const { controller } = make(events);
    const res = await controller.handle(
      req('GET', '/api/sessions/s1/events', { query: { limit: '2', cursor: '2', view: 'chat' }, headers: { 'x-cat-cafe-user': 'default-user' } }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { view: string; events: TranscriptEvent[]; count: number };
    expect(body.view).toBe('chat');
    expect(body.events.map((e) => e.seq)).toEqual([2, 3]);
    expect(body.count).toBe(2);
  });
});

describe('SessionTranscriptController digest and invocation', () => {
  const events = { s1: [event('e1', 1, { text: 'hello' }), event('e2', 2, { text: 'world', invocationId: 'inv1' })] };
  it('builds an extractive digest with whitespace join', async () => {
    const { controller } = make(events);
    const res = await controller.handle(req('GET', '/api/sessions/s1/digest'));
    expect(res.status).toBe(200);
    expect((res.body as { digest: string }).digest).toBe('hello world');
    expect((res.body as { eventCount: number }).eventCount).toBe(2);
  });
  it('filters events by invocation id', async () => {
    const { controller } = make(events);
    const res = await controller.handle(req('GET', '/api/sessions/s1/invocations/inv1'));
    expect(res.status).toBe(200);
    expect((res.body as { events: TranscriptEvent[] }).events.map((e) => e.id)).toEqual(['e2']);
  });
});

describe('SessionTranscriptController search', () => {
  const events = { s1: [event('e1', 1, { text: 'cat' }), event('e2', 2, { text: 'dog' })] };
  it('rejects an invalid search query', async () => {
    const { controller } = make(events);
    const res = await controller.handle(req('GET', '/api/threads/t1/sessions/search', { query: {} }));
    expect(res.status).toBe(400);
  });
  it('searches payloads and returns a results envelope', async () => {
    const { controller } = make(events);
    const res = await controller.handle(req('GET', '/api/threads/t1/sessions/search', { query: { q: 'cat' } }));
    expect(res.status).toBe(200);
    expect((res.body as { totalMatches: number }).totalMatches).toBe(1);
  });
  it('validates the search schema against typed expectations', () => {
    const parsed = transcriptSearchSchema.safeParse({ q: 'x', limit: '5', scope: 'both' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(5);
  });
});