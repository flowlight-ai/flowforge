/**
 * Tool Usage Event Log — F188 Phase F (AC-F10)
 *
 * Append-only event log enabling per-thread tool call sequence metrics that
 * current infra cannot compute:
 * - grep_after_search_rate (FM-1)
 * - candidate_selection_distribution (FM-2)
 * - list_recent_adoption_rate (FM-3)
 * - nudge effectiveness (FM-5)
 *
 * Distinct from:
 * - ToolUsageCounter: aggregate (date, catId, category, toolName) count
 * - TranscriptWriter: dedupes toolNames into Set, loses sequence
 */

import type { ExpansionFunnelMeta, RecallResultStatus } from './recall-meta.ts'

export type ToolStatus = 'success' | 'low_hit' | 'no_match' | 'error'

/** Base fields shared by every tool event. */
export interface BaseToolEvent {
  invocationId: string
  sessionId: string
  threadId: string
  catId: string
  toolName: string
  timestamp: number
  turnIndex: number
  status: ToolStatus
}

/** search_evidence summary — supports FM-5 plus typed F256 expansion tracking. */
export interface SearchEvidenceSummary {
  resultCount: number
  resultStatus: RecallResultStatus
  topScore: number | null
  nudgeEmitted: boolean
  /** F256 Wave 1b: versioned gate/stage telemetry copied from the result sidecar. */
  expansionFunnel?: ExpansionFunnelMeta
}

/**
 * graph_resolve summary — supports FM-2 (candidate ranking quality).
 * `rankedCandidateAnchors` is the candidate set association field;
 * selectedCandidateIndex can be reconstructed by finding selectedAnchor's
 * position in rankedCandidateAnchors.
 */
export interface GraphResolveSummary {
  resultStatus: RecallResultStatus
  candidateCount: number
  rankedCandidateAnchors: string[]
  selectedCandidateIndex?: number
  selectedAnchor?: string
}

/** list_recent summary — supports FM-3 (cold-start adoption). */
export interface ListRecentSummary {
  resultCount: number
  resultStatus: RecallResultStatus
  scope: string
  since: string
}

/** Generic summary for non-memory tools (Bash, Read, etc). */
export type GenericSummary = Record<string, unknown>

/** Discriminated union of all known tool events. */
export type ToolEvent =
  | (BaseToolEvent & { toolName: 'search_evidence'; summary: SearchEvidenceSummary })
  | (BaseToolEvent & { toolName: 'graph_resolve'; summary: GraphResolveSummary })
  | (BaseToolEvent & { toolName: 'list_recent'; summary: ListRecentSummary })
  | (BaseToolEvent & { summary: GenericSummary })

/** Skill load event — supports AS-4 (memory-navigation skill triggered). */
export interface SkillLoadedEvent {
  invocationId: string
  sessionId: string
  skillId: string
  loadTrigger: 'mention_match' | 'keyword_match' | 'explicit_call'
  timestamp: number
}

/** Derived metric: was a nudge followed within N turns? */
export interface NudgeFollowupAnalysis {
  searchEvent: ToolEvent
  followed: boolean
  followupTool: string | null
  fallbackGrepDetected: boolean
}