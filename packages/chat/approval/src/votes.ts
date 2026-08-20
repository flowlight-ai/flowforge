/**
 * F079 — 投票纯函数（阶段5 批次4）。
 *
 * 从 clowder-ai `votes.ts` / `vote-intercept.ts` 提取的纯计算面：tally 统计、
 * 完成判定、文本提取、通知构造。均为无副作用函数，便于单元测试与复用。
 *
 * @module @flowforge/chat-approval/votes
 */

import type { VoteTally, VotingStateV1 } from '@flowforge/cats-shared'

/** 结果消息 source 标记（对齐 clowder-ai VOTE_RESULT_SOURCE）。 */
export const VOTE_RESULT_SOURCE = {
  connector: 'vote-result',
  label: '投票结果',
  icon: 'ballot',
} as const

const VOTE_PATTERN = /\[VOTE:(.+?)\]/

/** 从正文提取投票选项；无匹配返回 null。 */
export function extractVoteFromText(text: string): string | null {
  const match = text.match(VOTE_PATTERN)
  if (!match) return null
  return match[1]?.trim() ?? null
}

/**
 * 检查所有指定投票人是否均已投票。
 * 仅当存在 `voters` 列表且每个人都投过时返回 true。
 */
export function checkVoteCompletion(state: VotingStateV1): boolean {
  const voters = (state as VotingStateV1 & { voters?: readonly string[] }).voters
  if (!voters || voters.length === 0) return false
  return voters.every((v) => v in state.votes)
}

/** 构造发往每位投票人的通知文案。 */
export function buildVoteNotification(question: string, options: readonly string[]): string {
  const optionList = options.map((o) => `• ${o}`).join('\n')
  return `投票请求：${question}\n\n选项：\n${optionList}\n\n请在回复中包含 [VOTE:你的选项]，例如 [VOTE:${options[0]}]`
}

/** 从已有投票构建 tally：每个选项先清零，再累加已投票数。 */
export function buildVoteTally(options: readonly string[], votes: Readonly<Record<string, string>>): VoteTally {
  const tally: VoteTally = {}
  for (const opt of options) tally[opt] = 0
  for (const v of Object.values(votes)) {
    tally[v] = (tally[v] ?? 0) + 1
  }
  return tally
}

/** 已投用户列表（去重）。 */
export function listVoters(state: VotingStateV1): string[] {
  return Object.keys(state.votes)
}
