/**
 * F079 — thread vote (voting) types.
 *
 * A vote lives on a thread (`VotingStateV1`) and is bounded by a deadline.
 * 状态机（对齐 clowder-ai `votes.ts`）：
 *   active → closed   (explicit close / timeout auto-close / all voters cast)
 *
 * 投票结果 `buildVoteTally` 为纯函数（见 chat-approval votes.ts），此处仅定义持久化 shape。
 *
 * @module @flowforge/cats-shared/types
 */

/** F079: Voting state stored per-thread. */
export interface VotingStateV1 {
  readonly v: 1
  readonly question: string
  readonly options: readonly string[]
  /** participantId (`userId` or `catId`) → option label. */
  readonly votes: Readonly<Record<string, string>>
  /** anonymous=true 时，关闭后 votes 映射被抹除（仅保留 tally）。 */
  readonly anonymous: boolean
  readonly deadline: number
  readonly createdBy: string
  readonly status: 'active' | 'closed'
  /** Phase 2: designated voters (participantIds). When set, auto-close when all voted. */
  readonly voters?: readonly string[]
  /** Gap 4: participantId that initiated the vote (only set for cat-initiated votes via MCP). */
  readonly initiatedByCat?: string
}

/** Tally projection: option label → accumulated count. */
export type VoteTally = Record<string, number>

/** Vote result broadcast payload (public, anonymous rows scrubbed). */
export interface VoteResult {
  readonly threadId: string
  readonly question: string
  readonly status: 'closed'
  readonly tally: VoteTally
  readonly totalVotes: number
  readonly anonymous: boolean
  readonly deadline: number
  readonly createdBy: string
}
