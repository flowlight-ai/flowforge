/**
 * @flowforge/chat-mention — invariant 常量（阶段5 批次5）。
 *
 * callback-auth 签名校验的纯常量面：表面可见失败原因集合、去重窗口、
 * connector 源、心跳工具。对齐 cats-shared `CallbackAuthFailureReason`。
 *
 * @module @flowforge/chat-mention/invariant
 */

import type { ConnectorSource } from '@flowforge/cats-shared'

/** F174 D2b-1 — 允许在群里表面化的 callback auth 失败原因。 */
export const SURFACEABLE_REASONS: ReadonlySet<string> = new Set(['expired', 'invalid_token'])

/** 同 (reason, tool, catId, threadId, userId) 去重窗口。 */
export const DEDUP_WINDOW_MS = 5 * 60 * 1000

/** "隐藏相似" 后的抑制窗口。 */
export const HIDE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * F174 D2b-1 — 系统驱动的心跳工具：其失败不面向用户表面化（定时触发，
 * 用户无动作可做）。遥测仍计数，但不投递到线程富块。
 */
export const BACKGROUND_HEARTBEAT_TOOLS: ReadonlySet<string> = new Set(['refresh-token'])

/** F174 D2b-1 — in-context 表面的 connector 源（面板分类为 'connector'）。 */
export const CALLBACK_AUTH_SOURCE: ConnectorSource = {
  connector: 'callback-auth',
  label: 'Callback Auth',
  icon: '🔌',
}

/** 失败原因 → 中文描述文案。 */
export const REASON_DESCRIPTIONS: Readonly<Record<string, string>> = {
  expired: 'callback token 已过期',
  invalid_token: 'callback token 不匹配',
  unknown_invocation: 'invocation 未找到（可能已过期清理）',
  stale_invocation: '已被新 invocation 顶替',
  missing_creds: '请求未携带 callback 凭证',
}