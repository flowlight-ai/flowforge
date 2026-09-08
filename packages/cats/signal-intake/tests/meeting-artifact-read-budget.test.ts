/**
 * 会议产物读取预算契约：在 maxChars 与 maxTokens 之间选最大整页。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { pageWithinMeetingArtifactBudgets } from '../src/meeting-artifact-read-budget.ts'
import { MeetingArtifactResourceError } from '../src/meeting-artifact-resource-contract.ts'

describe('pageWithinMeetingArtifactBudgets', () => {
  it('picks a page that fits both the character and token budget', () => {
    const page = pageWithinMeetingArtifactBudgets((budget) => ({ content: 'x'.repeat(budget), nextOffset: budget, hasMore: false }), 1_000, 100)
    expect(page.content.length).toBeGreaterThan(0)
    expect(page.estimatedTokens).toBeGreaterThan(0)
  })

  it('respects hasMore bookkeeping', () => {
    const page = pageWithinMeetingArtifactBudgets(
      (budget) => ({ content: 'y'.repeat(Math.min(budget, 10)), nextOffset: 10, hasMore: true }),
      1_000,
      1_000,
    )
    expect(page.hasMore).toBe(true)
  })

  it('throws when the token budget cannot fit the smallest unit', () => {
    expect(() =>
      pageWithinMeetingArtifactBudgets((budget) => ({ content: 'abc'.slice(0, budget), nextOffset: budget, hasMore: false }), 3, 0),
    ).toThrow(MeetingArtifactResourceError)
  })
})