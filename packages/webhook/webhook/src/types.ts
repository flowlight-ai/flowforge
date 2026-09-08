/**
 * @flowforge/webhook types — provider 无关的投递/规则/会话请求契型。
 *
 * 移植来源：dsh `@deepseek-ai/dsh-webhook` 的 `types.ts`。保留了
 * `WebhookEventMap` 声明合并、`VerifiedWebhookDelivery`、`WebhookRule`、
 * `WebhookSessionRequest`、`WebhookModelSelection` 等原样契型；仅将
 * `@deepseek-ai/dsh-util-values` 与 `@deepseek-ai/dsh-llm` 的类型替换为包内
 * `./values.ts` / `./llm.ts` 的等价类型。
 */

import type { JsonValue } from './values.ts'
import type { WebhookMessageSource } from './llm.ts'
import type { WebhookDeliveryId, WebhookRuleId, WebhookSourceId } from './brand.ts'

/** Provider 适配器通过声明合并追加各自的规范化事件类型。 */
export interface WebhookEventMap {}

/** 已知 provider kind 的事件值；树外的 kind 退化为无损 JSON。 */
export type WebhookEventOf<K extends string> =
  K extends keyof WebhookEventMap ? WebhookEventMap[K] : JsonValue

/** 一次已认证并解析的 provider 投递。 */
export interface VerifiedWebhookDelivery<K extends string = string> {
  /** Provider 族，例如 `github`。 */
  readonly kind: K
  /** 已配置的适配器实例，例如 `primary-github`。 */
  readonly source: WebhookSourceId
  /** Provider 身份，仅作为 provenance；不作为内置去重状态。 */
  readonly deliveryId: WebhookDeliveryId
  /** Provider 规范化的无损 JSON。 */
  readonly event: WebhookEventOf<K>
  /** 宿主接收时间（Unix 毫秒）。 */
  readonly receivedAt: number
}

/** webhook 创建的 Agent 的可选显式模型路由与输出上限。 */
export interface WebhookModelSelection {
  /** 已注册的 provider 路由。 */
  readonly provider: string
  /** Provider 持有的 model id。 */
  readonly model: string
  /** 可选的正输出 token 上限。 */
  readonly maxTokens?: number
}

/** 唯一运行时动作：创建并提示一个根 Session。 */
export interface WebhookSessionRequest {
  /** 用于解析或创建 Web Workspace 的既有本地目录。 */
  readonly workspacePath: string
  /** 显式 Session 标题。 */
  readonly title: string
  /** 非空初始文本提示。 */
  readonly prompt: string
  /** 发布前挂载的 Agent 组合。 */
  readonly agentPreset: string
  /** 提示准入前应用的沙箱与审批预置。 */
  readonly permissionPreset: string
  /** 可选显式路由；缺省使用完整当前默认值（含推理努力）。 */
  readonly model?: WebhookModelSelection
}

/** 可选项虎为一次投递创建单个 Session 的可信代码。 */
export interface WebhookRule<K extends string = string> {
  /** 全局唯一诊断标识。 */
  readonly id: WebhookRuleId
  /** 该规则接收的 provider kind。 */
  readonly kind: K
  /**
   * 运行任意可信代码并可选地请求一个 Session。
   * @param delivery - 不可变已认证 provider 数据。
   * @param signal - 该注册或运行时卸载时中止。
   * @returns 一个 Session 请求；`null` 表示无动作。
   */
  run(
    delivery: Readonly<VerifiedWebhookDelivery<K>>,
    signal: AbortSignal,
  ): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

/** webhook 消息源在 `dsh-llm` 旧态下通过模块合并暴露；此处包内等价导出。 */
export type { WebhookMessageSource }

export type { WebhookRuleId, WebhookSourceId, WebhookDeliveryId } from './brand.ts'
export type { JsonValue } from './values.ts'
export type { UserMessage } from './llm.ts'