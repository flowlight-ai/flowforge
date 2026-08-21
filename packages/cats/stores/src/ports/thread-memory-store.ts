/**
 * IThreadMemoryStore — per-thread key-value memory store port (F3-lite).
 *
 * Promoted from stub-ports.ts in stage-5 batch 7 (T5.7.2): the clowder-ai
 * `MemoryStore.ts` contract (api/src/domains/cats/services/stores/ports/)
 * — thread KV 记忆（写/读/删/级联清空），容量上限淘汰最旧 key。
 * 与 per-CatId 长期记忆 IMemoryStore 互补：前者面向 thread 会话记忆，后者
 * 面向 Forgekin 档案记忆。
 *
 * @module @flowforge/cats-stores/ports
 */

import type { MemoryEntry, MemoryInput } from '@flowforge/cats-shared'

/** Maximum keys per thread to prevent memory bloat. */
export const MAX_KEYS_PER_THREAD = 50

/** Common interface for thread-scoped key-value memory stores. */
export interface IThreadMemoryStore {
  /** Write or overwrite a memory entry (evicts the oldest key at capacity). */
  set(input: MemoryInput): MemoryEntry | Promise<MemoryEntry>
  /** Get a single entry by key. */
  get(threadId: string, key: string): MemoryEntry | null | Promise<MemoryEntry | null>
  /** List all entries for a thread. */
  list(threadId: string): MemoryEntry[] | Promise<MemoryEntry[]>
  /** Delete a single entry. */
  delete(threadId: string, key: string): boolean | Promise<boolean>
  /** Delete all entries for a thread (cascade delete support). Returns count deleted. */
  deleteThread(threadId: string): number | Promise<number>
}

export type { MemoryEntry, MemoryInput }
