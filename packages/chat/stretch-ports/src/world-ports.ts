/**
 * world 域 ports（T5.9 / stage-map §3.4 S3，stretch）：游戏 world / 社区 / 故事 /
 * 排行榜仅留接口 + mock。
 *
 * 移植 clowder-ai `domains/story/*`（buildFeatureStoryRendering / content-sanitizer /
 * export-store）、`community-issue-draft-routes.ts`、`routes/leaderboard.ts` 的
 * 域语义为纯接口（stretch 阶段由 mock 实现，阶段 11+ 接真实实现）。
 *
 * @module @flowforge/chat-stretch/world-ports
 */

/** 故事条目（feature story rendering 语义：线程转录 → 章节化故事）。 */
export interface StoryEntry {
  id: string
  threadId: string
  title: string
  summary: string
  chapters: Array<{ seq: number; title: string; content: string }>
  annotations: Array<{ seq: number; author: string; content: string }>
}

/** 故事导出包（export-store + content-sanitizer 语义）。 */
export interface StoryExportPack {
  manifest: { storyId: string; exportedAt: string; eventCount: number }
  sanitized: boolean
}

/** 社区 issue（community issue drafts 语义）。 */
export interface CommunityIssue {
  id: string
  repo: string
  title: string
  body: string
  status: 'draft' | 'open' | 'closed'
  labels: string[]
}

/** 排行榜条目（leaderboard 语义）。 */
export interface LeaderboardEntry {
  rank: number
  catId: string
  displayName: string
  score: number
  trend: 'up' | 'down' | 'flat'
}

/** 故事服务端口：线程 → 故事渲染 + 导出。 */
export interface IStoryService {
  buildStory(threadId: string): Promise<StoryEntry | null>
  exportStory(storyId: string): Promise<StoryExportPack>
}

/** 社区服务端口：issue 起草/列表。 */
export interface ICommunityService {
  listIssues(repo?: string): Promise<CommunityIssue[]>
  createIssue(input: { repo: string; title: string; body: string }): Promise<CommunityIssue>
}

/** 排行榜服务端口：排行查询 + 计分事件。 */
export interface ILeaderboardService {
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>
  recordEvent(catId: string, displayName: string, score: number): Promise<void>
}
