/**
 * Session runtime controller (F098; callback-runtime-session + native target).
 *
 * GET  /api/runtime-sessions                       — list external runtime sessions
 * POST /api/runtime-sessions/register              — register an external runtime session
 * GET  /api/threads/:threadId/compaction-target    — resolve native compaction target
 *
 * External registration requires an agent-key (or interactive identity) via the
 * injected `RequestContextResolver`; the real agent-key auth pipeline is wired by
 * the host in EP2.
 */

import { externalRuntimeListQuerySchema, EXTERNAL_RUNTIME_SESSION_LIST_PAGE_SIZE } from '../contract/session.ts';
import type { ExternalRuntimeSession, IRuntimeSessionStore } from '../ports/stores.ts';
import { MESSAGES } from '../contract/messages.ts';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';

/** Native compaction target candidates provider (host binds session list in EP2). */
export interface NativeCompactionCandidate {
  sessionId: string;
  threadId: string;
  catId: string;
  runtime: string;
  lifecycleState: string;
}

export interface NativeCompactionTargetResolver {
  candidates(threadId: string, catId?: string): NativeCompactionCandidate[] | Promise<NativeCompactionCandidate[]>;
}

export type NativeTargetResolution =
  | { ok: true; sessionId: string; runtime: string; lifecycleState: string }
  | { ok: false; status: number; code: string; message: string };

/** Pure resolution: filter shapable candidates, cascade single target, else 409/404. */
export function resolveNativeCompactionTarget(candidates: NativeCompactionCandidate[], catId?: string): NativeTargetResolution {
  const filtered = catId ? candidates.filter((c) => c.catId === catId) : candidates;
  // Only runtime-backed sessions that report a lifecycle state are candidates.
  const shapable = filtered.filter((c) => c.runtime && c.lifecycleState);
  if (shapable.length === 0) {
    return { ok: false, status: 404, code: 'compaction_target_not_found', message: 'No runtime compaction target found' };
  }
  if (shapable.length > 1) {
    return {
      ok: false,
      status: 409,
      code: 'compaction_target_ambiguous',
      message: `Multiple compaction targets: ${shapable.map((c) => c.sessionId).join(', ')}`,
    };
  }
  const target = shapable[0];
  if (!target) return { ok: false, status: 404, code: 'compaction_target_not_found', message: 'No runtime compaction target found' };
  return { ok: true, sessionId: target.sessionId, runtime: target.runtime, lifecycleState: target.lifecycleState };
}

export interface SessionRuntimeControllerOptions {
  runtimeSessionStore: IRuntimeSessionStore;
  identity: RequestContextResolver;
  /** Compaction target candidate source (host binds in EP2). */
  compactionTarget?: NativeCompactionTargetResolver;
}

export class SessionRuntimeController extends RestControllerBase {
  constructor(private readonly opts: SessionRuntimeControllerOptions) {
    super();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // GET /api/runtime-sessions
    this.get('/api/runtime-sessions', async (req) => {
      const parsed = externalRuntimeListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid runtime query', details: parsed.error.flatten() } };
      }
      const { catId, surface, limit } = parsed.data;
      const pageLimit = limit ?? EXTERNAL_RUNTIME_SESSION_LIST_PAGE_SIZE;
      const list = await this.opts.runtimeSessionStore.listExternal({
        ...(catId ? { catId } : {}),
        ...(surface ? { surface } : {}),
        limit: pageLimit,
      });
      const totalMatches = list.length;
      const truncated = totalMatches >= pageLimit;
      return { status: 200, body: { sessions: list, totalMatches, truncated } };
    });

    // POST /api/runtime-sessions/register
    this.post('/api/runtime-sessions/register', async (req) => {
      const principal = this.opts.identity.resolvePrincipal(req);
      const interactive = this.opts.identity.resolveInteractiveUserId(req);
      const isAgentKey = req.headers['x-agent-key'] !== undefined;
      if (!isAgentKey && !interactive && !principal) {
        return { status: 401, body: { error: MESSAGES.externalRegisterAuthRequired } };
      }
      const body = req.body as Partial<ExternalRuntimeSession> | undefined;
      const threadId = typeof body?.threadId === 'string' ? body.threadId : '';
      const runtimeSessionId = typeof body?.runtimeSessionId === 'string' ? body.runtimeSessionId : '';
      if (!threadId || !runtimeSessionId) {
        return { status: 400, body: { error: 'threadId and runtimeSessionId are required' } };
      }
      const runtime = typeof body?.runtime === 'string' ? body.runtime : 'antigravity-desktop';
      const surface: ExternalRuntimeSession['surface'] =
        body?.surface === 'ide-direct' ? 'ide-direct' : 'cat-cafe-dispatch';
      const record: ExternalRuntimeSession = {
        sessionId: typeof body?.sessionId === 'string' ? body.sessionId : `runtime_${Date.now()}`,
        threadId,
        ...(body?.catId ? { catId: body.catId } : {}),
        runtime,
        runtimeSessionId,
        ...(typeof body?.runtimeConversationId === 'string' ? { runtimeConversationId: body.runtimeConversationId } : {}),
        surface,
        lastObservedAt: typeof body?.lastObservedAt === 'number' ? body.lastObservedAt : Date.now(),
        lifecycleState: typeof body?.lifecycleState === 'string' ? body.lifecycleState : 'unknown',
      };
      await this.opts.runtimeSessionStore.registerExternal(record);
      return { status: 201, body: { session: record } };
    });

    // GET /api/threads/:threadId/compaction-target
    this.get('/api/threads/:threadId/compaction-target', async (req) => {
      if (!this.opts.compactionTarget) {
        return { status: 503, body: { error: 'Compaction target resolution unavailable', code: 'COMPACTION_UNAVAILABLE' } };
      }
      const threadId = req.params?.threadId ?? '';
      const catId = req.query?.catId ? (req.query.catId as string) : undefined;
      const candidates = await this.opts.compactionTarget.candidates(threadId, catId);
      const resolution = resolveNativeCompactionTarget(candidates, catId);
      if (!resolution.ok) return { status: resolution.status, body: { code: resolution.code, error: resolution.message } };
      return { status: 200, body: { threadId, sessionId: resolution.sessionId, runtime: resolution.runtime, lifecycleState: resolution.lifecycleState } };
    });
  }
}