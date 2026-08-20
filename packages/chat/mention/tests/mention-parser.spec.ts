/**
 * mention-parser — MentionParser 纯函数契约验证（阶段5 批次5，T5.3.1）。
 *
 * 覆盖 clowder-ai `mention-parser.ts` / `cat-mention-handle.ts` 提取的纯计算面：
 * - normalizeMentionNoise：零宽字符剥离 + markdown 前后加粗/斜体清理（#969）
 * - parseMentions：首个匹配提取 / 左边界拒绝 email 域名 / 未命中回退 defaultCatId
 * - primaryMentionHandleFromPatterns：主 handle 推断（带前导 @）
 * - normalizeCatIdMentionsInText：裸 @catId 令牌规范化为 @<handle>（F128）
 *
 * @module @flowforge/chat-mention/tests
 */

import { describe, expect, it } from 'vitest'
import type { CatId } from '@flowforge/cats-shared'
import {
  normalizeCatIdMentionsInText,
  normalizeMentionNoise,
  parseMentions,
  primaryMentionHandleFromPatterns,
} from '../src/index.ts'

const defaultCatId = 'cat-a' as CatId

describe('normalizeMentionNoise', () => {
  it('剥离零宽字符（#969）', () => {
    expect(normalizeMentionNoise('hi\u200b @catA')).toBe('hi @catA')
    expect(normalizeMentionNoise('\ufeff@catA')).toBe('@catA')
  })

  it('剥离 mention 前 markdown 加粗/斜体标记', () => {
    expect(normalizeMentionNoise('**@catA** hi')).toBe('@catA hi')
    expect(normalizeMentionNoise('_@catA_ hi')).toBe('@catA hi')
    expect(normalizeMentionNoise('*@catA* hi')).toBe('@catA hi')
  })

  it('剥离 mention 后闭合的 markdown 标记', () => {
    expect(normalizeMentionNoise('@catA** hi')).toBe('@catA hi')
    expect(normalizeMentionNoise('@catA__，你')).toBe('@catA，你')
  })
})

describe('parseMentions', () => {
  const patterns = new Map<string, string[]>([
    ['cat-a', ['@砚砚', '砚砚']],
    ['cat-b', ['@opus46']],
  ])

  it('提取文本中首个匹配的 cat', () => {
    const r = parseMentions('请 @opus46 回答', patterns, defaultCatId)
    expect(r.targetCatId).toBe('cat-b')
    expect(r.matched).toBe(true)
  })

  it('无 @ mention 时回退 defaultCatId 且 matched=false', () => {
    const r = parseMentions('你好', patterns, defaultCatId)
    expect(r.targetCatId).toBe('cat-a')
    expect(r.matched).toBe(false)
  })

  it('左边界拒绝 email/域名中的伪 @mention', () => {
    const r = parseMentions('联系 a@opus46.com', patterns, defaultCatId)
    expect(r.matched).toBe(false)
    expect(r.targetCatId).toBe('cat-a')
  })

  it('大小写不敏感匹配', () => {
    const r = parseMentions('看看 @OPUS46', patterns, defaultCatId)
    expect(r.targetCatId).toBe('cat-b')
  })
})

describe('primaryMentionHandleFromPatterns', () => {
  it('返回带前导 @ 的主 handle', () => {
    expect(primaryMentionHandleFromPatterns(['砚砚', '@x'])).toBe('@砚砚')
    expect(primaryMentionHandleFromPatterns(['@砚砚'])).toBe('@砚砚')
  })

  it('无 pattern 时返回 null', () => {
    expect(primaryMentionHandleFromPatterns(undefined)).toBeNull()
    expect(primaryMentionHandleFromPatterns([])).toBeNull()
  })
})

describe('normalizeCatIdMentionsInText', () => {
  const registry: Record<string, string> = { 'cat-rcs85pvn': '@砚砚' }

  it('把裸 catId 令牌规范化为 @<handle>（F128）', () => {
    const out = normalizeCatIdMentionsInText('请 @cat-rcs85pvn 处理', (token) => registry[token] ?? null)
    expect(out).toBe('请 @砚砚 处理')
  })

  it('未解析 token 保持不变', () => {
    const out = normalizeCatIdMentionsInText('@co-creator 你好', (t) => registry[t] ?? null)
    expect(out).toBe('@co-creator 你好')
  })

  it('已稳定 handle 保持不变', () => {
    const out = normalizeCatIdMentionsInText('@砚砚 你好', (t) => registry[t] ?? null)
    expect(out).toBe('@砚砚 你好')
  })

  it('默认 resolveHandle 返回 null 时原样保留', () => {
    expect(normalizeCatIdMentionsInText('@cat-rcs85pvn')).toBe('@cat-rcs85pvn')
  })
})