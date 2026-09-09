/**
 * Session CLI hooks controller — seal / latest-digest / sop-bookmark.
 *
 * Consumed by the CA-CLI callbacks. All heavy persistence is delegated to
 * injected seams; this controller performs param validation + routing only.
 */

import { sealSchema, sopBookmarkSchema } from '../contract/session.ts';
import type { SessionRecord } from '../contract/session.ts';
import { MESSAGES } from '../contract/messages.ts';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';
import type { IMessageStore, ISessionChainStore, SessionSealer } from '../ports/stores.ts';

export interface SessionHooksControllerOptions {
  sessionChainStore: ISessionChainStore;
  sessionSealer: SessionSealer;
  identity: RequestContextResolver;
  messageStore?: IMessageStore;
  /** Title/summary derivatives for the latest-digest hook (host wires in EP2). */
  latestDigest?: (threadId: string) => string | null | Promise<string | null>;
}

export class SessionHooksController extends RestControllerBase {
  constructor(private readonly opts: SessionHooksControllerOptions) {
    super();
    this.registerRoutes();
  }

  private async resolveSessionByCliSessionId(cliSessionId: string): Promise<SessionRecord | null> {
    return this.opts.sessionChainStore.getByCliSessionId(cliSessionId);
  }

  private async sealCli(cliSessionId: string): Promise<{ status: number; body: unknown }> {
    const session = await this.resolveSessionByCliSessionId(cliSessionId);
    if (!session) return { status: 404, body: { error: MESSAGES.sessionNotFound, code: MESSAGES.sessionNotFoundCode } };
    if (session.status !== 'active') {
      return {
        status: 409,
        body: { error: MESSAGES.onlyActiveSealable, code: MESSAGES.sessionNotActiveCode, currentStatus: session.status },
      };
    }
    const accepted = await this.opts.sessionSealer.requestSeal({ sessionId: session.id, reason: 'cli_hook' });
    if (!accepted.accepted) {
      return { status: 409, body: { error: MESSAGES.sealRace, code: MESSAGES.sealRaceCode } };
    }
    const finalization = await this.opts.sessionSealer.finalize({ sessionId: session.id });
    const sealed = await this.opts.sessionChainStore.get(session.id);
    if (!sealed || sealed.status !== 'sealed' || !finalization.sealed) {
      return { status: 503, body: { error: MESSAGES.sealPending, code: MESSAGES.sealPendingCode } };
    }
    return { status: 200, body: { mode: 'sealed', session: sealed } };
  }

  private async latestDigest(threadId: string, userId: string): Promise<{ status: number; body: unknown }> {
    const chain = await this.opts.sessionChainStore.getChainByThread(threadId);
    const visible = chain.filter((s) => s.userId === userId || chain.length <= 1);
    if (visible.length === 0) return { status: 404, body: { error: 'No sessions for thread', code: 'NO_SESSIONS' } };
    let text = '';
    if (this.opts.latestDigest) {
      const generated = await this.opts.latestDigest(threadId);
      if (generated) text = generated;
    }
    if (!text && this.opts.messageStore) {
      const newest = [...visible].sort((a, b) => b.seq - a.seq)[0];
      if (newest) {
        // Select a representative message payload if available (host supplies).
        const record = await this.opts.messageStore.getById(newest.id);
        if (record) text = record.content;
      }
    }
    return { status: 200, body: { threadId, digest: text || '', sessionCount: visible.length } };
  }

  private registerRoutes(): void {
    // POST /api/cli/hooks/seal
    this.post('/api/cli/hooks/seal', async (req) => {
      const parsed = sealSchema.safeParse(req.body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid seal hook payload', details: parsed.error.flatten() } };
      }
      return this.sealCli(parsed.data.cliSessionId);
    });

    // GET /api/cli/hooks/latest-digest?threadId=
    this.get('/api/cli/hooks/latest-digest', async (req) => {
      const userId = this.opts.identity.resolveUserId(req);
      if (!userId) return { status: 401, body: { error: MESSAGES.identityRequired } };
      const threadId = req.query?.threadId ?? '';
      if (!threadId) return { status: 400, body: { error: 'threadId required' } };
      return this.latestDigest(threadId, userId);
    });

    // PUT /api/cli/hooks/sop-bookmark
    this.put('/api/cli/hooks/sop-bookmark', async (req) => {
      const parsed = sopBookmarkSchema.safeParse(req.body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid sop bookmark payload', details: parsed.error.flatten() } };
      }
      const session = await this.resolveSessionByCliSessionId(parsed.data.cliSessionId);
      if (!session) return { status: 404, body: { error: MESSAGES.sessionNotFound, code: MESSAGES.sessionNotFoundCode } };
      return {
        status: 200,
        body: { ok: true, sessionId: session.id, skill: parsed.data.skill, sopStage: parsed.data.sopStage },
      };
    });
  }
}