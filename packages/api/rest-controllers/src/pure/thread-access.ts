/**
 * Thread/session access-policy predicates (pure).
 *
 * Rebuilds clowder's `thread-access-policy.ts` + `guide-state-access.ts`
 * `canAccessThread`/`isSharedDefaultThread` as self-contained predicates.
 */

import type { SessionRecord } from '../contract/session.ts';
import type { Thread } from '../ports/stores.ts';

export interface ThreadAccess {
  status: 200 | 403;
  scope: 'user' | 'shared';
  reason?: string;
}

export function isSharedDefaultThread(thread: Thread | null): boolean {
  return thread?.shared === true;
}

export function canAccessThread(thread: Thread | null, userId: string): boolean {
  if (!thread) return false;
  return thread.createdBy === userId || isSharedDefaultThread(thread);
}

export function resolveThreadAccess(input: {
  thread: Thread | null;
  userId: string;
  resource: string;
  action: string;
}): ThreadAccess {
  void input.resource;
  void input.action;
  const { thread, userId } = input;
  if (!thread) return { status: 403, scope: 'user', reason: 'thread_not_found' };
  if (canAccessThread(thread, userId)) {
    return { status: 200, scope: isSharedDefaultThread(thread) ? 'shared' : 'user' };
  }
  return { status: 403, scope: 'user', reason: 'access_denied' };
}

/** Record-level read check: caller may read the thread and a record exists. */
export function canReadThreadRecord(access: ThreadAccess, session: SessionRecord | null): boolean {
  if (access.status === 403 || !session) return false;
  if (access.scope === 'shared') return true;
  // user-scope thread: the acting user owns the thread; session is readable.
  return true;
}

export function filterThreadRecords(access: ThreadAccess, sessions: SessionRecord[]): SessionRecord[] {
  return sessions.filter((s) => canReadThreadRecord(access, s));
}

export function threadAccessDeniedBody(access: ThreadAccess): { error: string; code?: string } {
  void access;
  return { error: 'Access denied', code: 'THREAD_ACCESS_DENIED' };
}

export function threadRecordAccessDeniedBody(): { error: string; code: string } {
  return { error: 'Access denied', code: 'SESSION_RECORD_ACCESS_DENIED' };
}

/** canAccessSessionRecord: coarse thread-level ownership for bind-style routes. */
export function canAccessSessionRecord(
  thread: {
    id: string;
    createdBy: string;
    externalRuntimeAnchorState?: { userId: string };
  } | null,
  session: { userId: string } | null,
  userId: string,
): boolean {
  if (!thread || !session) return false;
  if (thread.createdBy === userId) return true;
  if (thread.externalRuntimeAnchorState?.userId === userId && session.userId === userId) return true;
  return isSharedDefaultThread(thread) && session.userId === userId;
}