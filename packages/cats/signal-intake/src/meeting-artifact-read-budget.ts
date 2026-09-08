/**
 * 会议产物读取预算：在 maxChars 与 maxTokens 之间选择满足 token 上限的最大整页。
 * 忠实移植 clowder-ai `domains/signal-intake/meeting-artifact-read-budget.ts`。
 * token 估算使用本地 `extract/token-estimate.ts`（单调可测近似）。
 *
 * @flowforge/cats-signal-intake
 */

import { estimateTokens } from './extract/token-estimate.ts'
import { MeetingArtifactResourceError } from './meeting-artifact-resource-contract.ts'

interface TextPage {
  readonly content: string
  readonly nextOffset: number
  readonly hasMore: boolean
}

/** Select the largest checked character page that also fits the canonical token estimate. */
export function pageWithinMeetingArtifactBudgets(
  makePage: (characterBudget: number) => TextPage,
  maxChars: number,
  maxTokens: number,
): TextPage & { readonly estimatedTokens: number } {
  let low = 1
  let high = maxChars
  let best: (TextPage & { readonly estimatedTokens: number }) | null = null
  while (low <= high) {
    const characterBudget = Math.floor((low + high) / 2)
    const page = makePage(characterBudget)
    const estimatedTokens = estimateTokens(page.content)
    if (estimatedTokens <= maxTokens) {
      best = { ...page, estimatedTokens }
      low = characterBudget + 1
    } else {
      high = characterBudget - 1
    }
  }
  if (best) return best
  const smallest = makePage(1)
  if (!smallest.content) return { ...smallest, estimatedTokens: 0 }
  throw new MeetingArtifactResourceError(
    'INVALID_READ_REQUEST',
    'maxTokens is too small for the next source unit; increase the explicit token bound',
  )
}