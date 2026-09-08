/**
 * @flowforge/infrastructure-github-signals — GitHub wait outcome / termination / task contract
 *
 * Self-contained port of the clowder-ai `@cat-cafe/shared` wait-lifecycle shapes:
 * WaitTerminationReason / WaitTerminationActor / WaitTerminationEventV1,
 * WaitOutcomeV1 (+ delivery), AutomationState / PrAutomationState /
 * IssueWaitAutomationState, and the TaskItem the ITaskStore port operates on.
 */

import type { WaitOwnerFence } from './predicate.ts'
import type { AwaitStateV1, GitHubWaitMatchedDelta } from './predicate.ts'
import type { GitHubWaitSubjectRef } from './baseline.ts'

/** Nominal brand for a cat id (self-contained; no cats-shared dependency). */
declare const __catId: unique symbol
export type CatId = string & { readonly [__catId]: 'CatId' }

// ── Wait termination vocabulary ─────────────────────────────────────────────

export type WaitTerminationReason =
  | 'matched'
  | 'subject_terminal'
  | 'expired'
  | 'owner_changed'
  | 'superseded'
  | 'user_cancel'

export type WaitTerminationActor =
  | { readonly kind: 'system' }
  | { readonly kind: 'cat'; readonly catId: string; readonly invocationId: string }
  | { readonly kind: 'user'; readonly userId: string }

export type WaitKind = 'hold_ball' | 'github_pr' | 'github_issue' | 'managed_command' | 'timer'

export interface WaitTerminationEventV1 {
  readonly v: 1
  readonly eventId: string
  readonly kind: 'wait.terminated'
  readonly waitId: string
  readonly waitKind: WaitKind
  readonly subjectRef: string
  readonly threadId: string
  readonly ownerUserId: string
  readonly ownerCatId: string
  readonly generation: number
  readonly reason: WaitTerminationReason
  readonly actor: WaitTerminationActor
  readonly at: number
}

// ── Wait outcome ────────────────────────────────────────────────────────────

export type WaitOutcomeDelivery = 'pending' | 'delivered' | 'not_applicable' | 'legacy_unfenced'

export interface WaitOutcomeV1 {
  readonly v: 1
  readonly outcomeId: string
  readonly generation: number
  readonly subjectRef: GitHubWaitSubjectRef
  /** Exact owner fence consumed by this outcome; never rebuilt from mutable fields. */
  readonly ownerFence: WaitOwnerFence
  readonly reason: WaitTerminationReason
  readonly at: number
  readonly delivery: WaitOutcomeDelivery
  readonly matched?: readonly GitHubWaitMatchedDelta[]
  readonly nextStep?: string
  readonly terminalSubjectState?: 'merged' | 'closed'
  readonly actor?: WaitTerminationActor
}

// ── Automation state shapes ─────────────────────────────────────────────────

/** Issue comment automation state for issue_tracking tasks. */
export interface IssueAutomationState {
  readonly lastCommentCursor?: number
  readonly lastNotifiedAt?: number
  readonly issueState?: 'open' | 'closed'
  readonly lastDeliveredCursor?: number
  readonly pendingWake?: unknown
}

/** Review feedback automation state for pr_tracking tasks. */
export interface ReviewAutomationState {
  readonly lastCommentCursor?: number
  readonly lastInlineCommentCursor?: number
  readonly lastConversationCommentCursor?: number
  readonly lastDecisionCursor?: number
  readonly lastNotifiedAt?: number
  readonly prState?: 'merged' | 'closed'
}

/** CI automation state for pr_tracking tasks. */
export interface CiAutomationState {
  readonly headSha?: string
  readonly lastFingerprint?: string
  readonly lastBucket?: string
  readonly prState?: 'merged' | 'closed'
}

/** Conflict detection automation state for pr_tracking tasks. */
export interface ConflictAutomationState {
  readonly mergeState?: string
  readonly lastFingerprint?: string
  readonly lastNotifiedAt?: number
}

/** PR-only collector + wait state. Issue-shaped fields are type-quarantined out. */
export interface PrAutomationState {
  readonly ci?: CiAutomationState
  readonly conflict?: ConflictAutomationState
  readonly review?: ReviewAutomationState
  readonly closedAt?: number
  readonly await?: AwaitStateV1
  readonly waitOutcome?: WaitOutcomeV1
  readonly issue?: never
}

/** Issue collector + typed one-shot wait state. PR-shaped fields are quarantined out. */
export interface IssueWaitAutomationState {
  readonly issue?: IssueAutomationState
  readonly closedAt?: number
  readonly await?: AwaitStateV1
  readonly waitOutcome?: WaitOutcomeV1
  readonly ci?: never
  readonly conflict?: never
  readonly review?: never
}

/** Composite automation state embedded in pr_tracking / issue_tracking tasks. */
export type AutomationState = PrAutomationState | IssueWaitAutomationState

// ── TaskItem ────────────────────────────────────────────────────────────────

export type TaskKind = 'work' | 'pr_tracking' | 'issue_tracking'
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done'

/** Tracking kinds that receive eviction/TTL protection while active. */
export function isTrackingKind(kind: TaskKind): kind is 'pr_tracking' | 'issue_tracking' {
  return kind === 'pr_tracking' || kind === 'issue_tracking'
}

/** Task record operated on by the GitHub wait lifecycle + ITaskStore port. */
export interface TaskItem {
  readonly id: string
  readonly kind: TaskKind
  readonly threadId: string
  readonly subjectKey: string | null
  readonly title: string
  readonly ownerCatId: CatId | null
  readonly status: TaskStatus
  readonly why: string
  readonly createdBy: CatId | 'user' | 'system'
  readonly createdAt: number
  readonly updatedAt: number
  readonly automationState?: AutomationState
  readonly userId?: string
}