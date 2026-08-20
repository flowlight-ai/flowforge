/**
 * IVoteStore — per-thread F079 vote-state store (stage-5 batch 4).
 *
 * clowder-ai 将 `VotingStateV1` 存于 thread metadata
 * （`IThreadStore.getVotingState/updateVotingState`，见 `votes.ts`）。此处以独立
 * 端口承载该状态，避免为 F079 扩展 `IThreadStore` 接口；语义（active→closed、
 * 匿名校验、deadline 约束）由 chat-approval 的 `ProposalService.vote*` 编排，
 * 本端口只负责原样读写。
 *
 * @module @flowforge/cats-stores/ports
 */

import type { VotingStateV1 } from '@flowforge/cats-shared'

export interface IVoteStore {
  /** Read the active/closed vote for a thread. Returns null if none ever created. */
  getByThread(threadId: string): VotingStateV1 | null | Promise<VotingStateV1 | null>
  /** Persist the vote state for a thread (create or replace). */
  saveByThread(threadId: string, state: VotingStateV1): void | Promise<void>
  /** Remove vote state for a thread (cleanup on thread delete). */
  clearByThread(threadId: string): void | Promise<void>
}
