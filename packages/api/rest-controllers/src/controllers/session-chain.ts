/**
 * Session chain controller (F24) — list/get/seal/unseal/bind.
 *
 * Ported from clowder routes/session-chain.ts behind injected store/sealer/
 * identity/liveness seams.
 */

import type { CatId, SessionRecord } from '../contract/session.ts';
import { restoreSessionSchema, bindSessionSchema } from '../contract/session.ts';
import { MESSAGES } from '../contract/messages.ts';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';
import type {
  AuditLogPort,
  IRuntimeSessionStore,
  ISessionChainStore,
  IThreadStore,
  SessionSealer,
  Thread,
} from '../ports/stores.ts';
import {
  canAccessSessionRecord,
  canAccessThread,
  canReadThreadRecord,
  filterThreadRecords,
  resolveThreadAccess,
  threadAccessDeniedBody,
  threadRecordAccessDeniedBody,
} from '../pure/thread-access.ts';
import type { RuntimeSessionMetadata } from '../contract/session.ts';

interface RuntimeSessionSummary {
  runtime: string;
  runtimeSessionId: string;
  runtimeConversationId?: string;
  lifecycleState: string;
  lastObservedAt: number;
  retryFragment?: string;
  unexpectedRuntimeSessionSwitch?: number;
}

export interface SessionChainControllerOptions {
  sessionChainStore: ISessionChainStore;
  threadStore: IThreadStore;
  sessionSealer: SessionSealer;
  runtimeSessionStore?: IRuntimeSessionStore;
  identity: RequestContextResolver;
  auditLog?: AuditLogPort;
  /** Live provider-turn busy probe (injected; host wires real liveness). */
  isSessionSwitchBusy?: (threadId: string, catId: string, userId: string) => boolean;
  invocationTracker?: {
    has(threadId: string, catId: string): boolean;
    guardSessionSeal?(threadId: string, catId: string): { acquired: boolean; release(): void };
  };
  resolveSessionSealLiveness?: (threadId: string, ownerUserId: string) => Promise<{ catIds: readonly string[]; complete: boolean }>;
  /** Cat registry membership probe (host wires real registry in EP2). */
  catRegistry?: { has(catId: string): boolean };
  /** History backfill for late-bind (host wires real importer in EP2). */
  historyImporter?: (input: { threadId: string; catId: CatId; userId: string }) => Promise<{ imported: boolean }>;
}

function formatRuntimeSessionSummary(metadata: RuntimeSessionMetadata): RuntimeSessionSummary {
  return {
    runtime: metadata.runtime,
    runtimeSessionId: metadata.runtimeSessionId,
    ...(metadata.runtimeConversationId ? { runtimeConversationId: metadata.runtimeConversationId } : {}),
    lifecycleState: metadata.lifecycle.state,
    lastObservedAt: metadata.lifecycle.lastObservedAt,
    ...(metadata.lifecycle.retryFragment ? { retryFragment: metadata.lifecycle.retryFragment } : {}),
    ...(metadata.lifecycle.unexpectedRuntimeSessionSwitch !== undefined
      ? { unexpectedRuntimeSessionSwitch: metadata.lifecycle.unexpectedRuntimeSessionSwitch }
      : {}),
  };
}

async function attachRuntimeSessionSummary<T extends { id: string }>(
  session: T,
  runtimeSessionStore?: IRuntimeSessionStore,
): Promise<T & { runtimeSession?: RuntimeSessionSummary }> {
  if (!runtimeSessionStore) return session as T & { runtimeSession?: RuntimeSessionSummary };
  const metadata = await runtimeSessionStore.getBySessionId(session.id);
  if (!metadata) return session as T & { runtimeSession?: RuntimeSessionSummary };
  return { ...session, runtimeSession: formatRuntimeSessionSummary(metadata) };
}

type ManualSealCandidate =
  | { kind: 'ready'; session: SessionRecord; thread: Thread }
  | { kind: 'error'; status: number; body: Record<string, unknown> };

async function resolveManualSealCandidate(input: {
  sessionId: string;
  userId: string;
  sessionChainStoreCore: ISessionChainStore;
  threadStore: IThreadStore;
}): Promise<ManualSealCandidate> {
  const { userId, sessionId } = input;
  const session = await input.sessionChainStoreCore.get(sessionId);
  if (!session) {
    return { kind: 'error', status: 404, body: { error: MESSAGES.sessionNotFound, code: MESSAGES.sessionNotFoundCode } };
  }
  const thread = await input.threadStore.get(session.threadId);
  if (!thread) {
    return { kind: 'error', status: 404, body: { error: MESSAGES.threadNotFound, code: MESSAGES.threadNotFoundCode } };
  }
  const access = resolveThreadAccess({ thread, userId, resource: 'sessions', action: 'read' });
  if (access.status === 403 || !canReadThreadRecord(access, session)) {
    return { kind: 'error', status: 403, body: { error: MESSAGES.accessDenied, code: MESSAGES.sessionAccessDeniedCode } };
  }
  if (session.status !== 'active') {
    return {
      kind: 'error',
      status: 409,
      body: { error: MESSAGES.onlyActiveSealable, code: MESSAGES.sessionNotActiveCode, currentStatus: session.status },
    };
  }
  return { kind: 'ready', session, thread };
}

