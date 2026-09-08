/**
 * Session transcript controller (F24 Phase D + F98; paginated read + envelopes).
 *
 * GET /api/sessions/:sessionId/events?cursor&limit&view     — paginated events envelope
 * GET /api/sessions/:sessionId/digest                        — extractive digest
 * GET /api/sessions/:sessionId/invocations/:invocationId     — events for one invocation
 * GET /api/threads/:threadId/sessions/search?q               — full-text search envelope
 */

import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';
import type { ISessionChainStore } from '../ports/stores.ts';
import { IThreadStore } from '../ports/stores.ts';
import { canReadThreadRecord, resolveThreadAccess, threadAccessDeniedBody } from '../pure/thread-access.ts';
import {
  checkTranscriptCatAccess,
  normalizeTranscriptView,
  paginateTranscriptEvents,
  strictParseTranscriptInteger,
  transcriptSearchSchema,
  type TranscriptEvent,
} from '../pure/transcript-format.ts';

/** Transcript event source seam (host binds the transcript reader/writer in EP2). */
export interface TranscriptEventsSource {
  listEvents(sessionId: string): TranscriptEvent[] | Promise<TranscriptEvent[]>;
  search(opts: { q: string; sessionIds?: string[]; cats?: string[]; limit?: number }): TranscriptEvent[] | Promise<TranscriptEvent[]>;
}

export class MemoryTranscriptEventsSource implements TranscriptEventsSource {
  private readonly bySession = new Map<string, TranscriptEvent[]>();
  constructor(seed: Record<string, TranscriptEvent[]> = {}) {
    for (const [sessionId, events] of Object.entries(seed)) this.bySession.set(sessionId, events);
  }
  listEvents(sessionId: string): TranscriptEvent[] {
    return this.bySession.get(sessionId) ?? [];
  }
  search(opts: { q: string; sessionIds?: string[]; cats?: string[]; limit?: number }): TranscriptEvent[] {
    const wanted = opts.sessionIds?.length ? opts.sessionIds : [...this.bySession.keys()];
    const out: TranscriptEvent[] = [];
    for (const sessionId of wanted) {
      const events = this.bySession.get(sessionId) ?? [];
      for (const e of events) {
        if (JSON.stringify(e.payload).toLowerCase().includes(opts.q.toLowerCase())) out.push(e);
      }
    }
    return out.slice(0, opts.limit ?? 100);
  }
}

export interface SessionTranscriptControllerOptions {
  sessionChainStore: ISessionChainStore;
  threadStore: IThreadStore;
  eventsSource: TranscriptEventsSource;
  identity: RequestContextResolver;
}

export class SessionTranscriptController extends RestControllerBase {
  constructor(private readonly opts: SessionTranscriptControllerOptions) {
    super();
    this.registerRoutes();
  }

  private async loadSession(sessionId: string): Promise<{ session: NonNullable<Awaited<ReturnType<ISessionChainStore['get']>>>; threadId: string; catId: string } | { error: { status: number; body: unknown } }> {
    const session = await this.opts.sessionChainStore.get(sessionId);
    if (!session) return { error: { status: 404, body: { error: 'Session not found' } } };
    return { session, threadId: session.threadId, catId: session.catId };
  }

  private registerRoutes(): void {
    this.get('/api/sessions/:sessionId/events', async (req) => {
      const sessionId = req.params?.sessionId ?? '';
      const loaded = await this.loadSession(sessionId);
      if ('error' in loaded) return loaded.error;
      const userId = this.opts.identity.resolveUserId(req);
      if (!userId) return { status: 401, body: { error: 'Identity required' } };
      const thread = await this.opts.threadStore.get(loaded.threadId);
      const access = resolveThreadAccess({ thread, userId, resource: 'sessions', action: 'read' });
      if (access.status === 403) return { status: 403, body: threadAccessDeniedBody(access) };
      if (!canReadThreadRecord(access, loaded.session)) {
        return { status: 403, body: { error: 'Access denied', code: 'SESSION_RECORD_ACCESS_DENIED' } };
      }
      const catBlock = checkTranscriptCatAccess(req.headers, loaded.catId);
      if (catBlock) return { status: 403, body: { error: catBlock } };
      const events = await this.opts.eventsSource.listEvents(sessionId);
      const limit = req.query?.limit ? strictParseTranscriptInteger(req.query.limit) : undefined;
      const view = normalizeTranscriptView(req.query?.view);
      const page = paginateTranscriptEvents(events, {
        ...(limit !== undefined ? { limit } : {}),
        cursor: req.query?.cursor ?? null,
      });
      return { status: 200, body: { sessionId, view, ...page } };
    });

    this.get('/api/sessions/:sessionId/digest', async (req) => {
      const sessionId = req.params?.sessionId ?? '';
      const loaded = await this.loadSession(sessionId);
      if ('error' in loaded) return loaded.error;
      const events = await this.opts.eventsSource.listEvents(sessionId);
      const digest = events
        .map((e) => (typeof e.payload?.text === 'string' ? e.payload.text : ''))
        .join(' ')
        .slice(0, 500);
      return { status: 200, body: { sessionId, digest, eventCount: events.length } };
    });

    this.get('/api/sessions/:sessionId/invocations/:invocationId', async (req) => {
      const sessionId = req.params?.sessionId ?? '';
      const invocationId = req.params?.invocationId ?? '';
      const loaded = await this.loadSession(sessionId);
      if ('error' in loaded) return loaded.error;
      const events = (await this.opts.eventsSource.listEvents(sessionId)).filter((e) => e.payload?.invocationId === invocationId);
      return { status: 200, body: { sessionId, invocationId, events } };
    });

    this.get('/api/threads/:threadId/sessions/search', async (req) => {
      const parsed = transcriptSearchSchema.safeParse(req.query);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid search query', details: parsed.error.flatten() } };
      }
      const sessionIds = parsed.data.sessionIds ? parsed.data.sessionIds.split(',') : undefined;
      const cats = parsed.data.cats ? parsed.data.cats.split(',') : undefined;
      const results = await this.opts.eventsSource.search({
        q: parsed.data.q,
        ...(sessionIds ? { sessionIds } : {}),
        ...(cats ? { cats } : {}),
        ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      });
      return { status: 200, body: { query: parsed.data.q, results, totalMatches: results.length } };
    });
  }
}

export type { TranscriptEvent };