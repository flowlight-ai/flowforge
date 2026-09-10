/**
 * F222 Phase C: Retry burst detection（迁移自 clowder-ai 同名文件）。
 * 检测用户是否重复发送完全一致的消息（全文比较，capped at COMPARE_CAP）。
 */

import { RETRY_BURST_THRESHOLD, RETRY_PREFIX_LENGTH } from './frustration-detector.ts'

const COMPARE_CAP = 200

export interface RetryBurstResult {
  matched: boolean
  matchCount: number
  repeatedPrefix: string
}

export function detectRetryBurst(currentMessage: string, recentUserMessages: string[]): RetryBurstResult {
  if (!currentMessage || recentUserMessages.length === 0) {
    return { matched: false, matchCount: 0, repeatedPrefix: '' }
  }

  const currentTrimmed = currentMessage.trim()
  if (currentTrimmed.length < 5) {
    return { matched: false, matchCount: 0, repeatedPrefix: '' }
  }

  const currentCapped = currentTrimmed.slice(0, COMPARE_CAP)

  let matchCount = 0
  for (const msg of recentUserMessages) {
    if (msg.trim().slice(0, COMPARE_CAP) === currentCapped) {
      matchCount++
    }
  }

  return {
    matched: matchCount >= RETRY_BURST_THRESHOLD,
    matchCount,
    repeatedPrefix: currentTrimmed.slice(0, RETRY_PREFIX_LENGTH),
  }
}