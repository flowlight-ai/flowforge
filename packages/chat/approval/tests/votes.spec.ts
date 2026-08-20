/**
 * votes — F079 投票纯函数契约验证（阶段5 批次4，T5.6.3）。
 *
 * 覆盖 clowder-ai `votes.ts` / `vote-intercept.ts` 提取的纯计算面：
 * - buildVoteTally：选项清零 + 已投票数累加（含非法选项计数兜底）
 * - checkVoteCompletion：仅指定投票人（voters）全部投完才 true
 * - extractVoteFromText：[VOTE:...] 提取 / 无匹配 null / 空白修剪
 * - buildVoteNotification：文案构造
 * - listVoters：已投用户去重
 *
 * @module @flowforge/chat-approval/tests
 */

import { describe, expect, it } from 'vitest'
import type { VotingStateV1 } from '@flowforge/cats-shared'
import {
  buildVoteNotification,
  buildVoteTally,
  checkVoteCompletion,
  extractVoteFromText,
  listVoters,
} from '../src/index.ts'

function activeState(overrides: Partial<VotingStateV1> = {}): VotingStateV1 {
  return {
    v: 1,
    question: '选谁',
    options: ['A', 'B'],
    votes: {},
    anonymous: false,
    deadline: Date.now() + 60_000,
    createdBy: 'alice',
    status: 'active',
    ...overrides,
  }
}

describe('buildVoteTally', () => {
  it('zero-initializes every option then accumulates cast votes', () => {
    const tally = buildVoteTally(['A', 'B', 'C'], { alice: 'A', bob: 'A', carol: 'C' })
    expect(tally).toEqual({ A: 2, B: 0, C: 1 })
  })

  it('counts votes for options not in the declared list defensively', () => {
    const tally = buildVoteTally(['A'], { alice: 'A', bob: 'ghost' })
    expect(tally.A).toBe(1)
    expect(tally.ghost).toBe(1)
  })

  it('returns zeroed options for an empty vote map', () => {
    expect(buildVoteTally(['A', 'B'], {})).toEqual({ A: 0, B: 0 })
  })
})

describe('checkVoteCompletion', () => {
  it('returns false when no designated voters are configured', () => {
    expect(checkVoteCompletion(activeState())).toBe(false)
  })

  it('returns false until every designated voter has cast', () => {
    const state = activeState({ voters: ['alice', 'bob'] })
    expect(checkVoteCompletion({ ...state, votes: { alice: 'A' } })).toBe(false)
  })

  it('returns true once all designated voters have cast', () => {
    const state = activeState({ voters: ['alice', 'bob'] })
    expect(checkVoteCompletion({ ...state, votes: { alice: 'A', bob: 'B' } })).toBe(true)
  })

  it('ignores extra non-designated votes', () => {
    const state = activeState({ voters: ['alice'] })
    expect(checkVoteCompletion({ ...state, votes: { alice: 'A', carol: 'B' } })).toBe(true)
  })
})

describe('extractVoteFromText', () => {
  it('extracts a [VOTE:...] option', () => {
    expect(extractVoteFromText('我选 [VOTE:B]')).toBe('B')
  })

  it('trims surrounding whitespace', () => {
    expect(extractVoteFromText('选 [VOTE: A ] 吧')).toBe('A')
  })

  it('returns null when no vote marker is present', () => {
    expect(extractVoteFromText('随便聊聊')).toBeNull()
  })
})

describe('buildVoteNotification / listVoters', () => {
  it('builds a notification that echoes the question and options', () => {
    const text = buildVoteNotification('今晚吃什么', ['火锅', '烧烤'])
    expect(text).toContain('投票请求：今晚吃什么')
    expect(text).toContain('• 火锅')
    expect(text).toContain('• 烧烤')
    expect(text).toContain('[VOTE:火锅]')
  })

  it('lists distinct voters in cast order', () => {
    expect(listVoters({ ...activeState(), votes: { bob: 'B', alice: 'A' } })).toEqual(['bob', 'alice'])
  })
})
