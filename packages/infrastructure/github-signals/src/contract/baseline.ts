/**
 * @flowforge/infrastructure-github-signals — GitHub wait baseline contract types
 *
 * Self-contained port of the clowder-ai `@cat-cafe/shared` GitHub wait baseline
 * shapes (GitHubPrWaitBaseline / GitHubIssueWaitBaseline / GitHubReviewThreadBaseline /
 * GitHubCiBaselineBucket / GitHubWaitBaseline). These are the immutable capture-time
 * snapshots a wait is created against and a lifecycle observation is diffed from.
 */

/** Terminal aggregate CI bucket for a GitHub PR head. */
export type GitHubCiBaselineBucket = 'pending' | 'pass' | 'fail' | 'external_infrastructure'

/** One review thread capture (used for `pr_review_thread_changed`). */
export interface GitHubReviewThreadBaseline {
  readonly reviewThreadId: string
  readonly lastCommentId: string | null
  readonly resolved: boolean
}

/** PR wait baseline (capture-time review / ci / conflict snapshots). */
export interface GitHubPrWaitBaseline {
  readonly capturedAt: number
  readonly headSha: string
  readonly review?: {
    readonly inlineCommentCursor: number
    readonly conversationCommentCursor: number
    readonly decisionCursor: number
    readonly decision?: string
    readonly resultTriggerCommentId?: number
    readonly resultTriggerHeadSha?: string
    readonly threads?: readonly GitHubReviewThreadBaseline[]
  }
  readonly ci?: {
    readonly bucket: GitHubCiBaselineBucket
    readonly fingerprint: string
  }
  readonly conflict?: {
    readonly mergeState: string
  }
}

/** Issue wait baseline (single capture-time issue state). */
export interface GitHubIssueWaitBaseline {
  readonly capturedAt: number
  readonly issue: {
    readonly lastCommentCursor: number
    readonly state: 'open' | 'closed'
    readonly authorLogin?: string
  }
}

/** Discriminated union of PR / issue wait baselines. */
export type GitHubWaitBaseline = GitHubPrWaitBaseline | GitHubIssueWaitBaseline

/** Canonical GitHub wait subject reference.
 * @example `pr:owner/repo#123` | `issue:owner/repo#456`
 */
export type GitHubWaitSubjectRef = `pr:${string}#${number}` | `issue:${string}#${number}`