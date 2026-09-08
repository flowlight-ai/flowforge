/**
 * PR / Issue baseline reader 契约：条件化 fetch + collector-state 投影。
 *
 * @flowforge/infrastructure-github-signals/tests
 */

import { describe, expect, it } from 'vitest'
import { readGitHubWaitBaseline } from '../src/GitHubWaitBaselineReader.ts'
import { readGitHubIssueWaitBaseline } from '../src/GitHubIssueWaitBaselineReader.ts'

describe('readGitHubWaitBaseline — PR', () => {
  const makeDeps = (overrides: Record<string, unknown> = {}) => ({
    fetchCi: overrides.fetchCi ?? (async () => ({ headSha: 'aaaaaaa', aggregateBucket: 'pass' })),
    fetchInlineComments: overrides.fetchInlineComments ?? (async () => [{ id: 1 }, { id: 2 }]),
    fetchConversationComments: overrides.fetchConversationComments ?? (async () => [{ id: 3 }]),
    fetchReviews: overrides.fetchReviews ?? (async () => [{ id: 4, state: 'CHANGES_REQUESTED' }]),
    fetchMergeState: overrides.fetchMergeState ?? (async () => 'CLEAN'),
    fetchReviewThreads: overrides.fetchReviewThreads ?? (async () => []),
    now: () => 200,
  })

  it('builds a PR baseline and collector state with conditional surface fetches', async () => {
    const snapshot = await readGitHubWaitBaseline(
      {
        repoFullName: 'acme/omega',
        prNumber: 7,
        when: [
          { kind: 'pr_review_decision_changed' },
          { kind: 'pr_ci_terminal' },
          { kind: 'pr_became_conflicting' },
          { kind: 'pr_head_changed' },
        ],
      },
      makeDeps(),
    )
    expect(snapshot.baseline.headSha).toBe('aaaaaaa')
    expect(snapshot.baseline.capturedAt).toBe(200)
    expect(snapshot.baseline.review?.decisionCursor).toBe(4)
    expect(snapshot.baseline.ci).toEqual({ bucket: 'pass', fingerprint: 'aaaaaaa:pass' })
    expect(snapshot.baseline.conflict?.mergeState).toBe('CLEAN')
    expect(snapshot.collectorState.ci.lastBucket).toBe('pass')
    expect(snapshot.collectorState.review?.lastCommentCursor).toBe(3)
  })

  it('normalizes an unknown aggregate bucket to external_infrastructure', async () => {
    const snapshot = await readGitHubWaitBaseline(
      {
        repoFullName: 'acme/omega',
        prNumber: 7,
        when: [{ kind: 'pr_ci_terminal' }],
      },
      makeDeps({ fetchCi: async () => ({ headSha: 'aaaaaaa', aggregateBucket: 'weird' }) }),
    )
    expect(snapshot.baseline.ci?.bucket).toBe('external_infrastructure')
  })

  it('throws when the PR HEAD is unavailable', async () => {
    await expect(
      readGitHubWaitBaseline(
        { repoFullName: 'acme/omega', prNumber: 7, when: [{ kind: 'pr_head_changed' }] },
        makeDeps({ fetchCi: async () => null }),
      ),
    ).rejects.toThrow(/PR HEAD unavailable/)
  })

  it('omits review surface when no review predicate is requested', async () => {
    const snapshot = await readGitHubWaitBaseline(
      { repoFullName: 'acme/omega', prNumber: 7, when: [{ kind: 'pr_head_changed' }] },
      makeDeps(),
    )
    expect(snapshot.baseline.review).toBeUndefined()
    expect(snapshot.collectorState.review).toBeUndefined()
  })
})

describe('readGitHubIssueWaitBaseline — Issue', () => {
  const makeDeps = (overrides: Record<string, unknown> = {}) => ({
    fetchCommentCursor: overrides.fetchCommentCursor ?? (async () => 5),
    fetchMetadata: overrides.fetchMetadata ?? (async () => ({ state: 'open', authorLogin: 'korra' })),
    now: () => 300,
  })

  it('builds an issue baseline + collector state', async () => {
    const snapshot = await readGitHubIssueWaitBaseline(
      { repoFullName: 'acme/omega', issueNumber: 9 },
      makeDeps(),
    )
    expect(snapshot.baseline.issue.lastCommentCursor).toBe(5)
    expect(snapshot.baseline.issue.authorLogin).toBe('korra')
    expect(snapshot.baseline.issue.state).toBe('open')
    expect(snapshot.collectorState.issue.lastDeliveredCursor).toBe(5)
  })
})