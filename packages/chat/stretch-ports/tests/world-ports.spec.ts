/**
 * ChatStretchService world 域面 + mock 服务契约验证（阶段5 批次8，T5.9）。
 *
 * 覆盖（对齐 clowder-ai domains/story/* / community-issue-draft-routes /
 * routes/leaderboard.ts 语义的 ports 抽象）：
 * - InMemoryStoryService：buildStory 确定性生成（幂等）+ exportStory
 * - InMemoryCommunityService：createIssue 起草（draft）+ listIssues repo 过滤
 * - InMemoryLeaderboardService：recordEvent 累加 + getLeaderboard 排序/limit/trend
 * - ChatStretchService 委托面 + 组合根注入覆盖（真实实现可替换 mock）
 *
 * @module @flowforge/chat-stretch/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import {
  ChatStretchService,
  InMemoryCommunityService,
  InMemoryLeaderboardService,
  InMemoryStoryService,
} from '../src/index.ts'
import type { ChatStretchServiceOptions } from '../src/index.ts'

interface Harness {
  ctx: Context
  stretch: ChatStretchService
}

function harness(overrides: ChatStretchServiceOptions = {}): Harness {
  const ctx = new Context()
  const stretch = new ChatStretchService(ctx, overrides)
  return { ctx, stretch }
}

describe('InMemoryStoryService（T5.9）', () => {
  it('buildStory 确定性生成 + 幂等', async () => {
    const service = new InMemoryStoryService()
    const story = await service.buildStory('thread-1')
    expect(story).toMatchObject({
      id: 'story-thread-1',
      threadId: 'thread-1',
      chapters: [{ seq: 1 }],
    })
    await expect(service.buildStory('thread-1')).resolves.toBe(story)
  })

  it('exportStory 返回 sanitized 导出包（事件计数）', async () => {
    const service = new InMemoryStoryService()
    await service.buildStory('thread-1')
    const pack = await service.exportStory('story-thread-1')
    expect(pack.sanitized).toBe(true)
    expect(pack.manifest).toMatchObject({ storyId: 'story-thread-1', eventCount: 1 })
    // 未构建的故事：空事件计数导出（不抛错）
    const missing = await service.exportStory('story-nope')
    expect(missing.manifest.eventCount).toBe(0)
  })
})

describe('InMemoryCommunityService（T5.9）', () => {
  it('createIssue 起草 draft + listIssues repo 过滤', async () => {
    const service = new InMemoryCommunityService()
    const issue = await service.createIssue({ repo: 'flowforge', title: 'bug', body: 'desc' })
    expect(issue).toMatchObject({ id: 'issue-1', repo: 'flowforge', status: 'draft', labels: [] })
    await service.createIssue({ repo: 'flowforge', title: 'bug2', body: 'desc2' })
    await service.createIssue({ repo: 'other', title: 'bug3', body: 'desc3' })

    const filtered = await service.listIssues('flowforge')
    expect(filtered).toHaveLength(2)
    await expect(service.listIssues()).resolves.toHaveLength(3)
  })
})

describe('InMemoryLeaderboardService（T5.9）', () => {
  it('recordEvent 累加 + getLeaderboard 降序 rank + limit', async () => {
    const service = new InMemoryLeaderboardService()
    await service.recordEvent('cat-a', 'Alpha', 10)
    await service.recordEvent('cat-a', 'Alpha', 5)
    await service.recordEvent('cat-b', 'Beta', 20)
    await service.recordEvent('cat-c', 'Gamma', 15)

    const board = await service.getLeaderboard()
    // 分数降序；同分时保持插入序（稳定排序）：cat-a 先于 cat-c
    expect(board).toEqual([
      { rank: 1, catId: 'cat-b', displayName: 'Beta', score: 20, trend: 'flat' },
      { rank: 2, catId: 'cat-a', displayName: 'Alpha', score: 15, trend: 'up' },
      { rank: 3, catId: 'cat-c', displayName: 'Gamma', score: 15, trend: 'flat' },
    ])
    await expect(service.getLeaderboard(2)).resolves.toHaveLength(2)
  })
})

describe('ChatStretchService world 面（T5.9）', () => {
  it('委托默认 mock 服务', async () => {
    const { stretch } = harness()
    const story = await stretch.buildStory('thread-1')
    expect(story?.title).toContain('thread-1')

    const issue = await stretch.createIssue({ repo: 'flowforge', title: 't', body: 'b' })
    expect(issue.status).toBe('draft')
    await expect(stretch.listIssues()).resolves.toHaveLength(1)

    await stretch.recordLeaderboardEvent('cat-x', 'X', 10)
    const board = await stretch.getLeaderboard()
    expect(board[0]).toMatchObject({ rank: 1, catId: 'cat-x', score: 10 })
  })

  it('组合根可注入真实实现覆盖 mock', async () => {
    const storyService = new InMemoryStoryService()
    const communityService = new InMemoryCommunityService()
    const leaderboardService = new InMemoryLeaderboardService()
    const { stretch } = harness({ storyService, communityService, leaderboardService })

    await stretch.buildStory('thread-2')
    const pack = await stretch.exportStory('story-thread-2')
    expect(pack.sanitized).toBe(true)

    await stretch.createIssue({ repo: 'r', title: 't', body: 'b' })
    await expect(stretch.listIssues('r')).resolves.toHaveLength(1)

    await stretch.recordLeaderboardEvent('cat-y', 'Y', 3)
    await expect(stretch.getLeaderboard()).resolves.toHaveLength(1)
  })
})
