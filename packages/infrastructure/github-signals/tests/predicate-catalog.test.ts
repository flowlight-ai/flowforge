/**
 * GitHub wait 谓词目录契约：zod 校验 + canonicalization + 纯匹配逻辑。
 *
 * @flowforge/infrastructure-github-signals/tests
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  canonicalizeGitHubIssueWaitPredicates,
  canonicalizeGitHubWaitPredicates,
  githubIssueWaitPredicatesSchema,
  githubWaitPredicatesSchema,
  githubWaitPredicateSchema,
  matchGitHubWaitPredicates,
} from '../src/GitHubWaitPredicateCatalog.ts'
import type { GitHubWaitFacts } from '../src/GitHubWaitPredicateCatalog.ts'
import { makeIssueAwait, makePrAwait } from './fixtures.ts'

describe('githubWaitPredicateSchema — 结构校验', () => {
  it('accepts every PR + issue predicate kind', () => {
    const cases = [
      { kind: 'pr_head_changed' },
      { kind: 'pr_review_result_available', triggerCommentId: 42 },
      { kind: 'pr_review_decision_changed' },
      { kind: 'pr_review_thread_changed', reviewThreadIds: ['thread-a'] },
      { kind: 'pr_ci_terminal' },
      { kind: 'pr_became_conflicting' },
      { kind: 'issue_comment_added' },
      { kind: 'issue_author_commented' },
    ]
    for (const candidate of cases) {
      expect(githubWaitPredicateSchema.parse(candidate).kind).toBe(candidate.kind)
    }
  })

  it('parses an issue predicate list (githubIssueWaitPredicatesSchema)', () => {
    expect(githubIssueWaitPredicatesSchema.parse([{ kind: 'issue_comment_added' }]).length).toBe(1)
  })

  it('rejects unknown kinds and unknown keys (strict)', () => {
    expect(() => githubWaitPredicateSchema.parse({ kind: 'pr_mystery' })).toThrow(z.ZodError)
    expect(() => githubWaitPredicateSchema.parse({ kind: 'pr_ci_terminal', extra: 1 })).toThrow(z.ZodError)
  })

  it('rejects empty reviewThreadIds and non-unique ids', () => {
    expect(() =>
      githubWaitPredicateSchema.parse({ kind: 'pr_review_thread_changed', reviewThreadIds: [] }),
    ).toThrow(z.ZodError)
    expect(() => githubWaitPredicatesSchema.parse(
      [{ kind: 'pr_review_thread_changed', reviewThreadIds: ['a', 'a'] }],
    )).toThrow(z.ZodError)
  })
})

describe('githubWaitPredicatesSchema — 列表级约束', () => {
  it('rejects duplicate kinds within one wait', () => {
    expect(() =>
      githubWaitPredicatesSchema.parse([
        { kind: 'pr_ci_terminal' },
        { kind: 'pr_ci_terminal' },
      ]),
    ).toThrow(/duplicate wait predicate kind/)
  })

  it('rejects empty lists', () => {
    expect(() => githubWaitPredicatesSchema.parse([])).toThrow(z.ZodError)
  })

  it('rejects lists longer than 4', () => {
    const five = [
      { kind: 'pr_head_changed' },
      { kind: 'pr_review_result_available' },
      { kind: 'pr_review_decision_changed' },
      { kind: 'pr_ci_terminal' },
      { kind: 'pr_became_conflicting' },
    ]
    expect(() => githubWaitPredicatesSchema.parse(five)).toThrow(z.ZodError)
  })
})

describe('canonicalizeGitHubWaitPredicates', () => {
  it('returns the canonical predicate list for a valid PR set', () => {
    const result = canonicalizeGitHubWaitPredicates([
      { kind: 'pr_review_decision_changed' },
      { kind: 'pr_ci_terminal' },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]!.kind).toBe('pr_review_decision_changed')
  })

  it('canonicalizes issue predicates separately', () => {
    const result = canonicalizeGitHubIssueWaitPredicates([{ kind: 'issue_author_commented' }])
    expect(result[0]!.kind).toBe('issue_author_commented')
  })
})

describe('matchGitHubWaitPredicates — PR 匹配', () => {
  const baseline = makePrAwait().baseline
  const sameHead: GitHubWaitFacts = { headSha: 'aaaaaaa' }

  it('matches pr_head_changed when HEAD advances', () => {
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'pr_head_changed' }],
      baseline,
      { headSha: 'bbbbbbb' },
    )
    expect(matched.map((m) => m.kind)).toEqual(['pr_head_changed'])
    expect(matched[0]!.delta).toContain('aaaaaaa')
  })

  it('does not match pr_review_decision_changed when decisionCursor stalls', () => {
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'pr_review_decision_changed' }],
      baseline,
      { ...sameHead, review: { decisionCursor: 5 } },
    )
    expect(matched).toHaveLength(0)
  })

  it('matches pr_review_decision_changed when decision frontier advances', () => {
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'pr_review_decision_changed' }],
      baseline,
      {
        ...sameHead,
        review: { decisionCursor: 6, decision: 'APPROVED', reviewer: 'korra', resultSourceRef: 'r-1' },
      },
    )
    expect(matched.map((m) => m.kind)).toEqual(['pr_review_decision_changed'])
    expect(matched[0]!.delta).toContain('APPROVED')
  })

  it('matches pr_ci_terminal only on terminal bucket + fingerprint change', () => {
    const ciBaseline = {
      ...baseline,
      ci: { bucket: 'pending' as const, fingerprint: 'aaaaaaa:pending' },
    }
    const noMatch = matchGitHubWaitPredicates(
      [{ kind: 'pr_ci_terminal' }],
      ciBaseline,
      { ...sameHead, ci: { bucket: 'pending', fingerprint: 'aaaaaaa:pending', blockerCount: 0 } },
    )
    expect(noMatch).toHaveLength(0)

    const match = matchGitHubWaitPredicates(
      [{ kind: 'pr_ci_terminal' }],
      ciBaseline,
      { ...sameHead, ci: { bucket: 'pass', fingerprint: 'aaaaaaa:pass', blockerCount: 0 } },
    )
    expect(match.map((m) => m.kind)).toEqual(['pr_ci_terminal'])
  })

  it('matches pr_became_conflicting on transition into CONFLICTING', () => {
    const conflictBaseline = {
      ...baseline,
      conflict: { mergeState: 'CLEAN' },
    }
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'pr_became_conflicting' }],
      conflictBaseline,
      { ...sameHead, conflict: { mergeState: 'CONFLICTING' } },
    )
    expect(matched).toHaveLength(1)
    expect(matched[0]!.delta).toContain('conflicting')
  })

  it('matches pr_review_thread_changed when a tracked thread resolves', () => {
    const threadBaseline = {
      ...baseline,
      review: {
        ...baseline.review!,
        threads: [{ reviewThreadId: 'thread-a', lastCommentId: '1', resolved: false }],
      },
    }
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'pr_review_thread_changed', reviewThreadIds: ['thread-a'] }],
      threadBaseline,
      {
        ...sameHead,
        review: { decisionCursor: 5, threads: [{ reviewThreadId: 'thread-a', lastCommentId: '1', resolved: true }] },
      },
    )
    expect(matched).toHaveLength(1)
    expect(matched[0]!.kind).toBe('pr_review_thread_changed')
  })
})

describe('matchGitHubWaitPredicates — Issue 匹配', () => {
  const baseline = makeIssueAwait().baseline

  it('matches issue_comment_added for comments past the cursor', () => {
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'issue_comment_added' }],
      baseline,
      {
        issue: {
          state: 'open',
          comments: [{ id: 4, author: 'mako' }],
        },
      },
    )
    expect(matched.map((m) => m.kind)).toEqual(['issue_comment_added'])
  })

  it('matches issue_author_commented only for the author', () => {
    const authorBaseline = {
      ...baseline,
      issue: { ...baseline.issue, authorLogin: 'korra' },
    }
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'issue_author_commented' }],
      authorBaseline,
      {
        issue: {
          state: 'open',
          comments: [{ id: 4, author: 'korra' }, { id: 5, author: 'mako' }],
        },
      },
    )
    expect(matched).toHaveLength(1)
    expect(matched[0]!.delta).toContain('korra')
  })

  it('ignores comments at or below the baseline cursor', () => {
    const matched = matchGitHubWaitPredicates(
      [{ kind: 'issue_comment_added' }],
      { ...baseline, issue: { ...baseline.issue, lastCommentCursor: 5 } },
      { issue: { state: 'open', comments: [{ id: 4, author: 'a' }] } },
    )
    expect(matched).toHaveLength(0)
  })
})