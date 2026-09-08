/**
 * @flowforge/infrastructure-github-signals — GitHub issue wait baseline reader
 *
 * Self-contained port of the clowder-ai `domains/github-signals/GitHubIssueWaitBaselineReader.ts`.
 * Builds the issue capture-time baseline + collector state from lazy fetch seams.
 */

import type { GitHubIssueWaitBaseline } from './contract/baseline.ts'
import type { IssueAutomationState } from './contract/github-wait.ts'

export interface InitialIssueWaitSnapshot {
  readonly baseline: GitHubIssueWaitBaseline
  readonly collectorState: { readonly issue: IssueAutomationState }
}

export async function readGitHubIssueWaitBaseline(
  input: {
    readonly repoFullName: string
    readonly issueNumber: number
  },
  deps: {
    readonly fetchCommentCursor: (repoFullName: string, issueNumber: number) => Promise<number>
    readonly fetchMetadata: (
      repoFullName: string,
      issueNumber: number,
    ) => Promise<{ state: 'open' | 'closed'; authorLogin?: string }>
    readonly now?: () => number
  },
): Promise<InitialIssueWaitSnapshot> {
  const [lastCommentCursor, metadata] = await Promise.all([
    deps.fetchCommentCursor(input.repoFullName, input.issueNumber),
    deps.fetchMetadata(input.repoFullName, input.issueNumber),
  ])
  return {
    baseline: {
      capturedAt: (deps.now ?? Date.now)(),
      issue: {
        lastCommentCursor,
        state: metadata.state,
        ...(metadata.authorLogin ? { authorLogin: metadata.authorLogin } : {}),
      },
    },
    collectorState: {
      issue: {
        lastCommentCursor,
        lastDeliveredCursor: lastCommentCursor,
        issueState: metadata.state,
      },
    },
  }
}