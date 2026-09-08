/**
 * GitHub wait outcome renderer 契约：review-loop-brake 分类 + 紧凑消息渲染。
 *
 * @flowforge/infrastructure-github-signals/tests
 */

import { describe, expect, it } from 'vitest'
import {
  REVIEW_LOOP_BRAKE_NEXT_STEP,
  classifyGitHubReviewLoopBrake,
  renderGitHubWaitOutcome,
} from '../src/github-wait-renderer.ts'
import type { WaitOutcomeV1 } from '../src/contract/github-wait.ts'

describe('classifyGitHubReviewLoopBrake', () => {
  it('classifies pause_once when the 4th formal CHANGES_REQUESTED lands this visit', () => {
    const history = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      state: 'CHANGES_REQUESTED',
      author: 'korra',
    }))
    const brake = classifyGitHubReviewLoopBrake(history, [4], 'mako')
    expect(brake.kind).toBe('pause_once')
  })

  it('classifies continue when below the threshold', () => {
    const history = [
      { id: 1, state: 'CHANGES_REQUESTED', author: 'korra' },
      { id: 2, state: 'CHANGES_REQUESTED', author: 'korra' },
    ]
    const brake = classifyGitHubReviewLoopBrake(history, [2], 'mako')
    expect(brake.kind).toBe('continue')
  })

  it('excludes the PR author from formal-changes counting', () => {
    // 5 reviews: 1 by the PR author (mako, excluded) + 4 formal by korra → brake.
    const history = [
      { id: 1, state: 'CHANGES_REQUESTED', author: 'mako' },
      { id: 2, state: 'CHANGES_REQUESTED', author: 'korra' },
      { id: 3, state: 'CHANGES_REQUESTED', author: 'korra' },
      { id: 4, state: 'CHANGES_REQUESTED', author: 'korra' },
      { id: 5, state: 'CHANGES_REQUESTED', author: 'korra' },
    ]
    const brake = classifyGitHubReviewLoopBrake(history, [5], 'mako')
    expect(brake.kind).toBe('pause_once')
  })
})

describe('renderGitHubWaitOutcome', () => {
  const base: WaitOutcomeV1 = {
    v: 1,
    outcomeId: 'o-1',
    generation: 1,
    subjectRef: 'pr:acme/omega#7',
    ownerFence: { kind: 'containing_task', generation: 1 },
    reason: 'matched',
    at: 500,
    delivery: 'delivered',
  }

  it('renders a matched PR outcome with deltas', () => {
    const content = renderGitHubWaitOutcome({
      ...base,
      matched: [{ kind: 'pr_review_decision_changed', delta: 'review CHANGES_REQUESTED → APPROVED (korra)' }],
    })
    expect(content).toContain('PR wait satisfied')
    expect(content).toContain('acme/omega#7')
    expect(content).toContain('review CHANGES_REQUESTED → APPROVED')
  })

  it('renders a subject_terminal issue outcome', () => {
    const content = renderGitHubWaitOutcome({
      ...base,
      subjectRef: 'issue:acme/omega#9',
      reason: 'subject_terminal',
      terminalSubjectState: 'merged',
    })
    expect(content).toContain('Issue wait satisfied')
    expect(content).toContain('acme/omega#9')
    expect(content).toContain('merged')
  })

  it('emits a review-loop-brake next-step banner when the brake is hit', () => {
    const content = renderGitHubWaitOutcome({
      ...base,
      nextStep: REVIEW_LOOP_BRAKE_NEXT_STEP,
    })
    expect(content).toContain('Automatic re-request paused')
  })
})