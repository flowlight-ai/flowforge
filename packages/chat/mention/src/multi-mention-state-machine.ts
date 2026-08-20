/**
 * @flowforge/chat-mention — Multi-Mention 状态机纯函数（F086 M1，阶段5 批次5）。
 *
 * 移植 clowder-ai `multi-mention-state-machine.ts`：
 *
 * ```
 * pending → {running, failed}
 * running → {partial, done, timeout, failed}
 * partial → {done, timeout}
 * done    → ∅ (terminal)
 * timeout → ∅ (terminal)
 * failed  → ∅ (terminal)
 * ```
 *
 * @module @flowforge/chat-mention/multi-mention-state-machine
 */

import {
  ALL_MULTI_MENTION_STATUSES,
  MULTI_MENTION_TERMINAL_STATES,
  type MultiMentionStatus,
} from '@flowforge/cats-shared'

const VALID_TRANSITIONS: ReadonlyMap<MultiMentionStatus, ReadonlySet<MultiMentionStatus>> = new Map([
  ['pending', new Set<MultiMentionStatus>(['running', 'failed'])],
  ['running', new Set<MultiMentionStatus>(['partial', 'done', 'timeout', 'failed'])],
  ['partial', new Set<MultiMentionStatus>(['done', 'timeout'])],
  ['done', new Set<MultiMentionStatus>()],
  ['timeout', new Set<MultiMentionStatus>()],
  ['failed', new Set<MultiMentionStatus>()],
])

export function isValidTransition(from: MultiMentionStatus, to: MultiMentionStatus): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false
}

export function getAllowedTransitions(from: MultiMentionStatus): MultiMentionStatus[] {
  return [...(VALID_TRANSITIONS.get(from) ?? [])]
}

export { ALL_MULTI_MENTION_STATUSES as ALL_STATUSES }
export { MULTI_MENTION_TERMINAL_STATES as TERMINAL_STATES }
export type { MultiMentionStatus }