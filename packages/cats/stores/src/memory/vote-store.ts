/**
 * MemoryVoteStore — in-memory IVoteStore.
 *
 * Simple per-thread map. Mirror of clowder-ai's thread-metadata voting state,
 * kept self-contained for batch 4 (sqlite re-expresses on demand).
 *
 * @module @flowforge/cats-stores/memory
 */

import type { VotingStateV1 } from '@flowforge/cats-shared'
import type { IVoteStore } from '../ports/vote-store.ts'

export class MemoryVoteStore implements IVoteStore {
  private readonly votes = new Map<string, VotingStateV1>()

  getByThread(threadId: string): VotingStateV1 | null {
    const state = this.votes.get(threadId)
    return state ? structuredClone(state) : null
  }

  saveByThread(threadId: string, state: VotingStateV1): void {
    this.votes.set(threadId, structuredClone(state))
  }

  clearByThread(threadId: string): void {
    this.votes.delete(threadId)
  }

  reset(): void {
    this.votes.clear()
  }
}
