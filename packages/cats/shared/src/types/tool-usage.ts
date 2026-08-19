/**
 * Tool Usage types (F150 / F188 Phase F).
 *
 * 两个互补的遥测维度：
 * 1. **聚合计数**（ToolUsageEntry/ToolUsageReport）：(date, catId, category,
 *    toolName) 粒度的调用计数——回答"哪些工具用得多"。
 * 2. **事件序列**（ToolEvent）：per-thread append-only 有序日志，保留完整
 *    调用顺序——支撑 grep_after_search_rate (FM-1) / candidate_selection
 *    (FM-2) / list_recent_adoption (FM-3) / nudge effectiveness (FM-5) 等
 *    序列型指标。
 *
 * 与转录写入器的区别：转录层对 toolName 去重为 Set（丢失顺序），聚合层
 * 只保留 (date, toolName) 计数（丢失线程内序列）——事件日志两者都保留。
 *
 * Ported from clowder-ai `tool-usage/{event-log-types,classify}.ts`.
 *
 * @module @flowforge/cats-shared/types
 */

/** 工具调用结果状态（结果侧回填）。 */
export type ToolStatus = 'success' | 'low_hit' | 'no_match' | 'error';

/** 工具三分类：平台原生 / MCP / Skill。 */
export type ToolCategory = 'native' | 'mcp' | 'skill';

/** classifyTool 的输出：分类 + 归一化名称 + MCP server（如有）。 */
export interface ToolClassification {
  category: ToolCategory;
  /** For skills: the extracted skill name. For others: the raw toolName. */
  toolName: string;
  /** For MCP tools: the server name (normalized across providers). */
  mcpServer?: string;
}

/** Base fields shared by every tool event. */
export interface BaseToolEvent {
  invocationId: string;
  sessionId: string;
  threadId: string;
  catId: string;
  toolName: string;
  timestamp: number;
  turnIndex: number;
  status: ToolStatus;
}

/** search_evidence summary — supports FM-5 plus typed F256 expansion tracking. */
export interface SearchEvidenceSummary {
  resultCount: number;
  resultStatus: 'ok' | 'empty' | 'degraded' | string;
  topScore: number | null;
  nudgeEmitted: boolean;
  /** F256 Wave 1b: versioned gate/stage telemetry copied from the result sidecar. */
  expansionFunnel?: Record<string, unknown>;
}

/**
 * graph_resolve summary — supports FM-2 (candidate ranking quality).
 * `rankedCandidateAnchors` is the candidate set association field;
 * selectedCandidateIndex is reconstructed from selectedAnchor's position.
 */
export interface GraphResolveSummary {
  resultStatus: 'ok' | 'empty' | 'degraded' | string;
  candidateCount: number;
  rankedCandidateAnchors: string[];
  selectedCandidateIndex?: number;
  selectedAnchor?: string;
}

/** list_recent summary — supports FM-3 (cold-start adoption). */
export interface ListRecentSummary {
  resultCount: number;
  resultStatus: 'ok' | 'empty' | 'degraded' | string;
  scope: string;
  since: string;
}

/** Generic summary for non-memory tools (Bash, Read, etc). */
export type GenericSummary = Record<string, unknown>;

/** Discriminated union of all known tool events. */
export type ToolEvent =
  | (BaseToolEvent & { toolName: 'search_evidence'; summary: SearchEvidenceSummary })
  | (BaseToolEvent & { toolName: 'graph_resolve'; summary: GraphResolveSummary })
  | (BaseToolEvent & { toolName: 'list_recent'; summary: ListRecentSummary })
  | (BaseToolEvent & { summary: GenericSummary });

/**
 * Skill load event — supports AS-4 (memory-navigation skill triggered).
 * Distinct from Skill tool_use count: not deduplicated, carries loadTrigger
 * context (why was this skill loaded?).
 */
export interface SkillLoadedEvent {
  invocationId: string;
  sessionId: string;
  skillId: string;
  loadTrigger: 'mention_match' | 'keyword_match' | 'explicit_call';
  timestamp: number;
}

/** Derived metric: was a nudge followed within N turns? */
export interface NudgeFollowupAnalysis {
  searchEvent: ToolEvent;
  followed: boolean;
  followupTool: string | null;
  fallbackGrepDetected: boolean;
}

/** A single counter entry (aggregation granularity). */
export interface ToolUsageEntry {
  date: string;
  catId: string;
  category: ToolCategory;
  toolName: string;
  count: number;
}

/** Aggregated usage report returned by the reader. */
export interface ToolUsageReport {
  period: { from: string; to: string };
  summary: {
    totalCalls: number;
    byCategory: Record<ToolCategory, number>;
  };
  topTools: Array<{ name: string; category: ToolCategory; count: number; mcpServer?: string }>;
  daily: Array<{
    date: string;
    native: number;
    mcp: number;
    skill: number;
  }>;
  byCat: Record<string, Record<ToolCategory, number>>;
}
