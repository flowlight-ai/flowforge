/**
 * @flowforge/infrastructure-github-signals — GitHub wait predicate contract types
 *
 * Self-contained port of the clowder-ai `@cat-cafe/shared` GitHub wait predicate
 * family: predicate kinds, PR/Issue predicates, unified await state (with owner
 * fence + continuation), matched deltas and the owner-fence kind vocabulary.
 */

import type { GitHubPrWaitBaseline, GitHubIssueWaitBaseline } from './baseline.ts'

/** All recognized GitHub wait predicate kinds. */
export const GITHUB_WAIT_PREDICATE_KINDS = [
  'pr_head_changed',
  'pr_review_result_available',
  'pr_review_decision_changed',
  'pr_review_thread_changed',
  'pr_ci_terminal',
  'pr_became_conflicting',
  'issue_comment_added',
  'issue_author_commented',
] as const

export type GitHubWaitPredicateKind = (typeof GITHUB_WAIT_PREDICATE_KINDS)[number]

/** Discriminated union of every supported wait predicate. */
export type GitHubWaitPredicate =
  | { readonly kind: 'pr_head_changed' }
  | { readonly kind: 'pr_review_result_available'; readonly triggerCommentId?: number }
  | { readonly kind: 'pr_review_decision_changed' }
  | { readonly kind: 'pr_review_thread_changed'; readonly reviewThreadIds: readonly string[] }
  | { readonly kind: 'pr_ci_terminal' }
  | { readonly kind: 'pr_became_conflicting' }
  | { readonly kind: 'issue_comment_added' }
  | { readonly kind: 'issue_author_commented' }

export type GitHubPrWaitPredicate = Extract<GitHubWaitPredicate, { readonly kind: `pr_${string}` }>
export type GitHubIssueWaitPredicate = Extract<GitHubWaitPredicate, { readonly kind: `issue_${string}` }>

/**
 * Owner fence — the exact identity that authorized a wait's one-shot
 * continuation. Consumed by an outcome; never reconstructed from mutable fields.
 */
export type WaitOwnerFence =
  | { readonly kind: 'containing_task'; readonly generation: number }
  | { readonly kind: 'action_successor'; readonly leaseId: string; readonly generation: number }

/**
 * Immutable transport projection for one canonical wait outcome. Lets a
 * Message/Queue/Invocation retain which exact owner fence authorized the
 * one-shot continuation without holding the authoritative task/lease.
 */
export interface WaitContinuationCarrierV1 {
  readonly v: 1
  readonly waitId: string
  readonly outcomeId: string
  readonly ownerFence: WaitOwnerFence
}

/** Generic unified await-state shape over a baseline + predicate. */
export interface UnifiedAwaitStateV1<SubjectRef extends string, Baseline, Predicate> {
  readonly v: 1
  readonly generation: number
  readonly subjectRef: SubjectRef
  readonly ownerFence: WaitOwnerFence
  readonly baseline: Baseline
  readonly continuation: {
    readonly when: readonly Predicate[]
    readonly then: string
  }
  readonly expiresAt: number
  readonly createdAt: number
}

type GitHubWaitProvenance = {
  readonly provenance?: 'explicit_registration' | 'legacy_migration_default'
}

export type GitHubPrAwaitStateV1 = UnifiedAwaitStateV1<
  `pr:${string}#${number}`,
  GitHubPrWaitBaseline,
  GitHubPrWaitPredicate
> &
  GitHubWaitProvenance

export type GitHubIssueAwaitStateV1 = UnifiedAwaitStateV1<
  `issue:${string}#${number}`,
  GitHubIssueWaitBaseline,
  GitHubIssueWaitPredicate
> &
  GitHubWaitProvenance

export type AwaitStateV1 = GitHubPrAwaitStateV1 | GitHubIssueAwaitStateV1

/** A single predicate match delta, projected through an outcome's `matched`. */
export interface GitHubWaitMatchedDelta {
  readonly kind: GitHubWaitPredicateKind
  readonly delta: string
  readonly sourceRef?: string
}