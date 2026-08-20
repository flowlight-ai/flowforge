/**
 * @flowforge/chat-mention — MentionParser 纯函数（阶段5 批次5，T5.3.1）。
 *
 * 移植 clowder-ai `mention-parser.ts` / `cat-mention-handle.ts` 的纯函数面：
 * - `normalizeMentionNoise`：剥离零宽字符 + mention 前后 markdown 加粗/斜体标记（#969）
 * - `parseMentions`：提取文本中**首个**匹配已注册灵智体的 @mention（左边界拒绝
 *   word char/. 组成的 email/域名），未命中回退 defaultCatId
 * - `primaryMentionHandleFromPatterns`：由 mentionPatterns 推断主 mention handle
 * - `normalizeCatIdMentionsInText`：把裸 `@catId` 令牌规范化为 `@<handle>`（F128）
 *
 * 纯函数无全局注册表依赖：patterns / resolveHandle 均经参数注入（对齐 flowforge 插件化）。
 *
 * @module @flowforge/chat-mention/mention-parser
 */

import type { CatId } from '@flowforge/cats-shared'

export interface ParsedMention {
  targetCatId: CatId
  matched: boolean
}

// ASCII + CJK 全角标点 + 可跟在 mention 后的括号
const MENTION_BOUNDARY_RIGHT = '[\\s,.:;!?，。！？；：、)\\]）】」』]'
// 左边界：@ 前不能是 word 字符或点（拒绝 email/域名）
const MENTION_BOUNDARY_LEFT = '(?<!\\w)'

/** #969: 剥离零宽 Unicode 字符 + mention 前 markdown 加粗/斜体标记。 */
const ZERO_WIDTH_RE = /(?:\u200b|\u200c|\u200d|\ufeff|\u00ad|\u2060)/g
const MD_BEFORE_MENTION_RE = /(?:\*{1,2}|_{1,2})(?=@)/g
const MD_AFTER_MENTION_RE = /(@\S+?)(?:\*{1,2}|_{1,2})(?=\s|$|[,.:;!?，。！？])/g

export function normalizeMentionNoise(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '').replace(MD_BEFORE_MENTION_RE, '').replace(MD_AFTER_MENTION_RE, '$1')
}

/**
 * 解析外部平台消息文本中的 @mention。
 * 返回文本中**首个**匹配的灵智体 cat，未命中回退到 defaultCatId。
 *
 * @param text — 入站消息文本
 * @param allPatterns — Map<CatId, mentionPatterns[]>
 * @param defaultCatId — 未命中时的兜底
 */
export function parseMentions(text: string, allPatterns: Map<string, string[]>, defaultCatId: CatId): ParsedMention {
  const normalizedText = normalizeMentionNoise(text)
  let bestIndex = Infinity
  let bestCatId: string | undefined

  for (const [catId, patterns] of allPatterns) {
    for (const pattern of patterns) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`${MENTION_BOUNDARY_LEFT}${escaped}(?=${MENTION_BOUNDARY_RIGHT}|$)`, 'i')
      const match = regex.exec(normalizedText)
      if (match && match.index < bestIndex) {
        bestIndex = match.index
        bestCatId = catId
      }
    }
  }

  return { targetCatId: (bestCatId ?? defaultCatId) as CatId, matched: Boolean(bestCatId) }
}

/**
 * F128 — 由 mentionPatterns 推断主稳定 mention handle（带前导 "@"）。
 * 无 pattern 或第一个 pattern 为空时返回 null。
 */
export function primaryMentionHandleFromPatterns(patterns: readonly string[] | undefined): string | null {
  const pattern = patterns?.[0]
  if (!pattern) return null
  return pattern.startsWith('@') ? pattern : `@${pattern}`
}

/**
 * F128 — 把文本中的裸 `@<token>`（catId 令牌）规范化为 `@<handle>`。
 * token 以字母开头，可含字母/数字/下划线/连字符；未解析的（用户自定义或已是
 * 稳定 handle）保持不变。`resolveHandle` 注入式（测试 seam，避免全局注册表）。
 */
export function normalizeCatIdMentionsInText(
  text: string,
  resolveHandle: (token: string) => string | null = () => null,
): string {
  return text.replace(/@([A-Za-z][A-Za-z0-9_-]*)/g, (full, captured: string) => {
    const handle = resolveHandle(captured)
    return handle ?? full
  })
}