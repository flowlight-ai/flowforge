/**
 * Invariants & constants for @flowforge/chat-threads.
 *
 * @module @flowforge/chat-threads/invariant
 */

/** Branch title suffix appended to the source thread title (clowder-ai ` (分支)`). */
export const BRANCH_TITLE_SUFFIX = ' (分支)'

/** Fallback title when branching an untitled thread. */
export const BRANCH_FALLBACK_TITLE = '分支对话'

/** Default fallback title for untitled threads. */
export const DEFAULT_THREAD_TITLE = '新对话'

/** Max messages copied when creating a branch (defensive cap, clowder-ai uses 10000). */
export const BRANCH_MAX_MESSAGES = 10_000

/** Marker for system-owned threads (accessible to all users, deletion protected). */
export const SYSTEM_USER_ID = 'system'

/** Internal metadata namespace stripped from client-facing thread projections. */
export const INTERNAL_METADATA_PREFIX = 'internal.'

/** Error codes surfaced by chat-threads services (mirrors clowder-ai route codes). */
export const ThreadErrorCode = {
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ACTIVE_INVOCATION: 'ACTIVE_INVOCATION',
  SYSTEM_THREAD_PROTECTED: 'SYSTEM_THREAD_PROTECTED',
  INVALID_BACKLOG_ITEM: 'INVALID_BACKLOG_ITEM',
  INVALID_FROM_MESSAGE: 'INVALID_FROM_MESSAGE',
  FROM_MESSAGE_DELETED: 'FROM_MESSAGE_DELETED',
  THREAD_NOT_DELETED: 'THREAD_NOT_DELETED',
  BRANCH_FAILED: 'BRANCH_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const

export type ThreadErrorCodeValue = (typeof ThreadErrorCode)[keyof typeof ThreadErrorCode]
