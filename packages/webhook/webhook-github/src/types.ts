/**
 * @flowforge/webhook-github types — 签名验证后投影出的 GitHub 事件值。
 *
 * 移植来源：dsh `webhook-github` 的 `types.ts`。源实现通过声明合并把
 * `github` 键并入 `@deepseek-ai/dsh-webhook` 的 `WebhookEventMap`，并从
 * `@octokit/webhooks` 重导出 `EmitterWebhookEvent`。本包以 `@flowforge/webhook`
 * 的 `WebhookEventMap` 声明合并取代前者；由于签名自实现（无 @octokit），
 * `EmitterWebhookEvent` 重导出替换为包内轻量契型 `GitHubWebhookEnvelope`。
 */

import type { JsonValue } from '@flowforge/webhook'

/** 签名后的 GitHub JSON 对象。事件特定字段校验归各规则。 */
export type GitHubJsonObject = { readonly [key: string]: JsonValue }

/** 提供给 `WebhookRule<'github'>` 的 provider 事件。 */
export interface GitHubWebhookEvent {
  /** 原始 `X-GitHub-Event` 名，例如 `pull_request`。 */
  readonly name: string
  /** 从请求体原样解析出的签名 JSON 对象。 */
  readonly payload: GitHubJsonObject
}

declare module '@flowforge/webhook' {
  interface WebhookEventMap {
    github: GitHubWebhookEvent
  }
}

/** GitHub 事件类型光标（字符串；可细分）。 */
export type GitHubWebhookEventName = string

/** 签名投递的完整信封（对应 @octokit 的 EmitterWebhookEvent 等价契型）。 */
export interface GitHubWebhookEnvelope {
  readonly id: string
  readonly name: GitHubWebhookEventName
  readonly payload: GitHubJsonObject
}