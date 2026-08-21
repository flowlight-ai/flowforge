/**
 * world 域 mock 实现（T5.9 stretch）：内存故事/社区/排行榜。
 *
 * 真实实现（clowder-ai `domains/story/*`、community-issue-draft-routes、
 * routes/leaderboard.ts 的完整渲染/仓储语义）在阶段 11+ 按数据面落地，
 * stretch 阶段以本 mock 验证 ports 契约与 ChatStretchService 编排语义。
 *
 * @module @flowforge/chat-stretch/mock
 */

import type {
  CommunityIssue,
  ICommunityService,
  ILeaderboardService,
  IStoryService,
  LeaderboardEntry,
  StoryEntry,
  StoryExportPack,
} from '../world-ports.ts'

/** 内存故事服务：确定性生成 + 导出（export-store 语义：sanitized 标记 + 事件计数）。 */
export class InMemoryStoryService implements IStoryService {
  private readonly stories = new Map<string, StoryEntry>()

  async buildStory(threadId: string): Promise<StoryEntry | null> {
    const id = `story-${threadId}`
    const existing = this.stories.get(id)
    if (existing) return existing
    const story: StoryEntry = {
      id,
      threadId,
      title: `Thread ${threadId} Story`,
      summary: `Auto-summary of thread ${threadId}`,
      chapters: [{ seq: 1, title: 'Opening', content: 'Transcribed opening chapter.' }],
      annotations: [],
    }
    this.stories.set(id, story)
    return story
  }

  async exportStory(storyId: string): Promise<StoryExportPack> {
    const story = this.stories.get(storyId)
    const eventCount = story
      ? story.chapters.length + story.annotations.length
      : 0
    return {
      manifest: { storyId, exportedAt: '2026-01-01T00:00:00.000Z', eventCount },
      sanitized: true,
    }
  }
}

/** 内存社区服务：issue 起草 + 按 repo 过滤。 */
export class InMemoryCommunityService implements ICommunityService {
  private readonly issues: CommunityIssue[] = []
  private seq = 0

  async listIssues(repo?: string): Promise<CommunityIssue[]> {
    if (!repo) return [...this.issues]
    return this.issues.filter((issue) => issue.repo === repo)
  }

  async createIssue(input: { repo: string; title: string; body: string }): Promise<CommunityIssue> {
    this.seq += 1
    const issue: CommunityIssue = {
      id: `issue-${this.seq}`,
      repo: input.repo,
      title: input.title,
      body: input.body,
      status: 'draft',
      labels: [],
    }
    this.issues.push(issue)
    return issue
  }
}

/** 内存排行榜服务：计分事件累加 + 分数降序排行（trend 与上次分数比较）。 */
export class InMemoryLeaderboardService implements ILeaderboardService {
  private readonly scores = new Map<string, { displayName: string; score: number; trend: LeaderboardEntry['trend'] }>()

  async recordEvent(catId: string, displayName: string, score: number): Promise<void> {
    const prev = this.scores.get(catId)
    if (!prev) {
      this.scores.set(catId, { displayName, score, trend: 'flat' })
      return
    }
    const next = prev.score + score
    const trend: LeaderboardEntry['trend'] = next > prev.score ? 'up' : next < prev.score ? 'down' : 'flat'
    this.scores.set(catId, { displayName, score: next, trend })
  }

  async getLeaderboard(limit?: number): Promise<LeaderboardEntry[]> {
    const entries = [...this.scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .map(([catId, value], index) => ({
        rank: index + 1,
        catId,
        displayName: value.displayName,
        score: value.score,
        trend: value.trend,
      }))
    return limit !== undefined ? entries.slice(0, limit) : entries
  }
}
