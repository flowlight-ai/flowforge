/**
 * Invariants & constants for @flowforge/chat-messages.
 *
 * @module @flowforge/chat-messages/invariant
 */

/** Lobby thread id — messages without a threadId land here (clowder-ai `default`). */
export const DEFAULT_THREAD_ID = 'default'

/** Titles treated as "untitled" for first-message auto-titling. */
export const UNTITLED_THREAD_TITLES: readonly string[] = ['', '新对话']

/** Auto-title truncation length (clowder-ai: 30 chars + `...`). */
export const AUTO_TITLE_MAX_LENGTH = 30

/** Untitled-thread hard-delete confirmation phrase (clowder-ai `确认删除`). */
export const HARD_DELETE_CONFIRM_PHRASE = '确认删除'

/** Error codes surfaced by chat-messages services (mirrors clowder-ai route codes). */
export const MessageErrorCode = {
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  THREAD_DELETING: 'THREAD_DELETING',
  QUEUE_FULL: 'QUEUE_FULL',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  MESSAGE_NOT_RESTORABLE: 'MESSAGE_NOT_RESTORABLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  CONFIRM_TITLE_REQUIRED: 'CONFIRM_TITLE_REQUIRED',
  CONFIRM_TITLE_MISMATCH: 'CONFIRM_TITLE_MISMATCH',
  DELETE_FAILED: 'DELETE_FAILED',
  NO_RICH_BLOCKS: 'NO_RICH_BLOCKS',
  BLOCK_NOT_FOUND: 'BLOCK_NOT_FOUND',
  BLOCK_NOT_INTERACTIVE: 'BLOCK_NOT_INTERACTIVE',
  INVALID_INPUT: 'INVALID_INPUT',
} as const

export type MessageErrorCodeValue = (typeof MessageErrorCode)[keyof typeof MessageErrorCode]