export class SessionChainController extends RestControllerBase {
  constructor(private readonly opts: SessionChainControllerOptions) {
    super();
    this.registerRoutes();
  }

  private identityError(): { status: number; body: { error: string } } {
    return { status: 401, body: { error: MESSAGES.identityRequired } };
  }

  private registerRoutes(): void {
    // GET /api/threads/:threadId/sessions
    this.get('/api/threads/:threadId/sessions', async (req) => {
      const userId = this.opts.identity.resolveUserId(req, { defaultUserId: 'default-user' });
      if (!userId) return this.identityError();
      const threadId = req.params?.threadId ?? '';
      const thread = await this.opts.threadStore.get(threadId);
      const access = resolveThreadAccess({ thread, userId, resource: 'sessions', action: 'list' });
      if (access.status === 403) return { status: 403, body: threadAccessDeniedBody(access) };
      const callerCatId = req.headers['x-cat-id'];
      const catId = req.query?.catId;
      const effectiveCatId = callerCatId ?? catId;
      if (effectiveCatId) {
        if (callerCatId && catId && catId !== callerCatId) {
          return { status: 403, body: { error: `Cannot query sessions for cat '${catId}' — you are '${callerCatId}'` } };
        }
        const sessions = await this.opts.sessionChainStore.getChain(
          effectiveCatId as CatId,
          threadId,
          access.scope === 'user' ? userId : undefined,
        );
        const visible = filterThreadRecords(access, sessions);
        return {
          status: 200,
          body: { sessions: await Promise.all(visible.map((s) => attachRuntimeSessionSummary(s, this.opts.runtimeSessionStore))) },
        };
      }
      const sessions = await this.opts.sessionChainStore.getChainByThread(threadId);
      const visible = filterThreadRecords(access, sessions);
      return {
        status: 200,
        body: { sessions: await Promise.all(visible.map((s) => attachRuntimeSessionSummary(s, this.opts.runtimeSessionStore))) },
      };
    });

    // GET /api/sessions/:sessionId
    this.get('/api/sessions/:sessionId', async (req) => {
      const userId = this.opts.identity.resolveUserId(req, { defaultUserId: 'default-user' });
      if (!userId) return this.identityError();
      const sessionId = req.params?.sessionId ?? '';
      const session = await this.opts.sessionChainStore.get(sessionId);
      if (!session) return { status: 404, body: { error: MESSAGES.sessionNotFound } };
      const thread = await this.opts.threadStore.get(session.threadId);
      if (!thread) return { status: 404, body: { error: MESSAGES.threadNotFound } };
      const access = resolveThreadAccess({ thread, userId, resource: 'sessions', action: 'read' });
      if (access.status === 403) return { status: 403, body: threadAccessDeniedBody(access) };
      if (!canReadThreadRecord(access, session)) return { status: 403, body: threadRecordAccessDeniedBody() };
      return { status: 200, body: await attachRuntimeSessionSummary(session, this.opts.runtimeSessionStore) };
    });

    // POST /api/sessions/:sessionId/seal
    this.post('/api/sessions/:sessionId/seal', async (req) => {
      const userId = this.opts.identity.resolveUserId(req, { defaultUserId: 'default-user' });
      if (!userId) return this.identityError();
      if (!this.opts.sessionSealer) {
        return { status: 503, body: { error: MESSAGES.sealUnavailable, code: MESSAGES.sealUnavailableCode } };
      }
      const candidate = await resolveManualSealCandidate({
        sessionId: req.params?.sessionId ?? '',
        userId,
        sessionChainStoreCore: this.opts.sessionChainStore,
        threadStore: this.opts.threadStore,
      });
      if (candidate.kind === 'error') return { status: candidate.status, body: candidate.body };
      const { session, thread } = candidate;
      let liveness: { catIds: readonly string[]; complete: boolean };
      try {
        if (!this.opts.resolveSessionSealLiveness) throw new Error('liveness resolver missing');
        liveness = await this.opts.resolveSessionSealLiveness(thread.id, session.userId);
      } catch {
        return { status: 503, body: { error: MESSAGES.sealLivenessUnavailable, code: MESSAGES.sealLivenessCode } };
      }
      if (!liveness.complete) {
        return { status: 503, body: { error: MESSAGES.sealLivenessUnavailable, code: MESSAGES.sealLivenessCode } };
      }
      if (liveness.catIds.includes(session.catId)) {
        return {
          status: 409,
          body: { error: MESSAGES.sessionActiveInvocation, code: MESSAGES.sessionActiveInvocationCode, catId: session.catId },
        };
      }
      const guard = this.opts.invocationTracker?.guardSessionSeal
        ? this.opts.invocationTracker.guardSessionSeal(thread.id, session.catId)
        : {
            acquired: !this.opts.invocationTracker?.has(thread.id, session.catId),
            release: () => {},
          };
      if (!guard.acquired) {
        return {
          status: 409,
          body: { error: MESSAGES.sessionActiveInvocation, code: MESSAGES.sessionActiveInvocationCode, catId: session.catId },
        };
      }
      let seal;
      try {
        seal = await this.opts.sessionSealer.requestSeal({ sessionId: session.id, reason: 'manual' });
      } finally {
        guard.release();
      }
      if (!seal.accepted) {
        const latest = await this.opts.sessionChainStore.get(session.id);
        return {
          status: 409,
          body: {
            error: MESSAGES.sealRace,
            code: MESSAGES.sealRaceCode,
            currentStatus: latest?.status ?? seal.status ?? 'active',
          },
        };
      }
      const finalization = await this.opts.sessionSealer.finalize({ sessionId: session.id });
      const sealed = await this.opts.sessionChainStore.get(session.id);
      if (!sealed || sealed.status !== 'sealed' || !finalization.sealed) {
        return { status: 503, body: { error: MESSAGES.sealPending, code: MESSAGES.sealPendingCode } };
      }
      if (!finalization.clean) {
        return { status: 503, body: { error: MESSAGES.sealPartial, code: MESSAGES.sealPartialCode } };
      }
      return {
        status: 200,
        body: {
          mode: 'sealed',
          session: await attachRuntimeSessionSummary(sealed, this.opts.runtimeSessionStore),
        },
      };
    });

    // POST /api/sessions/:sessionId/unseal
    this.post('/api/sessions/:sessionId/unseal', async (req) => {
      const userId = this.opts.identity.resolveUserId(req, { defaultUserId: 'default-user' });
      if (!userId) return this.identityError();
      const sessionId = req.params?.sessionId ?? '';
      const target = await this.loadRestoreTarget(sessionId, userId);
      if ('response' in target) return target.response;
      const prepared = await this.prepareRestore(target.session, req.body, userId);
      if ('response' in prepared) return prepared.response;
      const restored = await this.opts.sessionChainStore.restoreActiveSession({
        targetSessionId: target.session.id,
        expectedActiveSessionId: prepared.active?.id ?? null,
        displacedSealReason: 'manual_session_switch',
      });
      if (restored.status !== 'restored') {
        return formatNonRestored(restored);
      }
      if (restored.displacedSessionId) {
        void this.opts.sessionSealer.finalize({ sessionId: restored.displacedSessionId }).catch(() => {});
      }
      if (this.opts.auditLog) {
        void Promise.resolve(
          this.opts.auditLog.append({
            type: 'session.bind',
            threadId: target.session.threadId,
            data: { mode: 'restore_as_current', restoredSessionId: target.session.id, catId: target.session.catId, userId },
          }),
        ).catch(() => {});
      }
      return {
        status: 200,
        body: {
          mode: 'restored',
          session: restored.session,
          ...(restored.displacedSessionId ? { displacedSessionId: restored.displacedSessionId } : {}),
        },
      };
    });

    // PATCH /api/threads/:threadId/sessions/:catId/bind
    this.patch('/api/threads/:threadId/sessions/:catId/bind', async (req) => {
      const userId = this.opts.identity.resolveUserId(req, { defaultUserId: 'default-user' });
      if (!userId) return this.identityError();
      const threadId = req.params?.threadId ?? '';
      const catId = req.params?.catId as CatId;
      if (this.opts.catRegistry && !this.opts.catRegistry.has(catId)) {
        return { status: 400, body: { error: `${MESSAGES.invalidCatIdPrefix}${catId}` } };
      }
      const parsed = bindSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return { status: 400, body: { error: MESSAGES.bindIncomplete, details: parsed.error.issues } };
      }
      const { cliSessionId } = parsed.data;
      const thread = await this.opts.threadStore.get(threadId);
      if (!thread) return { status: 404, body: { error: MESSAGES.threadNotFound } };
      if (!canAccessThread(thread, userId)) return { status: 403, body: { error: MESSAGES.accessDenied } };
      const active = await this.opts.sessionChainStore.getActive(catId, threadId, userId);
      if (active && !canAccessSessionRecord(thread, active, userId)) {
        return { status: 403, body: { error: MESSAGES.accessDenied } };
      }
      let session: SessionRecord;
      let mode: 'updated' | 'created';
      if (active) {
        const updated = await this.opts.sessionChainStore.bindCliSessionId(active.id, cliSessionId);
        if (!updated) return { status: 409, body: { error: MESSAGES.cliSessionIdBound } };
        session = updated;
        mode = 'updated';
      } else {
        const claimed = await this.opts.sessionChainStore.getByCliSessionId(cliSessionId);
        if (claimed) return { status: 409, body: { error: MESSAGES.cliSessionIdBound } };
        const logical = await this.opts.sessionChainStore.getOrCreateActive({ threadId, catId, userId });
        const bound = await this.opts.sessionChainStore.bindCliSessionId(logical.id, cliSessionId);
        if (!bound) return { status: 409, body: { error: MESSAGES.cliSessionIdBound } };
        session = bound;
        mode = 'created';
      }
      if (this.opts.auditLog) {
        void Promise.resolve(
          this.opts.auditLog.append({ type: 'session.bind', threadId, data: { catId, cliSessionId, mode, sessionId: session.id, userId } }),
        ).catch(() => {});
      }
      let historyImport: { imported: boolean } | undefined;
      if (this.opts.historyImporter) {
        historyImport = await this.opts.historyImporter({ threadId, catId, userId });
      }
      return { status: 200, body: { session, mode, historyImport } };
    });
  }

  private async loadRestoreTarget(
    sessionId: string,
    userId: string,
  ): Promise<{ session: SessionRecord } | { response: { status: number; body: unknown } }> {
    const session = await this.opts.sessionChainStore.get(sessionId);
    if (!session) return { response: { status: 404, body: { error: MESSAGES.sessionNotFound } } };
    const thread = await this.opts.threadStore.get(session.threadId);
    if (!thread) return { response: { status: 404, body: { error: MESSAGES.threadNotFound } } };
    const access = resolveThreadAccess({ thread, userId, resource: 'sessions', action: 'read' });
    if (!canReadThreadRecord(access, session)) return { response: { status: 403, body: { error: MESSAGES.accessDenied } } };
    if (session.status === 'active') return { response: { status: 200, body: { session, mode: 'already_active' } } };
    if (session.status !== 'sealed') {
      return { response: { status: 409, body: { error: `Session status ${session.status} cannot be restored` } } };
    }
    return { session };
  }

  private async prepareRestore(
    session: SessionRecord,
    body: unknown,
    userId: string,
  ): Promise<{ active: SessionRecord | null } | { response: { status: number; body: unknown } }> {
    const parsed = restoreSessionSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return { response: { status: 400, body: { error: 'Invalid restore request', details: parsed.error.flatten() } } };
    }
    const active = await this.opts.sessionChainStore.getActive(session.catId, session.threadId, session.userId);
    const expected = parsed.data.expectedActiveSessionId;
    if (active && active.id !== session.id && expected === undefined) {
      return {
        response: {
          status: 409,
          body: {
            code: 'active_session_confirmation_required',
            error: MESSAGES.restoreConfirmationRequired,
            activeSessionId: active.id,
            activeSessionSeq: active.seq,
          },
        },
      };
    }
    if ((active?.id ?? null) !== (expected ?? null)) {
      return {
        response: {
          status: 409,
          body: {
            code: 'active_session_changed',
            error: MESSAGES.activeSessionChanged,
            ...(active ? { activeSessionId: active.id } : {}),
          },
        },
      };
    }
    if (this.opts.isSessionSwitchBusy?.(session.threadId, session.catId, userId)) {
      return {
        response: {
          status: 409,
          body: {
            code: 'session_switch_busy',
            error: MESSAGES.sessionSwitchBusy,
            ...(active ? { activeSessionId: active.id } : {}),
          },
        },
      };
    }
    return { active };
  }
}

function formatNonRestored(restored: {
  status: string;
  targetStatus?: string;
  activeSessionId?: string;
  session?: SessionRecord;
}): { status: number; body: unknown } {
  switch (restored.status) {
    case 'target_missing':
      return { status: 404, body: { error: MESSAGES.sessionNotFound } };
    case 'target_not_restorable':
      return { status: 409, body: { error: `Session status ${restored.targetStatus} cannot be restored` } };
    case 'active_changed':
      return {
        status: 409,
        body: { code: 'active_session_changed', error: MESSAGES.activeSessionChanged, activeSessionId: restored.activeSessionId },
      };
    case 'already_active':
      return { status: 200, body: { session: restored.session, mode: 'already_active' } };
    default:
      return { status: 409, body: { error: 'Restore failed' } };
  }
}