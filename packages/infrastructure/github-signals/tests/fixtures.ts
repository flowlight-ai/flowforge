/**
 * Shared contract-test fixtures for the GitHub wait lifecycle domain.
 */

import type { PrAutomationState, TaskItem } from '../src/contract/github-wait.ts'
import type {
  GitHubIssueAwaitStateV1,
  GitHubPrAwaitStateV1,
} from '../src/contract/predicate.ts'

export function makePrAwait(overrides: Partial<GitHubPrAwaitStateV1> = {}): GitHubPrAwaitStateV1 {
  return {
    v: 1,
    generation: 1,
    subjectRef: 'pr:acme/omega#7',
    ownerFence: { kind: 'containing_task', generation: 1 },
    baseline: {
      capturedAt: 100,
      headSha: 'aaaaaaa',
      review: {
        inlineCommentCursor: 1,
        conversationCommentCursor: 2,
        decisionCursor: 5,
        decision: 'CHANGES_REQUESTED',
      },
    },
    continuation: {
      when: [{ kind: 'pr_review_decision_changed' }],
      then: 'Re-request a review.',
    },
    expiresAt: 10_000,
    createdAt: 100,
    ...overrides,
  }
}

export function makeIssueAwait(overrides: Partial<GitHubIssueAwaitStateV1> = {}): GitHubIssueAwaitStateV1 {
  return {
    v: 1,
    generation: 1,
    subjectRef: 'issue:acme/omega#9',
    ownerFence: { kind: 'containing_task', generation: 1 },
    baseline: {
      capturedAt: 100,
      issue: { lastCommentCursor: 3, state: 'open', authorLogin: 'korra' },
    },
    continuation: {
      when: [{ kind: 'issue_author_commented' }],
      then: 'Follow up with the issue author.',
    },
    expiresAt: 10_000,
    createdAt: 100,
    ...overrides,
  }
}

export function makePrTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const automationState: PrAutomationState = {
    review: {
      lastCommentCursor: 2,
      lastInlineCommentCursor: 1,
      lastConversationCommentCursor: 2,
      lastDecisionCursor: 5,
    },
    ci: { headSha: 'aaaaaaa', lastFingerprint: 'aaaaaaa:pass', lastBucket: 'pass' },
    await: makePrAwait(),
  }
  return {
    id: 'task-pr-1',
    kind: 'pr_tracking',
    threadId: 'thread-1',
    subjectKey: 'pr:acme/omega#7',
    title: 'Omega PR',
    ownerCatId: 'cat-1' as never,
    status: 'doing',
    why: 'waiting on review',
    createdBy: 'system',
    createdAt: 100,
    updatedAt: 100,
    userId: 'user-1',
    automationState,
    ...overrides,
  }
}

export function makeIssueTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-issue-1',
    kind: 'issue_tracking',
    threadId: 'thread-2',
    subjectKey: 'issue:acme/omega#9',
    title: 'Omega issue',
    ownerCatId: 'cat-1' as never,
    status: 'doing',
    why: 'waiting on author',
    createdBy: 'system',
    createdAt: 100,
    updatedAt: 100,
    userId: 'user-2',
    automationState: {
      issue: {
        lastCommentCursor: 3,
        lastDeliveredCursor: 3,
        issueState: 'open',
      },
      await: makeIssueAwait(),
    },
    ...overrides,
  }
}