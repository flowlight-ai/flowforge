/**
 * @flowforge/webhook llm 包内移植 — 消息构造与错误/摘要格式化助手。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-llm` 中 webhook 会话编排实际使用的
 * `createUserMessage` / `errorChain` / `boundContextSummary`，以及 `dsh-llm`
 * `MessageSourceMap` 中 `webhook` 消息源契型。`dsh-llm` 是服务类包，按任务铁律
 * 仅选取这些纯函数并包内重建，不改语义。
 */

import type { WebhookDeliveryId, WebhookRuleId, WebhookSourceId } from './brand.ts'

/** webhook 来源消息的 provenance 契型（对应 dsh-llm MessageSourceMap.webhook）。 */
export interface WebhookMessageSource {
  readonly kind: 'webhook'
  readonly provider: string
  readonly source: WebhookSourceId
  readonly deliveryId: WebhookDeliveryId
  readonly ruleId: WebhookRuleId
  readonly form: 'notice'
  readonly summary: string
}

/** 程序化输入的用户消息契型：一条文本内容 + 来源 provenance。 */
export interface UserMessage {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly source: WebhookMessageSource
}

/**
 * 构造一条 `notice` 形态的程序化用户消息。
 * @param input - 文本内容与来源 provenance。
 * @returns 冻结友好的消息对象。
 */
export function createUserMessage(input: {
  readonly content: UserMessage['content']
  readonly source: WebhookMessageSource
}): UserMessage {
  return { content: input.content, source: input.source }
}

/** 遍历错误链（含 `cause`）时最多记录的中继数，防止畸形循环链无限展开。 */
const ERROR_CHAIN_MAX_LINKS = 16

/**
 * 将任意错误展开为可读的链式摘要。
 * @param error - 原始错误或任意值。
 * @returns `message; cause; ...` 形式的字符串。
 */
export function errorChain(error: unknown): string {
  const seen = new Set<unknown>()
  const parts: string[] = []
  let current: unknown = error
  while (
    current !== undefined
    && current !== null
    && !seen.has(current)
    && parts.length < ERROR_CHAIN_MAX_LINKS
  ) {
    seen.add(current)
    const message = current instanceof Error ? current.message : String(current)
    if (message !== '') parts.push(message)
    current = (current as { cause?: unknown }).cause
  }
  return parts.join('; ')
}

/** 上下文摘要最大正文长度（超出截断）。 */
const CONTEXT_SUMMARY_MAX = 4000

/**
 * 将一段文本折叠为适合放入上下文的摘要（空白归一 + 长度截断）。
 * @param text - 原始文本。
 * @returns 归一化后的摘要。
 */
export function boundContextSummary(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length <= CONTEXT_SUMMARY_MAX
    ? normalized
    : `${normalized.slice(0, CONTEXT_SUMMARY_MAX)}…`
}